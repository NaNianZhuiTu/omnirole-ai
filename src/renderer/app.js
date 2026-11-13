/* 应用主控：状态、IPC 封装、页面切换、助手切换（上下文整体换掉）。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var page = 'workbench';
  var lastNonAiPage = 'workbench'; // Ctrl+B / 菜单「显示 / 隐藏 AI 助手」来回切换时回到上一页
  var toastTimer = null;

  var state = {
    current: null, library: null, available: [], settings: null,
    appInfo: null, modelConfigured: false, trace: []
  };

  async function call(ns, method, payload) {
    var api = window.desktop && window.desktop[ns];
    if (!api || typeof api[method] !== 'function') throw new Error('接口不存在：' + ns + '.' + method);
    var res = await api[method](payload);
    if (res && res.ok === false) throw new Error(res.error || '操作失败');
    return res && Object.prototype.hasOwnProperty.call(res, 'ok') ? res.data : res;
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // ---------- 数据加载 ----------
  async function loadBase() {
    var results = await Promise.all([
      call('assistant', 'current'),
      call('library', 'list'),
      call('library', 'available'),
      call('settings', 'get'),
      call('app', 'info')
    ]);
    state.current = results[0];
    state.library = results[1];
    state.available = results[2];
    state.settings = results[3];
    state.appInfo = results[4];
    state.modelConfigured = !!results[4].modelConfigured;
    await loadInstanceExtras();
  }

  async function loadInstanceExtras() {
    var id = state.current && state.current.instance && state.current.instance.id;
    if (!id) { state.trace = []; return; }
    state.trace = await call('assistant', 'trace', { instanceId: id, limit: 20 }).catch(function () { return []; });
  }

  async function reloadAll() { await loadBase(); renderAll(); }
  async function reloadCurrent() {
    state.current = await call('assistant', 'current');
    await loadInstanceExtras();
  }
  async function reloadLibrary() {
    state.library = await call('library', 'list');
    state.available = await call('library', 'available');
  }
  async function reloadSettings() {
    state.settings = await call('settings', 'get');
    state.appInfo = await call('app', 'info');
    state.modelConfigured = !!state.appInfo.modelConfigured;
  }

  // ---------- 渲染 ----------
  function renderAccent() {
    var pkg = state.current && state.current.pkg;
    document.documentElement.style.setProperty('--accent', (pkg && pkg.accent) || '#315efb');
  }

  function esc(v) { return PA.blocks.esc(v); }

  function currentAssistant() {
    var list = state.library || { instances: [], activeId: null };
    return (list.instances || []).find(function (i) { return i.id === list.activeId; }) ||
      (state.current && state.current.instance) || null;
  }

  function renderAssistantEntry() {
    var cur = currentAssistant();
    var badge = document.getElementById('pickerBadge');
    var name = document.getElementById('pickerName');
    badge.textContent = cur ? (cur.icon || '助') : '助';
    badge.style.background = (cur && cur.accent) || '#315efb';
    name.textContent = cur ? cur.name : '选择助手';
  }

  function renderAssistants(container) {
    var list = state.library || { instances: [], activeId: null };
    var html = '<div class="page-head"><div></div>' +
      '<div class="head-right"><button class="primary-btn" id="assistAddBtn">+ 添加助手</button></div></div>';
    if (!list.instances.length) {
      html += '<div class="empty">还没有助手</div>';
    } else {
      html += '<div class="assist-grid">';
      list.instances.forEach(function (i) {
        var active = i.id === list.activeId;
        html += '<button class="assist-card' + (active ? ' active' : '') + '" data-inst="' + esc(i.id) + '">' +
          '<span class="assist-badge" style="background:' + esc(i.accent || '#315efb') + '">' + esc(i.icon || '助') + '</span>' +
          '<span class="assist-card-main"><b>' + esc(i.name) + '</b>' +
          '<small>' + esc(i.packageId) + (i.workspaceType === 'html' ? ' · HTML 工作台' : '') + ' · ' + (i.indexedFileCount || 0) + ' 个文件</small></span>' +
          (active ? '<span class="tag blue">当前</span>' : '') + '</button>';
      });
      html += '</div>';
    }
    container.innerHTML = html;
    container.querySelectorAll('[data-inst]').forEach(function (b) {
      b.addEventListener('click', function () { pickAssistant(b.getAttribute('data-inst')); });
    });
    var add = document.getElementById('assistAddBtn');
    if (add) add.addEventListener('click', function () { addAssistant(); });
  }

  async function pickAssistant(id) {
    var list = state.library || { instances: [], activeId: null };
    if (id !== list.activeId) {
      var ok = await switchTo(id);
      if (!ok) return;
    }
    go('workbench');
  }

  function renderAll() {
    renderAccent();
    renderAssistantEntry();
    document.getElementById('mainArea').classList.toggle('chat-view', page === 'ai');
    var ws = state.current && state.current.workspace;
    var htmlWs = page === 'workbench' && ws && ws.type === 'html' && ws.ready;
    document.getElementById('mainArea').classList.toggle('html-workspace-view', !!htmlWs);
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    var el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-page') === page);
    });
    if (page === 'workbench') PA.htmlWorkspace.mount(document.getElementById('page-workbench'), state);
    else if (page === 'assistants') renderAssistants(document.getElementById('page-assistants'));
    else if (page === 'files') PA.filesUI.render(document.getElementById('page-files'), state);
    else if (page === 'library') PA.libraryUI.render(document.getElementById('page-library'), state);
    else if (page === 'settings') PA.settingsUI.render(document.getElementById('page-settings'), state);
    PA.chat.render(state);
  }

  // ---------- 动作 ----------
  function go(next) {
    if (next !== 'ai') lastNonAiPage = next;
    page = next;
    document.getElementById('mainArea').scrollTop = 0;
    renderAll();
  }

  async function addAssistant() {
    var file = await call('library', 'pickPackage');
    if (!file) return;
    try {
      var imported = await call('library', 'import', { filePath: file });
      var added = await call('library', 'add', { packageId: imported.id, name: imported.name });
      await reloadAll();
      toast('已添加助手：' + added.name);
      go('assistants');
    } catch (e) { toast('添加失败：' + e.message); }
  }

  async function switchTo(id) {
    try {
      await call('library', 'switchTo', { id: id });
      await reloadAll();
      toast('已切换助手');
      return true;
    } catch (e) { toast('切换失败：' + e.message); return false; }
  }

  async function reindex() {
    var id = state.current && state.current.instance && state.current.instance.id;
    if (!id) { toast('请先添加一个助手'); return; }
    toast('正在扫描本机资料…');
    try {
      var idx = await call('assistant', 'reindex', { instanceId: id });
      await reloadCurrent();
      renderAll();
      toast('索引完成：' + (idx.summary.fileCount || 0) + ' 个文件 · ' + (idx.summary.rowCount || 0) + ' 条记录');
    } catch (e) { toast('扫描失败：' + e.message); }
  }

  // ---------- 系统菜单动作分发 ----------
  // AI 助手现在是工作区第三页：Ctrl+B / 菜单项在「AI 助手」与刚才那一页之间切换
  function toggleChat() {
    go(page === 'ai' ? (lastNonAiPage || 'workbench') : 'ai');
  }

  function handleMenuAction(raw) {
    var a = typeof raw === 'string' ? { type: raw } : (raw || {});
    switch (a.type) {
      case 'go': if (a.page) go(a.page); break;
      case 'toggle-chat': toggleChat(); break;
      case 'switch-to': if (a.id) switchTo(a.id); break;
      case 'reindex': reindex(); break;
      case 'export-index': {
        var id = state.current && state.current.instance && state.current.instance.id;
        if (id) call('system', 'exportIndex', { instanceId: id })
          .then(function (f) { if (f) toast('索引已导出'); })
          .catch(function (e) { toast('导出失败：' + e.message); });
        break;
      }
      default: break;
    }
  }

  // ---------- 初始化 ----------
  function bind() {
    document.getElementById('navList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]');
      if (b) go(b.getAttribute('data-page'));
    });
    document.getElementById('assistantPickerBtn').addEventListener('click', function () { go('assistants'); });
    document.getElementById('settingsBtn').addEventListener('click', function () { go('settings'); });
    window.desktop.app.onMenuAction(handleMenuAction);
  }

  async function init() {
    PA.chat.init();
    bind();
    try { await reloadAll(); }
    catch (e) {
      document.getElementById('page-workbench').innerHTML =
        '<div class="empty"><b>初始化失败</b>' + PA.blocks.esc(e.message) + '</div>';
    }
  }

  PA.app = {
    state: state, call: call, toast: toast, go: go, switchTo: switchTo, reindex: reindex,
    reloadAll: reloadAll, reloadCurrent: reloadCurrent, reloadLibrary: reloadLibrary,
    reloadSettings: reloadSettings,
    renderAll: renderAll, init: init, menuAction: handleMenuAction, toggleChat: toggleChat
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
