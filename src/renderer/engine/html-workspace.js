/* HTML 工作台：在现有页面里嵌一个隔离的 webview，不替换整窗渲染进程。 */
(function (root) {
  'use strict';
  var PA = root.PA = root.PA || {};

  function esc(value) {
    return PA.blocks && PA.blocks.esc ? PA.blocks.esc(value) : String(value == null ? '' : value);
  }

  function showError(message) {
    var box = document.getElementById('htmlWorkspaceError');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<b>页面加载失败</b><span>' + esc(message) + '</span>';
  }

  function mount(container, state) {
    var cur = state.current || {};
    var ws = cur.workspace || {};
    if (!cur.instance) {
      container.innerHTML = '';
      return;
    }
    if (!cur.pkg && cur.packageError) {
      container.innerHTML = '<div class="empty"><b>工作台无法打开</b><p>' + esc(cur.packageError) + '</p></div>';
      return;
    }
    if (ws.type !== 'html') {
      container.innerHTML = '<div class="empty"><b>这个助手不能打开</b><p>' + esc(ws.error || '它使用的是已经去掉的旧工作台，请重新导入 HTML 助手。') + '</p></div>';
      return;
    }
    if (!ws.ready || !ws.url || !ws.partition) {
      container.innerHTML = '<div class="empty"><b>页面加载失败</b><p>' + esc(ws.error || '找不到工作台入口文件') + '</p></div>';
      return;
    }
    container.innerHTML = '<div class="html-workspace"><div class="html-workspace-error" id="htmlWorkspaceError" hidden></div></div>';
    var wrap = container.querySelector('.html-workspace');
    var view = document.createElement('webview');
    view.id = 'htmlWorkspace';
    view.setAttribute('partition', ws.partition);
    view.setAttribute('nodeintegration', 'false');
    view.setAttribute('nodeintegrationinsubframes', 'false');
    view.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes');
    view.addEventListener('did-fail-load', function (event) {
      if (event.isMainFrame === false) return;
      if (event.errorCode === -3) return;
      showError('无法打开工作台页面（' + (event.errorDescription || event.errorCode || '未知错误') + '）。请确认该助手的 workspace 入口文件仍然存在。');
    });
    view.addEventListener('crashed', function () {
      showError('工作台页面已崩溃。可以切换到其他助手后再切回来，重新加载页面。');
    });
    view.addEventListener('render-process-gone', function (event) {
      showError('工作台页面已退出' + (event && event.reason ? '（' + event.reason + '）' : '') + '。');
    });
    wrap.appendChild(view);
    view.setAttribute('src', ws.url);
  }

  PA.htmlWorkspace = { mount: mount };
})(window);
