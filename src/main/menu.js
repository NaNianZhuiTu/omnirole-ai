/* 应用没有菜单栏。这里只保留全局快捷键：页面切换、AI 助手开关、重扫、设置。
 * 快捷键直接通过 menu:action 发给渲染层，由 app.js 的 handleMenuAction 处理。
 */
'use strict';
const { Menu } = require('electron');

let winRef = null;

function emit(action) {
  if (winRef && !winRef.isDestroyed()) winRef.webContents.send('menu:action', action);
}

function attach(win) {
  winRef = win;
  Menu.setApplicationMenu(null);
}

function attachShortcuts(win) {
  const pages = { '1': 'workbench', '2': 'files', '3': 'ai', '5': 'library', '6': 'settings' };
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const k = String(input.key || '').toLowerCase();
    const shift = !!input.shift, alt = !!input.alt;
    let action = null;
    if (!shift && !alt) {
      if (pages[k]) action = { type: 'go', page: pages[k] };
      else if (k === 'b') action = { type: 'toggle-chat' };
      else if (k === ',') action = { type: 'go', page: 'settings' };
    } else if (alt && !shift && k === 's') action = { type: 'reindex' };
    else if (shift && !alt && k === 'a') action = { type: 'go', page: 'library' };
    if (action) { event.preventDefault(); emit(action); }
  });
}

module.exports = { attach, attachShortcuts, emit };
