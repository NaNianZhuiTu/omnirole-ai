/* 把当前助手的 workspace 目录映射成 pawork://，并收紧 webview。
 * 协议挂在助手自己的 partition 上，不挂到桌面主窗口的默认会话。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { session } = require('electron');
const library = require('./library');
const { instanceDir } = require('./paths');
const { isInside } = require('./safe-path');
const {
  CSP,
  parseWorkspaceUrl,
  isWorkspaceDocumentUrl,
  resolveWorkspaceFile,
  reviewWebviewAttach,
  hardenWebPreferences
} = require('./workspace-protocol');

const PRELOAD = path.join(__dirname, 'workspace-preload.js');
const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const guestIds = new Map();
const pendingIds = [];
const hooked = new Set();

function mimeType(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.html':
    case '.htm': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function textResponse(status, message) {
  return new Response(message, {
    status: status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function openWorkspaceFile(workspaceRoot, rel) {
  const abs = resolveWorkspaceFile(workspaceRoot, rel);
  if (!fs.existsSync(abs)) return { missing: true };
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink() || !st.isFile()) return { rejected: true };
  if (st.size > MAX_ASSET_BYTES) return { tooBig: true };
  const realRoot = fs.realpathSync(workspaceRoot);
  const realFile = fs.realpathSync(abs);
  if (!isInside(realRoot, realFile)) return { rejected: true };
  return { file: realFile };
}

function serve(instanceId, request) {
  try {
    const cur = library.current();
    const type = cur.instance && (cur.instance.workspaceType || (cur.pkg && cur.pkg.workspaceType));
    if (!cur.instance || cur.instance.id !== instanceId || type !== 'html') {
      return textResponse(403, '只能打开当前助手的工作台');
    }
    const parsed = parseWorkspaceUrl(request.url);
    if (!parsed) return textResponse(400, '工作台地址不合法');
    const root = path.join(instanceDir(instanceId), 'workspace');
    if (!fs.existsSync(root)) return textResponse(404, '工作台目录不存在');
    const opened = openWorkspaceFile(root, parsed.rel);
    if (opened.missing) return textResponse(404, '工作台资源不存在');
    if (opened.rejected) return textResponse(403, '已拒绝越界访问');
    if (opened.tooBig) return textResponse(413, '工作台资源过大');
    const typeName = mimeType(opened.file);
    const headers = {
      'Content-Type': typeName,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    };
    if (typeName.indexOf('text/html') === 0) headers['Content-Security-Policy'] = CSP;
    return new Response(fs.readFileSync(opened.file), { status: 200, headers: headers });
  } catch (e) {
    return textResponse(400, '工作台资源读取失败');
  }
}

function ensureProtocol(instanceId) {
  const partition = 'persist:pa-' + instanceId;
  const ses = session.fromPartition(partition);
  if (hooked.has(partition)) return;
  hooked.add(partition);
  ses.protocol.handle('pawork', function (request) { return serve(instanceId, request); });
  ses.setPermissionRequestHandler(function (_wc, _permission, callback) { callback(false); });
}

function instanceFromEvent(event) {
  const senderId = event && event.sender && event.sender.id;
  const id = guestIds.get(senderId);
  if (!id) throw new Error('该接口仅允许当前助手的 HTML 工作台调用');
  const cur = library.current();
  if (!cur.instance || cur.instance.id !== id) throw new Error('当前助手已切换，已拒绝此操作');
  const type = cur.instance.workspaceType || (cur.pkg && cur.pkg.workspaceType);
  if (type !== 'html') throw new Error('当前助手不是 HTML 工作台');
  return id;
}

function install(win) {
  win.webContents.on('will-attach-webview', function (event, webPreferences, params) {
    const active = library.current();
    const activeId = active.instance && active.instance.id;
    const review = reviewWebviewAttach(params || {}, activeId);
    if (!review.ok) {
      event.preventDefault();
      return;
    }
    const hardened = hardenWebPreferences(webPreferences, PRELOAD);
    Object.keys(hardened).forEach(function (key) { webPreferences[key] = hardened[key]; });
    ensureProtocol(review.instanceId);
    pendingIds.push(review.instanceId);
  });

  win.webContents.on('did-attach-webview', function (_event, guest) {
    const instanceId = pendingIds.shift();
    if (instanceId) guestIds.set(guest.id, instanceId);
    guest.setWindowOpenHandler(function () { return { action: 'deny' }; });
    const blockNavigation = function (event, url) {
      if (!isWorkspaceDocumentUrl(url)) event.preventDefault();
    };
    guest.on('will-navigate', blockNavigation);
    guest.on('will-redirect', blockNavigation);
    guest.on('destroyed', function () { guestIds.delete(guest.id); });
  });
}

module.exports = { install, instanceFromEvent, serve };
