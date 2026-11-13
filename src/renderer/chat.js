/* AI 助手页：左侧历史对话，空态时欢迎语与输入框居中。
   每个助手自己的对话互不相通；一条历史就是一次独立会话。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var sending = false, currentRequestId = null, streamText = '';
  var menuThreadId = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mdToHtml(md) {
    var lines = esc(md).split(/\r?\n/);
    var out = [], inList = false;
    lines.forEach(function (line) {
      var t = line.trimEnd();
      if (/^[-*] /.test(t)) {
        if (!inList) { out.push('<ul style="margin:6px 0;padding-left:18px">'); inList = true; }
        out.push('<li>' + inline(t.slice(2)) + '</li>'); return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (/^#### /.test(t)) out.push('<div style="font-weight:700;margin:8px 0 3px">' + inline(t.slice(5)) + '</div>');
      else if (/^### /.test(t)) out.push('<div style="font-weight:700;font-size:15px;margin:10px 0 4px">' + inline(t.slice(4)) + '</div>');
      else if (/^## /.test(t)) out.push('<div style="font-weight:700;font-size:16px;margin:12px 0 4px">' + inline(t.slice(3)) + '</div>');
      else if (/^# /.test(t)) out.push('<div style="font-weight:700;font-size:17px;margin:12px 0 4px">' + inline(t.slice(2)) + '</div>');
      else if (!t) out.push('<div style="height:8px"></div>');
      else out.push('<div>' + inline(t) + '</div>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }
  function inline(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code style="background:#f3f5f8;padding:1px 5px;border-radius:4px">$1</code>');
  }

  function chatOf(state) {
    return (state && state.current && state.current.chat) || { messages: [], threads: [], activeId: null };
  }
  function activeMessages(chat) {
    var threads = chat.threads || [];
    var hit = null;
    threads.forEach(function (t) { if (t.id === chat.activeId) hit = t; });
    if (hit) return hit.messages || [];
    return chat.messages || [];
  }

  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function bucket(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '更早';
    var today = dayStart(new Date());
    if (t >= today) return '今天';
    if (t >= today - 86400000) return '昨天';
    if (t >= today - 7 * 86400000) return '7天内';
    return '更早';
  }

  function hideMenu() {
    menuThreadId = null;
    var menu = document.getElementById('threadMenu');
    if (menu) menu.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('.thread-more.open'), function (el) {
      el.classList.remove('open');
    });
  }

  function syncSendBtn() {
    var btn = document.getElementById('sendBtn');
    var input = document.getElementById('chatInput');
    if (!btn || !input) return;
    btn.classList.toggle('stop', sending);
    btn.classList.toggle('ready', !sending && !!input.value.trim());
    btn.setAttribute('aria-label', sending ? '停止' : '发送');
  }

  function fitInput() {
    var input = document.getElementById('chatInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }

  function init() {
    document.getElementById('sendBtn').addEventListener('click', function () {
      if (sending) { abort(); return; }
      var input = document.getElementById('chatInput');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      fitInput();
      syncSendBtn();
      send(text);
    });
    document.getElementById('chatInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('sendBtn').click(); }
    });
    document.getElementById('chatInput').addEventListener('input', function () { fitInput(); syncSendBtn(); });
    document.getElementById('newChatBtn').addEventListener('click', newThread);
    document.getElementById('threadList').addEventListener('click', function (e) {
      var more = e.target.closest('[data-more]');
      if (more) {
        e.stopPropagation();
        openMenu(more);
        return;
      }
      var item = e.target.closest('[data-thread]');
      if (item) openThread(item.getAttribute('data-thread'));
    });
    document.getElementById('threadDeleteBtn').addEventListener('click', function () {
      var id = menuThreadId;
      hideMenu();
      if (id) removeThread(id);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('#threadMenu') || e.target.closest('[data-more]')) return;
      hideMenu();
    });
    window.addEventListener('resize', hideMenu);
    window.desktop.chat.onChunk(function (data) {
      if (!currentRequestId || data.requestId !== currentRequestId) return;
      streamText += data.piece;
      var bubble = document.getElementById('streamBubble');
      if (bubble) {
        bubble.innerHTML = mdToHtml(streamText) + '<span style="opacity:.5">▍</span>';
        var log = document.getElementById('chatLog');
        log.scrollTop = log.scrollHeight;
      }
    });
  }

  function openMenu(btn) {
    var id = btn.getAttribute('data-more');
    var menu = document.getElementById('threadMenu');
    if (menuThreadId === id && !menu.hidden) { hideMenu(); return; }
    hideMenu();
    menuThreadId = id;
    btn.classList.add('open');
    menu.hidden = false;
    var rect = btn.getBoundingClientRect();
    var left = Math.min(rect.left, window.innerWidth - 140);
    var top = rect.bottom + 6;
    if (top + 44 > window.innerHeight) top = rect.top - 44;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function renderThreads(chat) {
    var list = document.getElementById('threadList');
    var groups = { '今天': [], '昨天': [], '7天内': [], '更早': [] };
    (chat.threads || []).filter(function (t) { return t.messages && t.messages.length; })
      .sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); })
      .forEach(function (t) {
        var key = bucket(t.updatedAt || t.createdAt);
        groups[key].push(t);
      });
    var html = '';
    ['今天', '昨天', '7天内', '更早'].forEach(function (key) {
      if (!groups[key].length) return;
      html += '<div class="thread-label">' + key + '</div>';
      groups[key].forEach(function (t) {
        html += '<div class="thread-item' + (t.id === chat.activeId ? ' active' : '') + '" data-thread="' + esc(t.id) + '" role="button" tabindex="0">' +
          '<span>' + esc(t.title || '新对话') + '</span>' +
          '<button type="button" class="thread-more" data-more="' + esc(t.id) + '" title="更多">···</button></div>';
      });
    });
    list.innerHTML = html;
  }

  function render(state) {
    hideMenu();
    var chat = chatOf(state);
    var messages = activeMessages(chat);
    var inst = state.current && state.current.instance;
    var pkg = state.current && state.current.pkg;
    var panel = document.getElementById('chatPanel');
    var log = document.getElementById('chatLog');
    panel.classList.toggle('is-empty', !sending && messages.length === 0);

    var who = (pkg && pkg.name) || (inst && inst.name) || '助手';
    document.getElementById('chatInput').placeholder = inst ? ('给' + who + '发送消息') : '请先添加一个助手';
    var greet = document.getElementById('chatGreet');
    if (greet) greet.textContent = inst ? '欢迎回来，想从哪里开始？' : '先添加一个助手';

    var qp = document.getElementById('quickPrompts');
    qp.innerHTML = (pkg && pkg.prompts || []).map(function (p, i) {
      return '<button type="button" class="quick-btn" data-prompt="' + i + '" title="' + esc(p.label) + '">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.05 3.25h3.4l-2.75 2 1.05 3.25L8 8.15 5.25 10.1l1.05-3.25-2.75-2h3.4z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>' +
        '<span>' + esc(p.label) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(qp.querySelectorAll('[data-prompt]'), function (btn) {
      btn.addEventListener('click', function () {
        var p = pkg.prompts[Number(btn.getAttribute('data-prompt'))];
        if (!p || sending) return;
        document.getElementById('chatInput').value = p.template;
        document.getElementById('sendBtn').click();
      });
    });

    renderThreads(chat);
    if (sending && document.getElementById('streamBubble')) {
      syncSendBtn();
      return;
    }

    log.innerHTML = '<div class="chat-stream">' + messages.map(function (m) {
      if (m.role === 'system') return '<div class="msg system"><div class="bubble">' + esc(m.content) + '</div></div>';
      if (m.role === 'user') return '<div class="msg user"><div class="bubble">' + esc(m.content) + '</div></div>';
      var ctx = m.context || {};
      return '<div class="msg assistant"><div class="bubble">' + mdToHtml(m.content) + '</div>' +
        '<div class="meta"><span>' + (ctx.enabled ? '依据 ' + (ctx.includedFiles || 0) + ' 个资料文件' : '未携带本机资料') + '</span>' +
        (ctx.sampleMode ? '<span>基于示例资料</span>' : '') + '</div></div>';
    }).join('') + '</div>';
    log.scrollTop = log.scrollHeight;
    syncSendBtn();
  }

  async function refresh() {
    await PA.app.reloadCurrent();
    render(PA.app.state);
  }

  async function newThread() {
    if (sending) { PA.app.toast('正在生成，请稍候'); return; }
    var inst = PA.app.state.current && PA.app.state.current.instance;
    if (!inst) { PA.app.toast('请先添加一个助手'); return; }
    var messages = activeMessages(chatOf(PA.app.state));
    if (!messages.length) {
      document.getElementById('chatInput').focus();
      return;
    }
    try {
      await PA.app.call('chat', 'newThread', { instanceId: inst.id });
      document.getElementById('chatInput').value = '';
      fitInput();
      await refresh();
      document.getElementById('chatInput').focus();
    } catch (e) { PA.app.toast(e.message); }
  }

  async function openThread(threadId) {
    if (!threadId) return;
    if (sending) { PA.app.toast('正在生成，请稍候'); return; }
    var chat = chatOf(PA.app.state);
    if (chat.activeId === threadId) return;
    var inst = PA.app.state.current && PA.app.state.current.instance;
    if (!inst) return;
    try {
      await PA.app.call('chat', 'openThread', { instanceId: inst.id, threadId: threadId });
      document.getElementById('chatInput').value = '';
      fitInput();
      await refresh();
    } catch (e) { PA.app.toast(e.message); }
  }

  async function removeThread(threadId) {
    if (sending) { PA.app.toast('正在生成，请稍候'); return; }
    var inst = PA.app.state.current && PA.app.state.current.instance;
    if (!inst) return;
    try {
      await PA.app.call('chat', 'removeThread', { instanceId: inst.id, threadId: threadId });
      await refresh();
    } catch (e) { PA.app.toast(e.message); }
  }

  async function send(text) {
    var state = PA.app.state;
    var inst = state.current && state.current.instance;
    if (!inst) { PA.app.toast('请先添加一个助手'); return; }
    if (!state.modelConfigured) {
      PA.app.toast('尚未配置模型');
      PA.app.go('settings');
      return;
    }
    sending = true;
    currentRequestId = 'r' + Date.now();
    streamText = '';
    syncSendBtn();
    document.getElementById('chatPanel').classList.remove('is-empty');

    var history = activeMessages(chatOf(state))
      .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
      .slice(-12).map(function (m) { return { role: m.role, content: m.content }; });
    var messages = history.concat([{ role: 'user', content: text }]);

    var log = document.getElementById('chatLog');
    var stream = log.querySelector('.chat-stream');
    if (!stream) {
      log.innerHTML = '<div class="chat-stream"></div>';
      stream = log.querySelector('.chat-stream');
    }
    stream.insertAdjacentHTML('beforeend',
      '<div class="msg user"><div class="bubble">' + esc(text) + '</div></div>' +
      '<div class="msg assistant" id="streamMsg"><div class="bubble" id="streamBubble"><span style="opacity:.45">生成中…</span></div></div>');
    log.scrollTop = log.scrollHeight;

    try {
      await PA.app.call('chat', 'send', { instanceId: inst.id, requestId: currentRequestId, messages: messages });
      await refresh();
    } catch (e) {
      var bubble = document.getElementById('streamBubble');
      if (bubble) bubble.innerHTML = '<span style="color:#d0453b">生成失败：' + esc(e.message) + '</span>';
    } finally {
      sending = false;
      currentRequestId = null;
      syncSendBtn();
      var b = document.getElementById('streamBubble');
      if (b && streamText) b.innerHTML = mdToHtml(streamText);
    }
  }

  async function abort() {
    if (!currentRequestId) return;
    await PA.app.call('chat', 'abort', { requestId: currentRequestId });
    PA.app.toast('已停止生成');
  }

  async function clear() {
    var inst = PA.app.state.current && PA.app.state.current.instance;
    if (!inst) return;
    await PA.app.call('chat', 'clear', { instanceId: inst.id });
    await refresh();
  }

  PA.chat = { init: init, render: render, send: send, clear: clear };
})(window);
