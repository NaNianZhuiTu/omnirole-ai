/* HTML 工作台可调用的基础接口。实例 ID 由主进程绑定，不从页面参数里取。
 * 读文件只允许当前实例已授权的目录；写入只允许该实例的 data/ 与 documents/。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const library = require('./library');
const reader = require('./file-reader');
const model = require('./model-gateway');
const { instanceDir, writeJson } = require('./paths');
const { isInside, safeRelative } = require('./safe-path');

const TEXT_EXT = new Set(['.txt', '.md', '.json', '.csv', '.log', '.html', '.htm', '.xml', '.docx', '.xlsx', '.xlsm']);
const DOC_EXT = { md: '.md', txt: '.txt', json: '.json' };

function requireObject(payload) {
  if (payload == null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('参数必须是对象');
  return payload;
}

function requireCurrent(instanceId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(instanceId || ''))) throw new Error('助手实例无效');
  const cur = library.current();
  if (!cur.instance || cur.instance.id !== instanceId) throw new Error('当前助手已切换，已拒绝此操作');
  const type = cur.instance.workspaceType || (cur.pkg && cur.pkg.workspaceType);
  if (type !== 'html') throw new Error('当前助手不是 HTML 工作台');
  return cur;
}

function requireBound(instanceId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(instanceId || ''))) throw new Error('助手实例无效');
  const found = (library.listInstances().instances || []).find(function (item) { return item.id === instanceId; });
  if (!found) throw new Error('助手实例不存在');
  if (found.workspaceType !== 'html') throw new Error('当前助手不是 HTML 工作台');
  return found;
}

function gate(instanceId, scope) {
  return scope === 'bound' ? requireBound(instanceId) : requireCurrent(instanceId);
}

function authorizedRoots(instanceId) {
  return library.getAuthorizedPaths(instanceId).map(function (root) {
    try { return fs.realpathSync(root); }
    catch (e) { return path.resolve(root); }
  });
}

function assertAuthorized(instanceId, target) {
  if (typeof target !== 'string' || !target.trim()) throw new Error('path 必须是字符串');
  if (target.indexOf('\0') !== -1) throw new Error('path 含有非法字符');
  if (!fs.existsSync(target)) throw new Error('路径不存在');
  let abs;
  try { abs = fs.realpathSync(path.resolve(target)); }
  catch (e) { throw new Error('无法解析路径'); }
  const ok = authorizedRoots(instanceId).some(function (root) {
    return isInside(root, abs);
  });
  if (!ok) throw new Error('该路径不在当前助手的授权目录内，已拒绝操作。');
  return abs;
}

function entryKind(dir, name) {
  const child = path.join(dir, name);
  let st;
  try { st = fs.lstatSync(child); }
  catch (e) { return null; }
  if (st.isSymbolicLink()) return null;
  if (st.isDirectory()) return { name: name, path: child, kind: 'dir', size: null, mtime: null };
  if (!st.isFile()) return null;
  return { name: name, path: child, kind: 'file', size: st.size, mtime: st.mtime.toISOString() };
}

function listFiles(instanceId, payload) {
  requireCurrent(instanceId);
  const body = requireObject(payload);
  if (body.path == null || body.path === '') {
    const entries = library.getAuthorizedPaths(instanceId).map(function (root) {
      const abs = path.resolve(root);
      return { name: path.basename(abs), path: abs, kind: 'dir', size: null, mtime: null };
    });
    return { path: '', entries: entries };
  }
  if (typeof body.path !== 'string') throw new Error('path 必须是字符串');
  const abs = assertAuthorized(instanceId, body.path);
  if (!fs.statSync(abs).isDirectory()) throw new Error('不是文件夹');
  const listed = reader.listDirectory(abs);
  const entries = [];
  (listed.entries || []).forEach(function (item) {
    const safe = entryKind(abs, item.name);
    if (!safe) return;
    try { assertAuthorized(instanceId, safe.path); }
    catch (e) { return; }
    entries.push(safe);
  });
  return { path: abs, entries: entries, truncated: !!listed.truncated };
}

function searchFiles(instanceId, payload, scope) {
  gate(instanceId, scope);
  const body = requireObject(payload);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) throw new Error('query 不能为空');
  if (query.length > 80) throw new Error('query 过长');
  let limit = 20;
  if (body.limit != null) {
    if (typeof body.limit !== 'number' || !Number.isFinite(body.limit)) throw new Error('limit 必须是数字');
    limit = Math.max(1, Math.min(50, Math.floor(body.limit)));
  }
  let roots = authorizedRoots(instanceId);
  if (body.path) {
    const abs = assertAuthorized(instanceId, body.path);
    roots = [abs];
  }
  const needle = query.toLowerCase();
  const hits = [];
  roots.forEach(function (root) {
    if (hits.length >= limit) return;
    reader.listFiles(root, '**/*', 400).forEach(function (file) {
      if (hits.length >= limit) return;
      let real;
      try { real = fs.realpathSync(file.abs); }
      catch (e) { return; }
      if (!isInside(root, real)) return;
      const nameHit = file.rel.toLowerCase().indexOf(needle) !== -1;
      let excerpt = '';
      if (!nameHit) {
        try {
          const st = fs.statSync(real);
          if (!st.isFile() || st.size > 262144) return;
          const text = reader.readText(real);
          const at = text.toLowerCase().indexOf(needle);
          if (at < 0) return;
          excerpt = text.slice(Math.max(0, at - 40), at + query.length + 80).replace(/\s+/g, ' ');
        } catch (e) { return; }
      }
      hits.push({
        name: path.basename(file.rel),
        path: real,
        rel: file.rel,
        excerpt: excerpt
      });
    });
  });
  return { query: query, hits: hits };
}

function readFile(instanceId, payload, scope) {
  gate(instanceId, scope);
  const body = requireObject(payload);
  if (typeof body.path !== 'string' || !body.path.trim()) throw new Error('path 必须是字符串');
  const abs = assertAuthorized(instanceId, body.path);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('只能读取文件');
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new Error('files.read 只读取文本资料，图片和页面请用工作台里的相对路径');
  if (st.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，已拒绝读取');
  let maxChars = 20000;
  if (body.maxChars != null) {
    if (typeof body.maxChars !== 'number' || !Number.isFinite(body.maxChars)) throw new Error('maxChars 必须是数字');
    maxChars = Math.max(1, Math.min(100000, Math.floor(body.maxChars)));
  }
  const text = reader.readText(abs);
  return {
    path: abs,
    name: path.basename(abs),
    size: st.size,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars
  };
}

function dataPath(instanceId, name) {
  const rel = safeRelative(name, 'name');
  if (!rel.toLowerCase().endsWith('.json')) throw new Error('数据文件必须是 .json');
  if (rel.split('/').length > 6) throw new Error('目录层级过深');
  const baseName = rel.split('/').pop();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(baseName)) throw new Error('文件名不合法');
  const root = path.join(instanceDir(instanceId), 'data');
  const abs = path.resolve(root, ...rel.split('/'));
  if (!isInside(root, abs)) throw new Error('数据路径超出当前助手的 data 目录');
  return { rel: rel, abs: abs, root: root };
}

function readData(instanceId, payload, scope) {
  gate(instanceId, scope);
  const body = requireObject(payload);
  if (typeof body.name !== 'string') throw new Error('name 必须是字符串');
  const file = dataPath(instanceId, body.name);
  if (!fs.existsSync(file.abs)) throw new Error('数据不存在：' + file.rel);
  const st = fs.lstatSync(file.abs);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('数据文件不可用：' + file.rel);
  if (!isInside(fs.realpathSync(file.root), fs.realpathSync(file.abs))) throw new Error('数据路径超出当前助手的 data 目录');
  try { return { name: file.rel, value: JSON.parse(fs.readFileSync(file.abs, 'utf8')) }; }
  catch (e) { throw new Error('数据文件不是合法 JSON'); }
}

function assertWritableTarget(root, abs) {
  let realRoot;
  try { realRoot = fs.realpathSync(root); }
  catch (e) { throw new Error('写入目录不可用'); }
  const instanceRoot = path.resolve(root, '..');
  let realInstance;
  try { realInstance = fs.realpathSync(instanceRoot); }
  catch (e) { realInstance = instanceRoot; }
  if (!isInside(realInstance, realRoot)) throw new Error('写入目录超出当前助手');
  let realParent;
  try { realParent = fs.realpathSync(path.dirname(abs)); }
  catch (e) { throw new Error('写入目录不可用'); }
  if (!isInside(realRoot, realParent)) throw new Error('路径超出允许范围');
  let st = null;
  try { st = fs.lstatSync(abs); }
  catch (e) { st = null; }
  if (!st) return;
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('拒绝通过符号链接写入');
  let realFile;
  try { realFile = fs.realpathSync(abs); }
  catch (e) { throw new Error('拒绝通过符号链接写入'); }
  if (!isInside(realRoot, realFile)) throw new Error('路径超出允许范围');
}

function writeData(instanceId, payload, scope) {
  gate(instanceId, scope);
  const body = requireObject(payload);
  if (typeof body.name !== 'string') throw new Error('name 必须是字符串');
  if (!Object.prototype.hasOwnProperty.call(body, 'value') || typeof body.value === 'undefined') {
    throw new Error('value 不能为空');
  }
  const file = dataPath(instanceId, body.name);
  let text;
  try { text = JSON.stringify(body.value); }
  catch (e) { throw new Error('value 必须是可保存的 JSON 数据'); }
  if (typeof text !== 'string') throw new Error('value 必须是可保存的 JSON 数据');
  if (text.length > 256 * 1024) throw new Error('数据过大');
  const value = JSON.parse(text);
  fs.mkdirSync(path.dirname(file.abs), { recursive: true });
  assertWritableTarget(file.root, file.abs);
  writeJson(file.abs, value);
  return { name: file.rel, bytes: Buffer.byteLength(text) };
}

function documentPath(instanceId, name, format) {
  let rel = safeRelative(name, 'name');
  const ext = path.extname(rel).toLowerCase();
  if (format != null) {
    if (typeof format !== 'string' || !DOC_EXT[format]) throw new Error('format 只能是 md、txt 或 json');
    if (!ext) rel += DOC_EXT[format];
    else if (ext !== DOC_EXT[format]) throw new Error('文件后缀与 format 不一致');
  } else if (!ext || !Object.keys(DOC_EXT).some(function (key) { return DOC_EXT[key] === ext; })) {
    throw new Error('文件名需要以 .md、.txt 或 .json 结尾');
  }
  if (rel.split('/').length > 6) throw new Error('目录层级过深');
  const baseName = rel.split('/').pop();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(baseName)) throw new Error('文件名不合法');
  const root = path.join(instanceDir(instanceId), 'documents');
  const abs = path.resolve(root, ...rel.split('/'));
  if (!isInside(root, abs)) throw new Error('文档路径超出当前助手的 documents 目录');
  return { rel: rel, abs: abs, root: root };
}

function listDocuments(instanceId, scope) {
  gate(instanceId, scope);
  const root = path.join(instanceDir(instanceId), 'documents');
  const documents = [];
  function walk(dir) {
    if (documents.length >= 500 || !fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (name) {
      if (documents.length >= 500 || name.charAt(0) === '.') return;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) { walk(abs); return; }
      if (!st.isFile()) return;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      documents.push({ rel: rel, size: st.size, mtime: st.mtime.toISOString() });
    });
  }
  walk(root);
  return { documents: documents };
}

function createDocument(instanceId, payload, scope) {
  gate(instanceId, scope);
  const body = requireObject(payload);
  if (typeof body.name !== 'string') throw new Error('name 必须是字符串');
  if (typeof body.content !== 'string') throw new Error('content 必须是字符串');
  if (body.content.length > 200000) throw new Error('文档内容过长');
  const file = documentPath(instanceId, body.name, body.format);
  fs.mkdirSync(path.dirname(file.abs), { recursive: true });
  assertWritableTarget(file.root, file.abs);
  fs.writeFileSync(file.abs, body.content, 'utf8');
  return { rel: file.rel, bytes: Buffer.byteLength(body.content) };
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(function (item) { return typeof item === 'string'; }).slice(0, 40).map(function (item) {
    return item.length > 200 ? item.slice(0, 200) : item;
  });
}

function getInfo(instanceId) {
  const cur = requireCurrent(instanceId);
  const inst = cur.instance;
  const pkg = cur.pkg || {};
  return {
    id: inst.id,
    name: inst.name,
    packageId: inst.packageId,
    packageVersion: inst.packageVersion,
    industry: pkg.industry || '',
    role: pkg.role || '',
    workspaceType: 'html',
    accent: inst.accent || pkg.accent || '',
    icon: inst.icon || pkg.icon || '',
    duties: stringList(pkg.duties),
    modules: stringList(pkg.modules),
    rules: stringList(pkg.rules)
  };
}

function getWorkspace(instanceId) {
  const cur = requireCurrent(instanceId);
  const ws = cur.workspace || {};
  return {
    instanceId: instanceId,
    type: 'html',
    entry: ws.entry || 'index.html',
    ready: !!ws.ready,
    writable: ['data', 'documents'],
    appVersion: require('../../package.json').version
  };
}

async function chat(instanceId, payload, adapter) {
  const cur = requireCurrent(instanceId);
  const body = requireObject(payload);
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error('messages 必须是非空数组');
  if (body.messages.length > 30) throw new Error('消息条数过多');
  const messages = body.messages.map(function (message, index) {
    if (!message || typeof message !== 'object') throw new Error('messages[' + index + '] 不合法');
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error('messages[' + index + '].role 只能是 user 或 assistant');
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('messages[' + index + '].content 必须是非空字符串');
    }
    if (message.content.length > 8000) throw new Error('messages[' + index + '].content 过长');
    return { role: message.role, content: message.content };
  });
  if (!messages.some(function (message) { return message.role === 'user'; })) {
    throw new Error('至少需要一条 user 消息');
  }
  if (!adapter || typeof adapter.chat !== 'function') throw new Error('当前不能发起对话');
  const result = await adapter.chat({
    pkg: cur.pkg,
    index: cur.index,
    settings: model.getSettings(),
    messages: messages
  });
  const text = result && typeof result.text === 'string' ? result.text : '';
  const lastUser = messages.filter(function (message) { return message.role === 'user'; }).pop();
  library.appendChat(instanceId, { role: 'user', content: lastUser ? lastUser.content : '' });
  library.appendChat(instanceId, { role: 'assistant', content: text });
  return { text: text };
}

module.exports = {
  getInfo,
  getWorkspace,
  listFiles,
  searchFiles,
  readFile,
  readData,
  writeData,
  listDocuments,
  createDocument,
  chat
};
