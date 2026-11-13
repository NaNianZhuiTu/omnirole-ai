'use strict';
const { app, BrowserWindow } = require('electron');
require('./workspace-scheme');
const path = require('path');
const fs = require('fs');
const { PATHS, ensure } = require('./paths');
const library = require('./library');
const { RuntimeAdapter } = require('./runtime/adapter');
const localRuntime = require('./runtime/local-runtime');
const { register } = require('./ipc');
const menu = require('./menu');
const workspaceHost = require('./workspace-host');

let win = null;
let adapter = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    title: '全岗位 AI 工作助手',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#f2f5fa',
    // 菜单与产品名合并在同一行绘制；右上角的系统窗口按钮由 titleBarOverlay 保留
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#5b6577', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  menu.attach(win);
  menu.attachShortcuts(win);
  workspaceHost.install(win);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// 验收诊断钩子：只在设置 PA_VERIFY_OUT 时写文件，正常启动不产生任何副作用。
function dbg(line) {
  if (!process.env.PA_VERIFY_OUT) return;
  try { fs.appendFileSync(process.env.PA_VERIFY_OUT, line + '\n', 'utf8'); } catch (e) { /* 忽略 */ }
}

app.whenReady().then(() => {
  dbg('MAIN_READY PA_VERIFY=' + process.env.PA_VERIFY + ' isPackaged=' + app.isPackaged +
    ' resources=' + PATHS.resources + ' userData=' + PATHS.userData);
  try {
    ensure();
    library.init();
    require('./task-engine').recoverInterrupted();
    dbg('LIBRARY_INIT_OK');
    adapter = new RuntimeAdapter(localRuntime);
    register(adapter, () => win);
    createWindow();
    dbg('WINDOW_CREATED PA_VERIFY=' + process.env.PA_VERIFY);
    if (process.env.PA_VERIFY === '1') require('./verify').attach(win, app);
    if (process.env.PA_SHOTS === '1') require('./shots').attach(win, app);
  } catch (e) {
    dbg('MAIN_ERROR=' + (e && e.stack ? e.stack : e));
    console.error(e);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
