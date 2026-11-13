/* 在真实 Electron 窗口里加载 HTML 工作台，检查样式、脚本、图片和隔离接口。
 * 由 tools/run-electron.js 启动，不要用普通 node 运行。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const userData = path.join(root, '.embed-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
require('../src/main/workspace-scheme');

function fail(error) {
  console.error('\n[EMBED ERROR] ' + (error && error.stack ? error.stack : error));
  app.exit(1);
}

const timer = setTimeout(function () {
  fail(new Error('页面测试超时'));
}, 30000);

function colorOk(value) {
  const text = String(value || '').replace(/\s/g, '').toLowerCase();
  return text === 'rgb(255,244,240)' || text === 'rgba(255,244,240,1)' || text === '#fff4f0';
}

async function run() {
  const library = require('../src/main/library');
  const { instanceDir } = require('../src/main/paths');
  const workspaceHost = require('../src/main/workspace-host');
  const { register } = require('../src/main/ipc');
  const { RuntimeAdapter } = require('../src/main/runtime/adapter');
  const localRuntime = require('../src/main/runtime/local-runtime');

  library.init();
  const imported = library.importPackage(path.join(root, 'samples', 'html-fire-assistant'));
  const first = library.addInstance(imported.id, '消防甲');
  const second = library.addInstance(imported.id, '消防乙');
  const marker = 'INSTANCE_A_ONLY';
  fs.appendFileSync(path.join(instanceDir(first.id), 'workspace', 'index.html'), '\n<p>' + marker + '</p>\n', 'utf8');
  const current = library.current();
  if (!current.instance || current.instance.id !== second.id) throw new Error('打开窗口前应停在第二个实例');
  if (!current.workspace || !current.workspace.ready) throw new Error(current.workspace && current.workspace.error || '工作台未就绪');

  const parentHtml = path.join(userData, 'parent.html');
  fs.writeFileSync(parentHtml, '<!DOCTYPE html><html><body style="margin:0;height:100vh">' +
    '<webview id="view" partition="' + current.workspace.partition + '" src="' + current.workspace.url +
    '" nodeintegration="false" webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes" style="width:100%;height:100%"></webview>' +
    '</body></html>', 'utf8');

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  register(new RuntimeAdapter(localRuntime), function () { return win; });
  workspaceHost.install(win);
  await new Promise(function (resolve, reject) {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', function (_event, code, desc) {
      reject(new Error('宿主页加载失败 ' + code + ' ' + desc));
    });
    win.loadFile(parentHtml);
  });

  const otherFile = path.join(instanceDir(first.id), 'workspace', 'index.html');
  const probe = `(async function () {
    const otherPath = ${JSON.stringify(otherFile)};
    const out = {};
    for (let i = 0; i < 40; i++) {
      if (document.body && document.body.getAttribute('data-js') === 'ok') break;
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
    }
    out.text = document.body ? document.body.innerText : '';
    out.js = document.body ? document.body.getAttribute('data-js') : '';
    out.bg = getComputedStyle(document.body).backgroundColor;
    const img = document.getElementById('mark');
    if (img && !img.complete) {
      await new Promise(function (resolve) {
        img.addEventListener('load', resolve);
        img.addEventListener('error', resolve);
        setTimeout(resolve, 2000);
      });
    }
    out.img = !!(img && img.complete && img.naturalWidth > 0);
    out.node = {
      requireType: typeof require,
      processType: typeof process,
      nodeVersion: (typeof process !== 'undefined' && process.versions) ? (process.versions.node || '') : ''
    };
    out.desktopKeys = window.desktop ? Object.keys(window.desktop).sort() : [];
    out.hasLibrary = !!(window.desktop && window.desktop.library);
    out.hasInvoke = !!(window.desktop && (window.desktop.invoke || window.desktop.ipcRenderer));
    try { out.info = await window.desktop.assistant.getInfo(); }
    catch (e) { out.infoError = e.message; }
    try {
      await window.desktop.data.write({ name: 'note.json', value: { marker: 'from-page' }, instanceId: 'not-real' });
      out.write = 'ok';
    } catch (e) { out.write = e.message; }
    try { await window.desktop.data.read({ name: '../package/assistant.json' }); out.traversal = 'allowed'; }
    catch (e) { out.traversal = e.message; }
    try { await window.desktop.files.read({ path: otherPath }); out.other = 'allowed'; }
    catch (e) { out.other = e.message; }
    try { await window.desktop.files.read({ path: ${JSON.stringify('C:\\Windows\\win.ini')} }); out.win = 'allowed'; }
    catch (e) { out.win = e.message; }
    try {
      const res = await fetch('file:///C:/Windows/win.ini');
      out.fileFetch = res && res.ok ? 'allowed' : 'blocked';
    } catch (e) { out.fileFetch = 'blocked'; }
    try {
      const chat = await window.desktop.ai.chat({ messages: [{ role: 'user', content: 'ping' }] });
      out.ai = chat && chat.text ? 'unexpected' : 'empty';
    } catch (e) { out.ai = e.message; }
    try {
      await window.desktop.documents.create({ name: '记录.md', content: '第一条', format: 'md' });
      out.docs = await window.desktop.documents.list();
    } catch (e) { out.docsError = e.message; }
    return out;
  })()`;

  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const view = document.getElementById('view');
      let url = '';
      for (let i = 0; i < 80; i++) {
        try { url = view.getURL() || ''; } catch (e) { url = ''; }
        if (url.indexOf('pawork:') === 0) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (url.indexOf('pawork:') !== 0) throw new Error('工作台没有在程序内打开，当前地址：' + url);
      return await view.executeJavaScript(${JSON.stringify(probe)});
    })()`,
    true
  );
  console.log('EMBED_RESULT ' + JSON.stringify(result));
  if (!result || result.text.indexOf('脚本已运行') < 0) throw new Error('页面脚本没有运行');
  if (result.text.indexOf(marker) !== -1) throw new Error('加载到了另一个实例的页面');
  if (result.js !== 'ok') throw new Error('页面脚本标记缺失');
  if (!result.img) throw new Error('图片没有加载');
  if (!colorOk(result.bg)) throw new Error('CSS 没有生效：' + result.bg);
  if (result.node.requireType !== 'undefined' || result.node.nodeVersion) {
    throw new Error('页面可以访问 Node：' + JSON.stringify(result.node));
  }
  if (result.hasLibrary || result.hasInvoke) throw new Error('页面暴露了未开放的接口');
  if (result.desktopKeys.join(',') !== 'ai,assistant,data,documents,files,workspace') {
    throw new Error('接口清单不对：' + result.desktopKeys.join(','));
  }
  if (!result.info || result.info.id !== second.id) throw new Error('getInfo 失败：' + (result.infoError || ''));
  if (result.write !== 'ok') throw new Error('data.write 失败：' + result.write);
  if (!result.traversal || result.traversal === 'allowed') throw new Error('路径穿越没有被拒绝');
  if (result.other === 'allowed' || result.win === 'allowed') throw new Error('页面读到了未授权文件');
  if (result.fileFetch === 'allowed') throw new Error('页面可以直接请求本机 file 地址');
  if (!result.ai || result.ai.indexOf('尚未配置模型') < 0) throw new Error('未配置模型时没有明确失败：' + result.ai);
  if (!result.docs || !result.docs.documents.some(function (item) { return item.rel === '记录.md'; })) {
    throw new Error('文档没有写入当前实例：' + (result.docsError || ''));
  }
  if (!fs.existsSync(path.join(instanceDir(second.id), 'data', 'note.json'))) throw new Error('数据没有落在当前实例');
  if (fs.existsSync(path.join(instanceDir(first.id), 'data', 'note.json'))) throw new Error('数据写进了另一个实例');
  if (fs.readFileSync(path.join(instanceDir(first.id), 'workspace', 'index.html'), 'utf8').indexOf(marker) < 0) {
    throw new Error('第一个实例自己的修改丢失了');
  }

  const shell = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(root, 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  workspaceHost.install(shell);
  await new Promise(function (resolve, reject) {
    shell.webContents.once('did-finish-load', resolve);
    shell.webContents.once('did-fail-load', function (_event, code, desc) {
      reject(new Error('主界面加载失败 ' + code + ' ' + desc));
    });
    shell.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
  });
  const shellView = await shell.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 50; i++) {
      if (document.querySelector('#page-workbench webview')) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const nav = Array.from(document.querySelectorAll('#navList .nav-item')).map(item => item.textContent.trim());
    PA.app.go('files');
    await new Promise(r => setTimeout(r, 200));
    const files = !!document.querySelector('#addFolderBtn');
    PA.app.go('ai');
    await new Promise(r => setTimeout(r, 200));
    const chatBox = !!document.querySelector('#chatInput');
    let ai = '';
    try {
      await PA.app.call('chat', 'send', {
        instanceId: PA.app.state.current.instance.id,
        requestId: 'shell-chat',
        messages: [{ role: 'user', content: '你好' }]
      });
      ai = 'unexpected';
    } catch (e) { ai = e.message; }
    return {
      webview: document.querySelectorAll('#page-workbench webview').length,
      panels: document.querySelectorAll('#page-workbench .panel').length,
      nav: nav,
      files: files,
      chatBox: chatBox,
      ai: ai
    };
  })()`, true);
  console.log('SHELL_VIEW ' + JSON.stringify(shellView));
  if (shellView.webview < 1 || shellView.panels !== 0) throw new Error('主界面没有只打开 HTML 工作台');
  if (shellView.nav.join(',') !== '岗位工作台,本地资料,AI 助手') {
    throw new Error('工作区入口变了：' + shellView.nav.join(','));
  }
  if (!shellView.files) throw new Error('本地资料页丢了');
  if (!shellView.chatBox) throw new Error('AI 助手页丢了');
  if (!shellView.ai || shellView.ai.indexOf('尚未配置模型') < 0) {
    throw new Error('主界面对话没有给出明确结果：' + shellView.ai);
  }

  console.log('EMBED_OK');
  clearTimeout(timer);
  app.exit(0);
}

app.whenReady().then(run).catch(fail);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
