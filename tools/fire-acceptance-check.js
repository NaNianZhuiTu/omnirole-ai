/* 在真实 Electron 窗口里打开园区消防助手，检查恢复、取消、确认和实例隔离。
 * 由 tools/run-electron.js 启动。模型用测试里的固定步骤，不调用外部接口。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const userData = path.join(root, '.fire-acceptance-userdata');
fs.rmSync(userData, { recursive: true, force: true });
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
require('../src/main/workspace-scheme');

function fail(error) {
  console.error('\n[FIRE ERROR] ' + (error && error.stack ? error.stack : error));
  app.exit(1);
}

const timer = setTimeout(function () { fail(new Error('消防助手验收超时')); }, 60000);

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function openWorkspace(workspaceHost, current) {
  const parentHtml = path.join(userData, 'parent-' + current.instance.id + '.html');
  fs.writeFileSync(parentHtml, '<!DOCTYPE html><html><body style="margin:0;height:100vh">' +
    '<webview id="view" partition="' + current.workspace.partition + '" src="' + current.workspace.url +
    '" style="width:100%;height:100%"></webview></body></html>', 'utf8');
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true }
  });
  workspaceHost.install(win);
  await new Promise(function (resolve, reject) {
    win.webContents.once('did-finish-load', resolve);
    win.webContents.once('did-fail-load', function (_event, code, desc) {
      reject(new Error('宿主页加载失败 ' + code + ' ' + desc));
    });
    win.loadFile(parentHtml);
  });
  return win;
}

async function guest(win, script) {
  return win.webContents.executeJavaScript(
    `(async () => {
      const view = document.getElementById('view');
      for (let i = 0; i < 80; i++) {
        let url = '';
        try { url = view.getURL() || ''; } catch (e) { url = ''; }
        if (url.indexOf('pawork:') === 0) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if ((view.getURL() || '').indexOf('pawork:') !== 0) throw new Error('工作台没有打开：' + (view.getURL() || ''));
      return await view.executeJavaScript(${JSON.stringify(script)});
    })()`,
    true
  );
}

async function run() {
  const library = require('../src/main/library');
  const engine = require('../src/main/task-engine');
  const executor = require('../src/main/tool-executor');
  const taskRegistry = require('../src/main/task-registry');
  const { instanceDir } = require('../src/main/paths');
  const workspaceHost = require('../src/main/workspace-host');
  const { register } = require('../src/main/ipc');
  const { RuntimeAdapter } = require('../src/main/runtime/adapter');
  const localRuntime = require('../src/main/runtime/local-runtime');

  library.init();
  const imported = library.importPackage(path.join(root, 'samples', 'park-fire-assistant'));
  const first = library.addInstance(imported.id, '园区消防甲');
  const second = library.addInstance(imported.id, '园区消防乙');
  library.switchAssistant(first.id);
  library.setAuthorizedPaths(first.id, [path.join(root, 'samples', 'park-fire-materials')]);
  library.reindexInstance(first.id);
  const hazards = path.join(instanceDir(first.id), 'data', 'hazards.json');
  fs.mkdirSync(path.dirname(hazards), { recursive: true });
  fs.writeFileSync(hazards, JSON.stringify({
    items: [{ id: 'YH-01', place: 'A栋消防通道', desc: '堆放杂物', status: '未完成' }]
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(instanceDir(first.id), 'tasks', 'task-boot.json'), JSON.stringify({
    id: 'task-boot',
    instanceId: first.id,
    request: '重启前等待确认',
    status: 'waiting_confirmation',
    startedAt: new Date().toISOString(),
    pendingAction: { id: 'act-boot', title: '更新业务数据', target: 'hazards.json', before: '未完成', after: '已完成' },
    toolLog: [],
    activity: []
  }), 'utf8');
  engine.recoverInterrupted();
  const recovered = taskRegistry.load(first.id, 'task-boot');
  if (!recovered || recovered.status !== 'failed' || recovered.pendingAction) throw new Error('启动恢复没有清掉等待确认的任务');
  if (fs.readFileSync(hazards, 'utf8').indexOf('未完成') < 0) throw new Error('恢复过程改动了业务数据');

  const facility = await executor.run(first.id, { id: 'fac', name: 'search_local_files', arguments: { query: '灭火器' } });
  if (!facility.ok || !(facility.result.hits || []).some(function (hit) { return String(hit.excerpt || hit.name || '').indexOf('灭火器') >= 0; })) {
    throw new Error('没有在授权资料里查到消防设施');
  }
  const indexed = await executor.run(first.id, { id: 'idx', name: 'search_business_index', arguments: { query: '疏散演练' } });
  if (!indexed.ok || !(indexed.result.hits || []).length) throw new Error('业务索引没有返回演练记录');
  const denied = await executor.run(second.id, { id: 'deny', name: 'read_local_file', arguments: { path: hazards } });
  if (denied.ok || JSON.stringify(denied).indexOf('堆放杂物') >= 0) throw new Error('另一个助手读到了私有业务数据');

  register(new RuntimeAdapter(localRuntime), function () { return null; });
  const win = await openWorkspace(workspaceHost, library.current());
  const booted = await guest(win, `(async function () {
    function status() { return document.getElementById('statusText').textContent; }
    for (let i = 0; i < 50; i++) {
      if (status() && status() !== '还没有任务') break;
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    const found = await window.desktop.files.search({ query: '灭火器', limit: 5 });
    let read = false;
    let facility = false;
    for (const hit of (found.hits || [])) {
      const file = await window.desktop.files.read({ path: hit.path, maxChars: 4000 });
      if (file.text.indexOf('灭火器') >= 0) read = true;
      if (file.text.indexOf('SS-01') >= 0) facility = true;
    }
    return {
      status: status(),
      note: document.getElementById('note').textContent,
      confirmHidden: document.getElementById('confirmCard').hidden,
      hits: (found.hits || []).length,
      read: read,
      facility: facility
    };
  })()`);
  console.log('FIRE_BOOT ' + JSON.stringify(booted));
  if (booted.status !== '未完成') throw new Error('重启后的任务没有显示为未完成：' + booted.status);
  if (booted.note.indexOf('等待确认的操作没有执行') < 0) throw new Error('工作台没有说明确认已失效：' + booted.note);
  if (!booted.confirmHidden) throw new Error('重启后仍显示确认卡片');
  if (!booted.hits || !booted.read || !booted.facility) throw new Error('工作台没有读到授权的消防设施资料');

  const hang = engine.start(first.id, { task: '这个任务会在工作台里取消。' }, { complete: function (input) {
    return new Promise(function (_resolve, reject) {
      const stop = function () {
        const error = new Error('任务已取消');
        error.name = 'AbortError';
        reject(error);
      };
      if (input.signal.aborted) stop();
      else input.signal.addEventListener('abort', stop, { once: true });
    });
  } });
  const cancelled = await guest(win, `(async function () {
    function status() { return document.getElementById('statusText').textContent; }
    for (let i = 0; i < 40 && status() !== '正在执行' && status() !== '正在理解任务'; i++) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    document.getElementById('cancelBtn').click();
    for (let i = 0; i < 40 && status() !== '已取消'; i++) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    return { status: status(), note: document.getElementById('note').textContent };
  })()`);
  const hangResult = await hang.done;
  console.log('FIRE_CANCEL ' + JSON.stringify(cancelled));
  if (cancelled.status !== '已取消' || hangResult.status !== 'cancelled') throw new Error('工作台取消没有停掉任务');
  if (cancelled.note.indexOf('任务已取消') < 0) throw new Error('工作台没有显示取消原因');

  function dataModel(nextStatus) {
    return async function (input) {
      const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
      const reads = tools.filter(function (message) { return message.name === 'read_workspace_data'; });
      const writes = tools.filter(function (message) { return message.name === 'write_workspace_data'; });
      if (!reads.length) return { text: '', toolCalls: [{ id: 'd1', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] };
      if (!writes.length) {
        const current = JSON.parse(reads[0].content);
        const next = JSON.parse(JSON.stringify(current.value));
        next.items[0].status = nextStatus;
        return { text: '', toolCalls: [{ id: 'w1', name: 'write_workspace_data', arguments: { name: 'hazards.json', value: next } }] };
      }
      if (reads.length < 2) return { text: '', toolCalls: [{ id: 'd2', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] };
      const checked = JSON.parse(reads[reads.length - 1].content);
      const state = checked.value && checked.value.items ? checked.value.items[0].status : '未读到';
      return { text: '复核状态：' + state, toolCalls: [] };
    };
  }
  const rejectRun = engine.start(first.id, { task: '把 YH-01 改成已取消，这一次会拒绝。' }, { complete: dataModel('不该写入') });
  const rejected = await guest(win, `(async function () {
    function status() { return document.getElementById('statusText').textContent; }
    for (let i = 0; i < 40 && status() !== '等待确认'; i++) await new Promise(function (resolve) { setTimeout(resolve, 100); });
    const before = document.getElementById('confirmBefore').textContent;
    document.getElementById('rejectBtn').click();
    for (let i = 0; i < 40 && status() === '等待确认'; i++) await new Promise(function (resolve) { setTimeout(resolve, 100); });
    return { status: status(), before: before, report: document.getElementById('report').textContent };
  })()`);
  await rejectRun.done;
  console.log('FIRE_REJECT ' + JSON.stringify(rejected));
  if (rejected.status === '等待确认') throw new Error('拒绝后仍停在确认');
  if (fs.readFileSync(hazards, 'utf8').indexOf('不该写入') >= 0) throw new Error('拒绝后仍然写入了业务数据');

  const approveRun = engine.start(first.id, { task: '把 YH-01 的整改状态改为已完成。' }, { complete: dataModel('已完成') });
  const approved = await guest(win, `(async function () {
    function status() { return document.getElementById('statusText').textContent; }
    for (let i = 0; i < 40 && status() !== '等待确认'; i++) await new Promise(function (resolve) { setTimeout(resolve, 100); });
    document.getElementById('approveBtn').click();
    for (let i = 0; i < 50 && status() !== '已完成' && status() !== '未完成'; i++) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }
    const readBack = await window.desktop.data.read({ name: 'hazards.json' });
    return { status: status(), report: document.getElementById('report').textContent, readBack: readBack.value.items[0].status };
  })()`);
  await approveRun.done;
  console.log('FIRE_APPROVE ' + JSON.stringify(approved));
  if (approved.readBack !== '已完成') throw new Error('确认后重新读取的状态不对：' + approved.readBack);
  if (JSON.parse(fs.readFileSync(hazards, 'utf8')).items[0].status !== '已完成') throw new Error('磁盘上的业务数据没有更新');

  library.switchAssistant(second.id);
  const otherWin = await openWorkspace(workspaceHost, library.current());
  const isolated = await guest(otherWin, `(async function () {
    const out = {};
    try { out.data = await window.desktop.data.read({ name: 'hazards.json' }); }
    catch (e) { out.dataError = e.message; }
    try { out.file = await window.desktop.files.read({ path: ${JSON.stringify(hazards)} }); }
    catch (e) { out.fileError = e.message; }
    return out;
  })()`);
  console.log('FIRE_ISOLATED ' + JSON.stringify(isolated));
  const blob = JSON.stringify(isolated);
  if (blob.indexOf('堆放杂物') >= 0 || blob.indexOf('A栋消防通道') >= 0) {
    throw new Error('第二个助手工作台读到了第一个助手的数据');
  }
  if (!isolated.dataError) throw new Error('第二个助手不应该读到这份业务数据');
  if (!isolated.fileError || isolated.fileError.indexOf('授权') < 0) throw new Error('未授权路径没有被拒绝：' + isolated.fileError);

  console.log('FIRE_OK');
  clearTimeout(timer);
  app.exit(0);
}

app.whenReady().then(run).catch(fail);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
