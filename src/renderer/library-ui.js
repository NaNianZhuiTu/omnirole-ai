/* 助手库页：一次安装，装助手 = 往助手库里放一份纯数据岗位包。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  function esc(v) { return PA.blocks.esc(v); }

  function render(container, state) {
    var list = state.library || { instances: [], activeId: null };
    var available = state.available || [];

    var html = '<div class="page-head"><div><h1>助手库与分发</h1></div></div>';

    if (list.instances.length) {
    html += '<div class="form-card" style="max-width:none"><h3>我的助手</h3>';
    list.instances.forEach(function (i) {
      html += '<div class="list-row"><div class="assist-badge" style="background:' + esc(i.accent || '#315efb') + '">' + esc(i.icon || '助') + '</div>' +
        '<div class="grow"><b>' + esc(i.name) + (i.id === list.activeId ? ' <span class="tag blue">当前</span>' : '') + '</b>' +
        '<small>' + esc(i.packageId) + ' v' + esc(i.packageVersion) + ' · 授权 ' + (i.authorizedPathCount || 0) + ' 个目录 · 已索引 ' + (i.indexedFileCount || 0) + ' 个文件' + (i.sampleMode ? ' · 示例资料' : '') + '</small></div>' +
        '<div class="acts">' +
        (i.id === list.activeId ? '' : '<button class="secondary-btn" data-switch="' + esc(i.id) + '">切换</button>') +
        '<button class="secondary-btn" data-rename="' + esc(i.id) + '">重命名</button>' +
        '<button class="secondary-btn" data-remove="' + esc(i.id) + '">移除</button></div></div>';
    });
    html += '</div>';
    }

    if (available.length) {
    html += '<div class="form-card" style="max-width:none"><h3>可用岗位包目录</h3><div class="lib-grid">';
    available.forEach(function (p) {
      var planned = p.status === 'planned';
      html += '<div class="lib-card"><div class="top"><div class="assist-badge" style="background:' + (planned ? '#94a0b5' : '#315efb') + '">' + esc((p.name || '包')[0]) + '</div>' +
        '<div style="flex:1"><b>' + esc(p.name) + '</b><div style="margin-top:4px;display:flex;gap:5px;flex-wrap:wrap">' +
        '<span class="tag ' + (planned ? 'gray' : 'blue') + '">' + esc(p.origin) + '</span>' +
        '<span class="tag">' + esc(p.industry) + '</span>' +
        (p.installedCount ? '<span class="tag green">已装 ' + p.installedCount + '</span>' : '') + '</div></div></div>' +
        '<div class="foot"><small style="color:#94a0b5">v' + esc(p.version) + '</small>' +
        (planned ? '<span class="tag gray">待生产</span>'
          : '<button class="primary-btn" data-add="' + esc(p.id) + '">添加助手</button>') + '</div></div>';
    });
    html += '</div></div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', async function () {
        try {
          var r = await PA.app.call('library', 'add', { packageId: b.getAttribute('data-add') });
          await PA.app.reloadAll();
          PA.app.toast('已添加助手：' + r.name);
        } catch (e) { PA.app.toast('添加失败：' + e.message); }
      });
    });
    container.querySelectorAll('[data-switch]').forEach(function (b) {
      b.addEventListener('click', async function () {
        await PA.app.switchTo(b.getAttribute('data-switch'));
      });
    });
    container.querySelectorAll('[data-rename]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-rename');
        var inst = (PA.app.state.library.instances || []).find(function (x) { return x.id === id; });
        var name = window.prompt('助手名称', inst ? inst.name : '');
        if (name && name.trim()) {
          PA.app.call('library', 'rename', { id: id, name: name.trim() }).then(function () { return PA.app.reloadAll(); });
        }
      });
    });
    container.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-remove');
        if (!window.confirm('移除该助手？')) return;
        PA.app.call('library', 'remove', { id: id }).then(function () { return PA.app.reloadAll(); });
      });
    });
  }

  PA.libraryUI = { render: render };
})(window);
