/* HTML 工作台地址与 webview 附加策略。这里不碰 Electron，方便单测。
 * 页面只能通过 pawork://desk/<相对路径> 读取【当前实例的 workspace 目录】。
 */
'use strict';
const path = require('path');
const { isInside } = require('./safe-path');

const PARTITION_PREFIX = 'persist:pa-';
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

function parseWorkspaceUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); }
  catch (e) { return null; }
  if (url.protocol !== 'pawork:') return null;
  if (url.hostname !== 'desk') return null;
  if (url.username || url.password || url.port) return null;
  const pieces = url.pathname.split('/').filter(Boolean);
  const parts = [];
  for (let i = 0; i < pieces.length; i++) {
    let decoded;
    try { decoded = decodeURIComponent(pieces[i]); }
    catch (e) { return null; }
    if (!decoded || decoded === '.' || decoded === '..') return null;
    if (/[\\/\0]|[<>:"|?*]/.test(decoded) || decoded.indexOf(':') !== -1) return null;
    parts.push(decoded);
  }
  if (!parts.length) return null;
  return { rel: parts.join('/') };
}

function isWorkspaceDocumentUrl(raw) {
  const parsed = parseWorkspaceUrl(raw);
  return !!(parsed && /\.html?$/i.test(parsed.rel));
}

function resolveWorkspaceFile(workspaceRoot, rel) {
  const parsed = typeof rel === 'string' ? { rel: rel } : rel;
  if (!parsed || !parsed.rel || parsed.rel.split('/').some(function (part) {
    return !part || part === '.' || part === '..' || part.indexOf(':') !== -1;
  })) {
    throw new Error('工作台地址不合法');
  }
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(root, ...parsed.rel.split('/'));
  if (!isInside(root, abs)) throw new Error('路径越界');
  return abs;
}

function reviewWebviewAttach(params, activeInstanceId) {
  const errors = [];
  const partition = params && params.partition ? String(params.partition) : '';
  const matched = new RegExp('^' + PARTITION_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([A-Za-z0-9_-]+)$').exec(partition);
  let instanceId = null;
  if (!matched) errors.push('工作台分区不合法');
  else {
    instanceId = matched[1];
    if (!activeInstanceId || instanceId !== activeInstanceId) errors.push('工作台分区与当前助手不一致');
  }
  const src = params && params.src ? String(params.src) : '';
  if (!isWorkspaceDocumentUrl(src)) errors.push('工作台地址不合法');
  return { ok: errors.length === 0, errors: errors, instanceId: instanceId };
}

function hardenWebPreferences(prefs, preloadPath) {
  const next = Object.assign({}, prefs || {});
  next.preload = preloadPath;
  next.nodeIntegration = false;
  next.nodeIntegrationInSubFrames = false;
  next.nodeIntegrationInWorker = false;
  next.contextIsolation = true;
  next.sandbox = true;
  next.webSecurity = true;
  next.allowRunningInsecureContent = false;
  return next;
}

module.exports = {
  PARTITION_PREFIX,
  CSP,
  parseWorkspaceUrl,
  isWorkspaceDocumentUrl,
  resolveWorkspaceFile,
  reviewWebviewAttach,
  hardenWebPreferences
};
