/* IPC 路由：渲染层不碰 fs / 不碰 node，一切经主进程。
 * 统一返回 { ok, data } 或 { ok:false, error }，避免异常穿透到界面。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell } = require('electron');
const { PATHS } = require('./paths');
const library = require('./library');
const model = require('./model-gateway');
const trace = require('./trace');
const indexer = require('./indexer');
const reader = require('./file-reader');
const fileOps = require('./file-ops');
const workspaceHost = require('./workspace-host');
const workspaceApi = require('./workspace-api');

const controllers = new Map();

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try { return { ok: true, data: await fn(payload || {}, event) }; }
    catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  });
}

/** 路径必须落在当前实例的授权目录内，防止通过界面操作到别的助手/别的位置。 */
function assertAuthorized(instanceId, target) {
  const roots = library.getAuthorizedPaths(instanceId);
  const abs = path.resolve(String(target || ''));
  const allowed = roots.some(r => abs === path.resolve(r) || abs.startsWith(path.resolve(r) + path.sep));
  if (!allowed) throw new Error('该路径不在当前助手的授权目录内，已拒绝操作。');
  return abs;
}

function guestHandle(channel, fn) {
  handle(channel, (payload, event) => {
    const instanceId = workspaceHost.instanceFromEvent(event);
    return fn(instanceId, payload || {});
  });
}

function register(adapter, getWindow) {
  handle('app:info', () => ({
    version: require('../../package.json').version,
    runtime: adapter.status(),
    dataDir: PATHS.userData,
    resourcesDir: PATHS.resources,
    modelConfigured: model.isConfigured(),
    presets: model.PRESETS
  }));

  // ---- 自绘标题栏的双击最大化（窗口按钮本身由 titleBarOverlay 提供） ----
  handle('win:toggleMaximize', () => {
    const w = getWindow();
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return true;
  });

  // ---- 助手库 ----
  handle('library:list', () => library.listInstances());
  handle('library:available', () => library.available());
  handle('library:add', (p) => library.addInstance(p.packageId, p.name));
  handle('library:switchTo', (p) => library.switchAssistant(p.id));
  handle('library:remove', (p) => library.removeInstance(p.id));
  handle('library:rename', (p) => library.renameInstance(p.id, p.name));
  handle('library:import', async (p) => library.importPackage(p.filePath));
  handle('library:pickPackage', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: '添加助手：选择包含 manifest.json 的 HTML 助手文件夹',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: '助手文件', extensions: ['json'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('library:pickFolder', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: '选择本机资料目录（将授权给当前助手）',
      properties: ['openDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- 当前助手 ----
  handle('assistant:current', () => library.current());
  handle('assistant:paths', (p) => library.getAuthorizedPaths(p.instanceId || library.current().instance.id));
  handle('assistant:setPaths', (p) => {
    const id = p.instanceId || library.current().instance.id;
    const paths = library.setAuthorizedPaths(id, p.paths);
    library.reindexInstance(id);
    return paths;
  });
  handle('assistant:reindex', (p) => adapter.runTask({ type: 'reindex', payload: { instanceId: p.instanceId } }));
  handle('assistant:trace', (p) => trace.read(p.instanceId, p.limit || 60).reverse());
  // 本地资料页按真实文件夹展开。只允许读当前助手已授权的目录，符号链接解析后再核对一次。
  handle('assistant:listDir', (p) => {
    const cur = library.current();
    const id = p.instanceId || (cur.instance && cur.instance.id);
    if (!id) throw new Error('尚未添加任何助手');
    const roots = library.getAuthorizedPaths(id).map(r => {
      try { return fs.realpathSync(r); } catch (e) { return path.resolve(r); }
    });
    let abs = path.resolve(String(p.path || ''));
    try { abs = fs.realpathSync(abs); } catch (e) { /* 目录不存在时交给 listDirectory 报错 */ }
    const ok = roots.some(r => {
      const left = abs.toLowerCase();
      const right = r.toLowerCase();
      return left === right || left.startsWith(right + path.sep);
    });
    if (!ok) throw new Error('该路径不在当前助手的授权目录内，已拒绝操作。');
    return reader.listDirectory(abs);
  });

  // ---- 对话 ----
  handle('chat:send', async (p, event) => {
    const cur = library.current();
    if (!cur.instance) throw new Error('尚未添加任何助手');
    if (cur.instance.id !== p.instanceId) throw new Error('当前助手已切换，请重新发送');
    const settings = model.getSettings();
    const controller = new AbortController();
    controllers.set(p.requestId, controller);
    const messages = (p.messages || []).map(m => ({ role: m.role, content: m.content }));
    try {
      const result = await adapter.chat({
        pkg: cur.pkg,
        index: cur.index,
        settings,
        messages,
        signal: controller.signal,
        onChunk: (piece) => {
          if (!event.sender.isDestroyed()) event.sender.send('chat:chunk', { requestId: p.requestId, piece });
        }
      });
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      library.appendChat(cur.instance.id, { role: 'user', content: lastUser ? lastUser.content : '' });
      library.appendChat(cur.instance.id, {
        role: 'assistant', content: result.text,
        context: { ...result.context, sampleMode: !!cur.instance.sampleMode }
      });
      adapter.trace({ instanceId: cur.instance.id, type: 'chat', payload: { files: result.context.includedFiles, chars: result.text.length } });
      return result;
    } finally {
      controllers.delete(p.requestId);
    }
  });
  handle('chat:abort', (p) => {
    const c = controllers.get(p.requestId);
    if (c) c.abort();
    return { aborted: !!c };
  });
  handle('chat:clear', (p) => library.clearChat(p.instanceId));
  handle('chat:new', (p) => library.newChat(p.instanceId));
  handle('chat:open', (p) => library.openChat(p.instanceId, p.threadId));
  handle('chat:remove', (p) => library.removeChat(p.instanceId, p.threadId));

  // ---- 设置 ----
  handle('settings:get', () => ({ ...model.publicSettings(), presets: model.PRESETS }));
  handle('settings:set', (p) => {
    // apiKey 为掩码时表示不修改
    const patch = { ...p };
    if (typeof patch.apiKey === 'string' && patch.apiKey.startsWith('••')) delete patch.apiKey;
    return model.setSettings(patch);
  });

  // ---- 系统与溯源 ----
  handle('system:reveal', (p) => {
    const abs = assertAuthorized(p.instanceId, p.path);
    if (!fs.existsSync(abs)) throw new Error('文件已不存在：' + abs);
    shell.showItemInFolder(abs);
    return { opened: true };
  });
  handle('system:open', (p) => {
    const abs = assertAuthorized(p.instanceId, p.path);
    return shell.openPath(abs);
  });
  handle('files:props', (p) => {
    const abs = assertAuthorized(p.instanceId, p.path);
    if (!fs.existsSync(abs)) throw new Error('文件已不存在');
    return fileOps.props(abs);
  });
  handle('files:copy', (p) => {
    const src = assertAuthorized(p.instanceId, p.from);
    const dir = assertAuthorized(p.instanceId, p.toDir);
    return fileOps.copyInto(src, dir);
  });
  handle('files:move', (p) => {
    const src = assertAuthorized(p.instanceId, p.from);
    const dir = assertAuthorized(p.instanceId, p.toDir);
    return fileOps.moveInto(src, dir);
  });
  handle('files:trash', async (p) => {
    const abs = assertAuthorized(p.instanceId, p.path);
    if (!fs.existsSync(abs)) throw new Error('文件已不存在');
    await shell.trashItem(abs);
    return { removed: true };
  });
  handle('system:openDataDir', () => shell.openPath(PATHS.userData));
  handle('system:exportIndex', async (p) => {
    const index = indexer.loadIndex(p.instanceId);
    if (!index) throw new Error('当前助手还没有索引');
    const r = await dialog.showSaveDialog(getWindow(), {
      title: '导出资料索引',
      defaultPath: '资料索引-' + p.instanceId + '.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(index, null, 2), 'utf8');
    trace.append(p.instanceId, 'export-index', { to: path.basename(r.filePath) });
    return r.filePath;
  });

  // HTML 工作台。调用者必须是当前助手自己的 webview，不能由主界面或别的实例转发。
  guestHandle('ws:assistant:getInfo', (id) => workspaceApi.getInfo(id));
  guestHandle('ws:workspace:getInfo', (id) => workspaceApi.getWorkspace(id));
  guestHandle('ws:files:list', (id, payload) => workspaceApi.listFiles(id, payload));
  guestHandle('ws:files:search', (id, payload) => workspaceApi.searchFiles(id, payload));
  guestHandle('ws:files:read', (id, payload) => workspaceApi.readFile(id, payload));
  guestHandle('ws:data:read', (id, payload) => workspaceApi.readData(id, payload));
  guestHandle('ws:data:write', (id, payload) => workspaceApi.writeData(id, payload));
  guestHandle('ws:documents:list', (id) => workspaceApi.listDocuments(id));
  guestHandle('ws:documents:create', (id, payload) => workspaceApi.createDocument(id, payload));
  guestHandle('ws:ai:chat', (id, payload) => workspaceApi.chat(id, payload, adapter));
}

module.exports = { register };
