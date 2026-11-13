/* 助手库：一次安装、多个助手、模板与实例分离。
 *
 * 岗位包 = 模板（纯数据，可分发/升级）
 * 助手实例 = 用户自己的一份（岗位包快照 + 授权目录 + 索引 + 对话），永远留在本机
 * 资料隔离靠两点：实例目录互相独立；索引器只读取该实例 authorized-paths.json 里的目录。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { PATHS, ensure, instanceDir, instanceFile, readJson, writeJson } = require('./paths');
const loader = require('./package-loader');
const indexer = require('./indexer');
const trace = require('./trace');

function safeId(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id || ''))) throw new Error('非法的助手 ID');
  return id;
}

function registry() {
  return readJson(PATHS.registry, { schemaVersion: '1.0', activeId: null, instances: [] });
}
function saveRegistry(r) { writeJson(PATHS.registry, r); }

function importedCatalog() {
  return readJson(path.join(PATHS.imported, 'imported-catalog.json'), { packages: [] });
}
function saveImportedCatalog(c) {
  writeJson(path.join(PATHS.imported, 'imported-catalog.json'), c);
}

function findPackageSource(packageId) {
  const builtin = readJson(PATHS.catalog, { packages: [] }).packages.find(p => p.id === packageId && p.status !== 'planned');
  if (builtin) return { catalog: builtin, load: () => loader.loadBuiltin(packageId), builtin: true };
  const imported = importedCatalog().packages.find(p => p.id === packageId);
  if (imported) {
    return {
      catalog: imported, builtin: false,
      load: () => loader.parseAndValidate(fs.readFileSync(imported.entry, 'utf8'), packageId)
    };
  }
  return null;
}

/** 目录清单：内置 + 本机导入 + 远端（远端只留接口，本版不启用网络下载）。 */
function available() {
  const local = readJson(PATHS.catalog, { packages: [] });
  const imported = importedCatalog();
  const r = registry();
  const all = local.packages.concat(imported.packages);
  return all.map(p => ({
    ...p,
    origin: p.builtin ? '内置' : (p.origin || '本机导入'),
    installedCount: r.instances.filter(i => i.packageId === p.id).length
  }));
}

function listInstances() {
  const r = registry();
  return {
    activeId: r.activeId,
    instances: r.instances.map(i => ({
      ...i,
      authorizedPathCount: getAuthorizedPaths(i.id).length,
      indexedFileCount: (indexer.loadIndex(i.id) || { summary: {} }).summary.fileCount || 0
    }))
  };
}

function getAuthorizedPaths(id) {
  safeId(id);
  return readJson(instanceFile(id, 'authorized-paths.json'), { paths: [] }).paths || [];
}

function setAuthorizedPaths(id, paths) {
  safeId(id);
  const cleaned = [];
  (paths || []).forEach(p => {
    try {
      const abs = path.resolve(String(p));
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && cleaned.indexOf(abs) === -1) cleaned.push(abs);
    } catch (e) { /* 忽略无效路径 */ }
  });
  writeJson(instanceFile(id, 'authorized-paths.json'), { paths: cleaned, updatedAt: new Date().toISOString() });
  trace.append(id, 'authorize-paths', { count: cleaned.length });
  return cleaned;
}

function createInstanceFiles(id, pkg, name, options) {
  const dir = instanceDir(id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(instanceFile(id, 'package.json'), pkg);
  writeJson(instanceFile(id, 'chat.json'), emptyChat());
  writeJson(instanceFile(id, 'meta.json'), { name, createdAt: new Date().toISOString(), sampleMode: !!options.sampleMode });
  if (!fs.existsSync(instanceFile(id, 'authorized-paths.json'))) {
    writeJson(instanceFile(id, 'authorized-paths.json'), { paths: [] });
  }
}

function reindexInstance(instanceId, pkgOverride) {
  safeId(instanceId);
  const r = registry();
  const inst = r.instances.find(i => i.id === instanceId);
  if (!inst) throw new Error('助手实例不存在');
  const pkg = pkgOverride || loader.loadForInstance(instanceId, inst.packageId).pkg;
  const instance = { id: instanceId, authorizedPaths: getAuthorizedPaths(instanceId) };
  return indexer.reindex(instance, pkg);
}

function addInstance(packageId, name, options) {
  const source = findPackageSource(packageId);
  if (!source) throw new Error('目录中找不到该岗位包：' + packageId);
  const { pkg } = source.load();
  const id = safeId(packageId + '-' + Date.now().toString(36));
  const label = name || pkg.name;
  const opts = options || {};
  createInstanceFiles(id, pkg, label, opts);

  if (opts.authorizedPaths && opts.authorizedPaths.length) setAuthorizedPaths(id, opts.authorizedPaths);

  const r = registry();
  r.instances.push({
    id, name: label, packageId: pkg.id, packageVersion: pkg.version,
    createdAt: new Date().toISOString(), sampleMode: !!opts.sampleMode,
    accent: pkg.accent || '#315efb', icon: pkg.icon || '助'
  });
  r.activeId = id;
  saveRegistry(r);
  trace.append(id, 'add-instance', { packageId: pkg.id, packageVersion: pkg.version, name: label });
  reindexInstance(id, pkg);
  return { id, name: label, packageId: pkg.id };
}

function switchAssistant(id) {
  safeId(id);
  const r = registry();
  if (!r.instances.some(i => i.id === id)) throw new Error('助手实例不存在');
  r.activeId = id;
  saveRegistry(r);
  trace.append(id, 'switch-instance', {});
  return current();
}

function removeInstance(id) {
  safeId(id);
  const r = registry();
  const before = r.instances.length;
  r.instances = r.instances.filter(i => i.id !== id);
  if (r.activeId === id) r.activeId = r.instances.length ? r.instances[0].id : null;
  saveRegistry(r);
  // 只从列表移除，磁盘上的资料与历史保留，避免不可逆的数据丢失
  if (before !== r.instances.length) trace.append(id, 'remove-instance', { keptOnDisk: true });
  return listInstances();
}

function renameInstance(id, name) {
  safeId(id);
  const r = registry();
  const inst = r.instances.find(i => i.id === id);
  if (!inst) throw new Error('助手实例不存在');
  inst.name = String(name || '').trim() || inst.name;
  saveRegistry(r);
  writeJson(instanceFile(id, 'meta.json'), {
    name: inst.name, createdAt: inst.createdAt, sampleMode: !!inst.sampleMode
  });
  return listInstances();
}

function importPackage(filePath) {
  const { pkg, warnings } = loader.importFromFile(filePath);
  const targetDir = path.join(PATHS.imported, pkg.id, pkg.version);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'package.json');
  fs.writeFileSync(target, JSON.stringify(pkg, null, 2), 'utf8');

  const c = importedCatalog();
  c.packages = c.packages.filter(p => !(p.id === pkg.id && p.version === pkg.version));
  c.packages.push({
    id: pkg.id, name: pkg.name, version: pkg.version, industry: pkg.industry,
    role: pkg.role, builtin: false, origin: '本机导入',
    entry: target, status: 'ready'
  });
  saveImportedCatalog(c);
  trace.append('library', 'import-package', { id: pkg.id, version: pkg.version, from: path.basename(filePath) });
  return { id: pkg.id, name: pkg.name, version: pkg.version, warnings };
}

/** 切换助手时一次性返回该助手的完整上下文（岗位包 + 索引 + 对话），避免串台。 */
function current() {
  const r = registry();
  const inst = r.instances.find(i => i.id === r.activeId) || r.instances[0] || null;
  if (!inst) return { instance: null, pkg: null, index: null, chat: emptyChat(), authorizedPaths: [] };
  safeId(inst.id);
  let pkg;
  try { pkg = loader.loadForInstance(inst.id, inst.packageId).pkg; }
  catch (e) { pkg = null; }
  return {
    instance: inst,
    pkg,
    index: indexer.loadIndex(inst.id),
    chat: readChat(inst.id),
    authorizedPaths: getAuthorizedPaths(inst.id),
    packageError: pkg ? null : '岗位包快照校验失败，该助手暂不可用'
  };
}

function blankThread() {
  const now = new Date().toISOString();
  return {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function emptyChat() {
  const thread = blankThread();
  return { activeId: thread.id, threads: [thread], messages: [] };
}

function titleFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '新对话';
  return s.length > 36 ? s.slice(0, 36) : s;
}

/** 旧的单条 chat.json（只有 messages）读出来时折成一条历史对话，messages 始终指向当前这条。 */
function normalizeChat(raw) {
  if (raw && Array.isArray(raw.threads) && raw.threads.length) {
    const threads = raw.threads.map(t => ({
      id: String(t.id || ('t' + Math.random().toString(36).slice(2, 8))),
      title: String(t.title || '新对话'),
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
      messages: Array.isArray(t.messages) ? t.messages.map(m => ({ ...m })) : []
    }));
    const active = threads.find(t => t.id === raw.activeId) || threads[0];
    return { activeId: active.id, threads, messages: active.messages };
  }
  const messages = raw && Array.isArray(raw.messages) ? raw.messages.map(m => ({ ...m })) : [];
  const firstUser = messages.find(m => m.role === 'user');
  const thread = {
    id: 't-main',
    title: firstUser ? titleFrom(firstUser.content) : '新对话',
    createdAt: (messages[0] && messages[0].at) || new Date().toISOString(),
    updatedAt: (messages.length ? messages[messages.length - 1].at : null) || new Date().toISOString(),
    messages
  };
  return { activeId: thread.id, threads: [thread], messages };
}

function writeChat(id, chat) {
  const active = chat.threads.find(t => t.id === chat.activeId) || chat.threads[0];
  const stored = { activeId: active.id, threads: chat.threads, messages: active.messages };
  writeJson(instanceFile(id, 'chat.json'), stored);
  return { activeId: stored.activeId, threads: stored.threads, messages: stored.messages };
}

function readChat(id) {
  safeId(id);
  return normalizeChat(readJson(instanceFile(id, 'chat.json'), null));
}

function appendChat(id, message) {
  safeId(id);
  const chat = readChat(id);
  const thread = chat.threads.find(t => t.id === chat.activeId);
  const entry = { ...message, at: new Date().toISOString() };
  thread.messages.push(entry);
  if (thread.messages.length > 200) thread.messages = thread.messages.slice(-200);
  if (entry.role === 'user' && (!thread.title || thread.title === '新对话')) thread.title = titleFrom(entry.content);
  thread.updatedAt = entry.at;
  return writeChat(id, chat);
}

function clearChat(id) {
  safeId(id);
  const chat = readChat(id);
  const thread = chat.threads.find(t => t.id === chat.activeId);
  if (thread) {
    thread.messages = [];
    thread.title = '新对话';
    thread.updatedAt = new Date().toISOString();
  }
  trace.append(id, 'clear-chat', {});
  return writeChat(id, chat);
}

function newChat(id) {
  safeId(id);
  const chat = readChat(id);
  const active = chat.threads.find(t => t.id === chat.activeId);
  if (active && active.messages.length === 0) return chat;
  const thread = blankThread();
  chat.threads.unshift(thread);
  chat.activeId = thread.id;
  if (chat.threads.length > 80) {
    const ranked = chat.threads.filter(t => t.id !== thread.id)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 79);
    const keep = new Set(ranked.map(t => t.id).concat(thread.id));
    chat.threads = chat.threads.filter(t => keep.has(t.id));
  }
  return writeChat(id, chat);
}

function openChat(id, threadId) {
  safeId(id);
  const chat = readChat(id);
  if (!chat.threads.some(t => t.id === threadId)) throw new Error('对话不存在');
  chat.activeId = threadId;
  return writeChat(id, chat);
}

function removeChat(id, threadId) {
  safeId(id);
  const chat = readChat(id);
  const next = chat.threads.filter(t => t.id !== threadId);
  if (next.length === chat.threads.length) throw new Error('对话不存在');
  chat.threads = next.length ? next : [blankThread()];
  if (!chat.threads.some(t => t.id === chat.activeId)) {
    chat.threads.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    chat.activeId = chat.threads[0].id;
  }
  trace.append(id, 'remove-chat', { threadId: threadId });
  return writeChat(id, chat);
}

/** 预置的消防、食堂案例不再随程序提供。已装上的实例连同本机目录一并删掉。 */
function purgeDemoInstances() {
  const demo = new Set(['canteen-management', 'fire-safety']);
  const r = registry();
  const gone = (r.instances || []).filter(i => demo.has(i.packageId));
  if (!gone.length) return;
  r.instances = r.instances.filter(i => !demo.has(i.packageId));
  if (!r.instances.some(i => i.id === r.activeId)) r.activeId = r.instances.length ? r.instances[0].id : null;
  saveRegistry(r);
  gone.forEach(i => {
    fs.rmSync(instanceDir(i.id), { recursive: true, force: true });
  });
}

/** 启动时不预装任何助手。 */
function init() {
  ensure();
  purgeDemoInstances();
  const r = registry();
  r.instances = r.instances || [];
  if (!r.instances.some(i => i.id === r.activeId)) r.activeId = r.instances.length ? r.instances[0].id : null;
  saveRegistry(r);
}

module.exports = {
  init, available, listInstances, current, switchAssistant, addInstance, removeInstance,
  renameInstance, importPackage, getAuthorizedPaths, setAuthorizedPaths, reindexInstance,
  readChat, appendChat, clearChat, newChat, openChat, removeChat, trace
};
