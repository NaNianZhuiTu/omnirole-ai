/* 来源追溯抽屉：每条数据都能点回具体文件、行号/条款、版本与原文片段。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};
  var B = PA.blocks;
  var drawer, mask, body;

  function esc(v) { return B.esc(v); }

  function init() {
    drawer = document.getElementById('sourceDrawer');
    mask = document.getElementById('drawerMask');
    body = document.getElementById('drawerBody');
    document.getElementById('drawerClose').addEventListener('click', close);
    mask.addEventListener('click', close);
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-srcref]') : null;
      if (!el || el.classList.contains('miller-file') || (el.closest && el.closest('#page-files'))) return;
      e.preventDefault();
      var src = B.getSource(Number(el.getAttribute('data-srcref')));
      if (src) open(src);
    });
  }

  function row(k, v) {
    return '<div class="kv-row"><div class="k">' + esc(k) + '</div><div class="v">' + (v || '未找到') + '</div></div>';
  }

  function open(src) {
    var inst = (PA.app.state.current && PA.app.state.current.instance) || {};
    var html = '';
    html += row('文件', esc(src.file || '未找到'));
    html += row('相对路径', esc(src.rel || ''));
    html += row('完整路径', esc(src.path || ''));
    html += row('定位', esc(src.locator || '未标注'));
    html += row('修改时间', esc(src.mtime ? new Date(src.mtime).toLocaleString('zh-CN') : ''));
    html += row('文件大小', src.size != null ? esc((src.size / 1024).toFixed(1)) + ' KB' : '');
    html += row('内容校验', esc(src.sha256 || ''));
    html += '<div class="excerpt-box"><b>原文片段</b><br>' + esc(src.excerpt || '未找到原文片段') + '</div>';
    html += '<div class="drawer-actions">' +
      '<button class="primary-btn" id="srcRevealBtn">打开所在文件夹</button>' +
      '<button class="secondary-btn" id="srcOpenBtn">打开文件</button>' +
      '<button class="secondary-btn" id="srcCopyBtn">复制路径</button></div>';
    body.innerHTML = html;
    drawer.classList.add('show'); mask.classList.add('show');

    document.getElementById('srcRevealBtn').addEventListener('click', function () {
      PA.app.call('system', 'reveal', { instanceId: inst.id, path: src.path });
    });
    document.getElementById('srcOpenBtn').addEventListener('click', function () {
      PA.app.call('system', 'open', { instanceId: inst.id, path: src.path });
    });
    document.getElementById('srcCopyBtn').addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(src.path || '');
      PA.app.toast('已复制路径');
    });
  }

  function close() {
    drawer.classList.remove('show'); mask.classList.remove('show');
  }

  PA.source = { init: init, open: open, close: close };
})(window);
