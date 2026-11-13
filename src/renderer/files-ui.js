/* 本地资料页：已授权的本机文件夹按真实目录横向展开。
   这里读的是磁盘上的文件夹和文件，不看岗位包匹配结果。
   岗位工作台的数字仍然只来自重新扫描后的索引。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  var pick = { id: null, root: 0, segs: [] };
  var cache = {};
  var inflight = {};
  var seq = 0;
  var loadGen = 0;
  var tipTimer = null;
  var clip = null;
  var menuTarget = null;
  var view = { container: null, state: null, inst: null };

  function esc(v) { return PA.blocks.esc(v); }
  function norm(p) { return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase(); }
  function cacheKey(instanceId, abs) { return String(instanceId || '') + '\n' + norm(abs); }
  function depthTitle(n) {
    if (n >= 1 && n <= CN.length) return CN[n - 1] + '级目录';
    return n + '级目录';
  }
  function rootLabel(p) {
    if (/samples[\\/]fire-safety/i.test(p)) return '示例资料';
    var parts = String(p || '').split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '未命名目录';
  }
  function joinPath(base, name) {
    if (!base) return name;
    var last = base.charAt(base.length - 1);
    if (last === '\\' || last === '/') return base + name;
    return base + (/\\/.test(base) ? '\\' : '/') + name;
  }
  function fileType(name) {
    var ext = String(name || '').indexOf('.') >= 0 ? String(name).split('.').pop().toLowerCase() : '';
    var map = {
      txt: '文本文档', md: 'Markdown 文档', html: 'HTML 文档', htm: 'HTML 文档',
      json: 'JSON 文件', csv: 'CSV 文档', xlsx: 'Excel 工作表', xls: 'Excel 工作表',
      docx: 'Word 文档', doc: 'Word 文档', pdf: 'PDF 文档', png: 'PNG 图像',
      jpg: 'JPEG 图像', jpeg: 'JPEG 图像', gif: 'GIF 图像', zip: '压缩文件'
    };
    if (!ext) return '文件';
    return map[ext] || (ext.toUpperCase() + ' 文件');
  }
  function fileSize(n) {
    n = Number(n);
    if (!isFinite(n)) return '';
    if (n < 1024) return n + ' 字节';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function tipNode() {
    var el = document.getElementById('fileTip');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fileTip';
    el.className = 'file-tip';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    var el = document.getElementById('fileTip');
    if (el) el.hidden = true;
  }
  function scheduleTip(btn) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { showTip(btn); }, 500);
  }
  function showTip(btn) {
    var name = btn.getAttribute('data-name') || '';
    var size = fileSize(btn.getAttribute('data-size'));
    var rawTime = btn.getAttribute('data-mtime') || '';
    var when = rawTime ? new Date(rawTime).toLocaleString('zh-CN') : '';
    var lines = ['类型: ' + fileType(name)];
    if (size) lines.push('大小: ' + size);
    if (when && when !== 'Invalid Date') lines.push('修改时间: ' + when);
    var tip = tipNode();
    tip.textContent = lines.join('\n');
    tip.hidden = false;
    var rect = btn.getBoundingClientRect();
    var left = rect.left + 16;
    var top = rect.bottom + 4;
    if (left + tip.offsetWidth > window.innerWidth - 8) left = window.innerWidth - tip.offsetWidth - 8;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = rect.top - tip.offsetHeight - 4;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function dropListings() {
    loadGen++;
    Object.keys(cache).forEach(function (k) { delete cache[k]; });
  }
  function loadDir(instanceId, abs) {
    var key = cacheKey(instanceId, abs);
    var gen = loadGen;
    if (inflight[key]) return inflight[key];
    inflight[key] = PA.app.call('assistant', 'listDir', { instanceId: instanceId, path: abs }).then(function (data) {
      if (gen !== loadGen) return cache[key];
      cache[key] = {
        entries: (data && data.entries) || [],
        error: '',
        truncated: !!(data && data.truncated)
      };
      if (inflight[key] && gen === loadGen) delete inflight[key];
      return cache[key];
    }, function (e) {
      if (gen !== loadGen) return cache[key];
      cache[key] = { entries: [], error: (e && e.message) || '无法读取该文件夹', truncated: false };
      if (inflight[key] && gen === loadGen) delete inflight[key];
      return cache[key];
    });
    return inflight[key];
  }

  function render(container, state) {
    var my = ++seq;
    var cur = state.current || {};
    var inst = cur.instance || {};
    var paths = cur.authorizedPaths || [];
    if (pick.id !== inst.id) {
      pick.id = inst.id || null;
      pick.root = 0;
      pick.segs = [];
    }
    if (pick.root >= paths.length) { pick.root = 0; pick.segs = []; }
    paint(container, state);
    var rootPath = paths[pick.root];
    if (!inst.id || !rootPath) return;
    var wanted = [rootPath];
    var acc = rootPath;
    pick.segs.forEach(function (name) {
      acc = joinPath(acc, name);
      wanted.push(acc);
    });
    Promise.all(wanted.map(function (abs) { return loadDir(inst.id, abs); })).then(function () {
      if (my !== seq) return;
      paint(container, PA.app.state);
    });
  }

  function paint(container, state) {
    var cur = state.current || {};
    var inst = cur.instance || {};
    var paths = cur.authorizedPaths || [];
    var rootPath = paths[pick.root] || '';
    var chain = [];
    if (rootPath) {
      var acc = rootPath;
      chain.push(acc);
      pick.segs.forEach(function (name) {
        acc = joinPath(acc, name);
        chain.push(acc);
      });
    }
    hideTip();
    hideMenu();

    var html = '';
    if (paths.length) {
      html += '<div class="page-head"><div></div><div class="head-right">' +
        '<button class="primary-btn" id="rescanBtn" type="button">重新扫描</button></div></div>';
    }

    html += '<div class="files-auth">';
    paths.forEach(function (p, i) {
      var isSample = /samples[\\/]fire-safety/i.test(p);
      html += '<div class="path-box' + (i === pick.root ? ' active' : '') + '">' +
        '<button type="button" class="path-name" data-root="' + i + '" title="' + esc(p) + '">' + esc(p) +
        (isSample ? ' <span class="tag amber">示例资料</span>' : '') + '</button>' +
        '<button type="button" data-delpath="' + i + '">移除</button></div>';
    });
    html += '<button class="secondary-btn" id="addFolderBtn" type="button">+ 添加本机目录</button></div>';

    if (!paths.length) {
      container.innerHTML = html;
      bind(container, state, paths, inst);
      return;
    }

    // 每一列都是上一级选中文件夹里的全部内容：文件夹和文件放在同一列。
    html += '<div class="miller">';
    chain.forEach(function (abs, i) {
      var listing = cache[cacheKey(inst.id, abs)];
      html += '<section class="miller-col"><h3>' + depthTitle(i + 1) + '</h3><div class="miller-list">';
      if (listing && listing.error) html += '<div class="miller-empty">' + esc(listing.error) + '</div>';
      else if (listing) {
        listing.entries.filter(function (e) { return e.kind === 'dir'; }).forEach(function (dir) {
          var on = pick.segs[i] === dir.name;
          html += '<button type="button" class="miller-item miller-folder' + (on ? ' active' : '') +
            '" data-kind="dir" data-depth="' + i + '" data-folder="' + esc(dir.name) + '" data-name="' + esc(dir.name) +
            '" data-dir="' + esc(abs) + '" data-path="' + esc(dir.path) + '">' + esc(dir.name) + '</button>';
        });
        listing.entries.filter(function (e) { return e.kind === 'file'; }).forEach(function (f) {
          html += '<button type="button" class="miller-item miller-file" data-kind="file" data-depth="' + i +
            '" data-dir="' + esc(abs) + '" data-path="' + esc(f.path) + '" data-name="' + esc(f.name) +
            '" data-size="' + (f.size == null ? '' : String(f.size)) + '" data-mtime="' + esc(f.mtime || '') + '">' +
            esc(f.name) + '</button>';
        });
      }
      html += '</div></section>';
    });
    html += '</div>';

    container.innerHTML = html;
    bind(container, state, paths, inst);
  }

  function hideMenu() {
    var menu = document.getElementById('fileMenu');
    if (menu) menu.hidden = true;
  }
  function menuNode() {
    var menu = document.getElementById('fileMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'fileMenu';
    menu.className = 'file-menu';
    menu.hidden = true;
    menu.innerHTML = '<button type="button" data-act="open">打开</button>' +
      '<div class="file-menu-sep"></div>' +
      '<button type="button" data-act="cut">剪切</button>' +
      '<button type="button" data-act="copy">复制</button>' +
      '<button type="button" data-act="paste">粘贴</button>' +
      '<div class="file-menu-sep"></div>' +
      '<button type="button" data-act="delete">删除</button>' +
      '<div class="file-menu-sep"></div>' +
      '<button type="button" data-act="props">属性</button>';
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn || btn.disabled) return;
      runMenu(btn.getAttribute('data-act'));
    });
    document.addEventListener('mousedown', function (e) {
      if (!menu.hidden && !menu.contains(e.target)) hideMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { hideMenu(); hideDialog(); }
    });
    return menu;
  }
  function openMenu(btn, x, y) {
    hideTip();
    var menu = menuNode();
    menuTarget = {
      kind: btn.getAttribute('data-kind'),
      name: btn.getAttribute('data-name') || '',
      path: btn.getAttribute('data-path') || '',
      dir: btn.getAttribute('data-dir') || '',
      depth: Number(btn.getAttribute('data-depth')) || 0
    };
    menu.querySelector('[data-act="paste"]').disabled = !clip;
    menu.hidden = false;
    var left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    var top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }
  function dialogNode() {
    var el = document.getElementById('fileDialog');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fileDialog';
    el.className = 'file-dialog';
    el.hidden = true;
    el.innerHTML = '<div class="file-dialog-card"><b id="fileDialogTitle"></b><div id="fileDialogBody"></div>' +
      '<div class="file-dialog-actions"><button type="button" class="secondary-btn" id="fileDialogCancel">取消</button>' +
      '<button type="button" class="primary-btn" id="fileDialogOk">确定</button></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el) hideDialog(); });
    return el;
  }
  function hideDialog() {
    var el = document.getElementById('fileDialog');
    if (el) el.hidden = true;
  }
  function showDialog(opts) {
    var el = dialogNode();
    document.getElementById('fileDialogTitle').textContent = opts.title || '';
    document.getElementById('fileDialogBody').innerHTML = opts.body || '';
    var cancel = document.getElementById('fileDialogCancel');
    var ok = document.getElementById('fileDialogOk');
    cancel.hidden = !!opts.hideCancel;
    cancel.textContent = opts.cancelText || '取消';
    ok.textContent = opts.okText || '确定';
    ok.classList.toggle('danger', !!opts.danger);
    cancel.onclick = hideDialog;
    ok.onclick = function () {
      hideDialog();
      if (opts.onOk) opts.onOk();
    };
    el.hidden = false;
  }
  function refreshFiles() {
    dropListings();
    if (view.container) render(view.container, PA.app.state);
  }
  function runMenu(act) {
    var item = menuTarget;
    var inst = view.inst;
    hideMenu();
    if (!item || !inst || !inst.id) return;
    if (act === 'open') {
      if (item.kind === 'file') {
        PA.app.call('system', 'open', { instanceId: inst.id, path: item.path });
        return;
      }
      pick.segs = pick.segs.slice(0, item.depth).concat([item.name]);
      render(view.container, view.state);
      return;
    }
    if (act === 'copy' || act === 'cut') {
      clip = { mode: act, path: item.path, name: item.name };
      PA.app.toast(act === 'cut' ? '已剪切' : '已复制');
      return;
    }
    if (act === 'paste') {
      if (!clip) return;
      var dest = item.kind === 'dir' ? item.path : item.dir;
      var mode = clip.mode;
      var from = clip.path;
      PA.app.call('files', mode === 'cut' ? 'move' : 'copy', { instanceId: inst.id, from: from, toDir: dest })
        .then(function () {
          if (mode === 'cut') clip = null;
          PA.app.toast('已粘贴');
          refreshFiles();
        })
        .catch(function (e) { PA.app.toast(e.message); });
      return;
    }
    if (act === 'delete') {
      showDialog({
        title: '删除',
        body: '<div class="file-dialog-text">将「' + esc(item.name) + '」移到回收站。</div>',
        okText: '删除',
        danger: true,
        onOk: function () {
          PA.app.call('files', 'trash', { instanceId: inst.id, path: item.path }).then(function () {
            if (item.kind === 'dir' && pick.segs[item.depth] === item.name) pick.segs = pick.segs.slice(0, item.depth);
            PA.app.toast('已移到回收站');
            refreshFiles();
          }).catch(function (e) { PA.app.toast(e.message); });
        }
      });
      return;
    }
    if (act === 'props') {
      PA.app.call('files', 'props', { instanceId: inst.id, path: item.path }).then(function (info) {
        var when = info.mtime ? new Date(info.mtime).toLocaleString('zh-CN') : '';
        var rows = '<div class="kv-row"><div class="k">名称</div><div class="v">' + esc(info.name) + '</div></div>' +
          '<div class="kv-row"><div class="k">类型</div><div class="v">' + esc(info.isDir ? '文件夹' : fileType(info.name)) + '</div></div>' +
          '<div class="kv-row"><div class="k">位置</div><div class="v">' + esc(info.dir) + '</div></div>' +
          (info.isDir ? '' : '<div class="kv-row"><div class="k">大小</div><div class="v">' + esc(fileSize(info.size)) + '</div></div>') +
          '<div class="kv-row"><div class="k">修改时间</div><div class="v">' + esc(when) + '</div></div>';
        showDialog({ title: '属性', body: rows, okText: '关闭', hideCancel: true });
      }).catch(function (e) { PA.app.toast(e.message); });
    }
  }

  function bind(container, state, paths, inst) {
    view.container = container;
    view.state = state;
    view.inst = inst;
    container.querySelectorAll('[data-root]').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = Number(b.getAttribute('data-root')) || 0;
        if (next === pick.root && !pick.segs.length) return;
        pick.root = next;
        pick.segs = [];
        pick.file = null;
        render(container, state);
      });
    });
    container.querySelectorAll('.miller-file').forEach(function (b) {
      b.addEventListener('mouseenter', function () { scheduleTip(b); });
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('click', function () {
        container.querySelectorAll('.miller-file.active').forEach(function (el) { el.classList.remove('active'); });
        b.classList.add('active');
      });
      b.addEventListener('dblclick', function () {
        var filePath = b.getAttribute('data-path');
        if (filePath && inst.id) PA.app.call('system', 'open', { instanceId: inst.id, path: filePath });
      });
    });
    container.querySelectorAll('.miller-item').forEach(function (b) {
      b.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openMenu(b, e.clientX, e.clientY);
      });
    });
    var miller = container.querySelector('.miller');
    if (miller) miller.addEventListener('scroll', function () { hideTip(); hideMenu(); });
    container.querySelectorAll('[data-folder]').forEach(function (b) {
      b.addEventListener('click', function () {
        var depth = Number(b.getAttribute('data-depth')) || 0;
        var name = b.getAttribute('data-folder');
        if (pick.segs[depth] === name && pick.segs.length === depth + 1) return;
        pick.file = null;
        pick.segs = pick.segs.slice(0, depth).concat([name]);
        render(container, state);
      });
    });
    container.querySelectorAll('[data-delpath]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var i = Number(b.getAttribute('data-delpath'));
        var next = paths.filter(function (_, n) { return n !== i; });
        await PA.app.call('assistant', 'setPaths', { instanceId: inst.id, paths: next });
        pick.root = 0;
        pick.segs = [];
        await PA.app.reloadCurrent();
        PA.app.renderAll();
        PA.app.toast('已移除目录并重建索引');
      });
    });
    document.getElementById('addFolderBtn').addEventListener('click', async function () {
      if (!inst || !inst.id) { PA.app.toast('请先添加一个助手'); return; }
      var dir = await PA.app.call('library', 'pickFolder');
      if (!dir) return;
      await PA.app.call('assistant', 'setPaths', { instanceId: inst.id, paths: paths.concat([dir]) });
      PA.app.toast('已添加目录');
      await PA.app.reloadCurrent();
      PA.app.renderAll();
    });
    var rescan = document.getElementById('rescanBtn');
    if (rescan) rescan.addEventListener('click', function () { PA.app.reindex(); });
  }

  PA.filesUI = { render: render };
})(window);
