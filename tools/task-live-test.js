/* 真实模型工具调用。不会被 npm test 调用。
 * 有本机模型配置时：node tools/task-live-test.js
 * 没有 API Key 时只打印 LIVE_SKIPPED，退出码为 0。
 * 不会把 API Key 写进代码、日志或结果文件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const tmpUser = path.join(root, '.live-test-userdata');
const settingsCandidates = [
  process.env.PA_SETTINGS,
  path.join(process.env.APPDATA || '', 'post-assistant-desktop', 'settings.json'),
  path.join(process.env.APPDATA || '', '全岗位 AI 工作助手', 'settings.json')
].filter(Boolean);

function readSettings() {
  for (let i = 0; i < settingsCandidates.length; i++) {
    if (!fs.existsSync(settingsCandidates[i])) continue;
    try { return JSON.parse(fs.readFileSync(settingsCandidates[i], 'utf8')); }
    catch (e) { return null; }
  }
  return null;
}

const userSettings = readSettings();
if (!userSettings || !userSettings.apiKey || !userSettings.model) {
  console.log('LIVE_SKIPPED 没有找到可用的本机模型配置，未调用真实模型。');
  process.exit(0);
}

fs.rmSync(tmpUser, { recursive: true, force: true });
fs.mkdirSync(tmpUser, { recursive: true });
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => root, getPath: () => tmpUser } };
  }
  return originalLoad.apply(this, arguments);
};

function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (userSettings && userSettings.apiKey) text = text.split(String(userSettings.apiKey)).join('[key]');
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[key]');
}

function publicError(error) {
  return redact(String(error && error.stack || error || '')).slice(0, 500);
}

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function main() {
  const { writeJson, instanceDir } = require('../src/main/paths');
  writeJson(path.join(tmpUser, 'settings.json'), {
    provider: userSettings.provider || 'openai-compatible',
    baseUrl: userSettings.baseUrl,
    apiKey: userSettings.apiKey,
    model: userSettings.model,
    temperature: userSettings.temperature == null ? 0.2 : userSettings.temperature,
    sendLocalData: false
  });
  const library = require('../src/main/library');
  const engine = require('../src/main/task-engine');
  library.init();
  const imported = library.importPackage(path.join(root, 'samples', 'park-fire-assistant'));
  const added = library.addInstance(imported.id, '真实模型消防');
  const other = library.addInstance(imported.id, '真实模型对照');
  library.switchAssistant(added.id);
  library.setAuthorizedPaths(added.id, [path.join(root, 'samples', 'park-fire-materials')]);
  library.reindexInstance(added.id);
  const dataFile = path.join(instanceDir(added.id), 'data', 'hazards.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({
    items: [
      { id: 'YH-01', place: 'A栋消防通道', desc: '堆放杂物', status: '未完成' },
      { id: 'YH-02', place: '地下室配电间', desc: '灭火器过期', status: '已完成' }
    ]
  }, null, 2), 'utf8');

  async function watch(taskId, decide) {
    const started = Date.now();
    let decided = false;
    let last = null;
    while (Date.now() - started < 150000) {
      last = engine.getStatus(added.id, taskId);
      if (!decided && decide && last.status === 'waiting_confirmation' && last.pendingAction) {
        engine.confirm(added.id, { taskId: taskId, actionId: last.pendingAction.id, approved: decide === 'approve' });
        decided = true;
      }
      if (last.status === 'completed' || last.status === 'failed' || last.status === 'cancelled') {
        if (!decide || decided || last.status !== 'waiting_confirmation') break;
      }
      await delay(400);
    }
    return { status: last, decided: decided };
  }

  async function scenario(name, request, decide) {
    const run = engine.start(added.id, { task: request });
    const watched = await watch(run.taskId, decide);
    const result = await run.done;
    const record = JSON.parse(fs.readFileSync(path.join(instanceDir(added.id), 'tasks', run.taskId + '.json'), 'utf8'));
    return {
      name: name,
      status: result.status,
      error: result.error || '',
      programNote: result.programNote || '',
      report: result.report || '',
      decided: watched.decided,
      tools: (record.toolLog || []).map(function (item) { return item.name + ':' + (item.ok ? 'ok' : 'fail'); })
    };
  }

  const drill = await scenario('检索阅读并生成文档', '请检索并阅读已授权目录里的消防演练记录，只根据原文整理 2026 年的演练、参与情况和问题。缺的信息写未找到。然后把总结保存成一份 Markdown 文档。保存后根据工具返回的文件名做最终说明。');
  const docs = fs.existsSync(path.join(instanceDir(added.id), 'documents'))
    ? fs.readdirSync(path.join(instanceDir(added.id), 'documents')) : [];
  let body = '';
  if (docs.length) body = fs.readFileSync(path.join(instanceDir(added.id), 'documents', docs[0]), 'utf8');
  drill.documents = docs;
  drill.hasDrillFact = body.indexOf('部分员工未听到警报') >= 0;
  drill.excludedOldDrill = body.indexOf('冬季疏散') < 0;

  const approved = await scenario('确认后修改业务数据', '请读取 hazards.json。把编号 YH-01 的 status 改成已完成，其他条目不要改。必须调用 write_workspace_data，不要在工具成功前提前声称已经改完。', 'approve');
  const afterApprove = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  approved.yh01 = afterApprove.items.find(function (item) { return item.id === 'YH-01'; }).status;
  approved.yh02 = afterApprove.items.find(function (item) { return item.id === 'YH-02'; }).status;

  const rejected = await scenario('拒绝后不修改业务数据', '请读取 hazards.json。把编号 YH-02 的 status 改成未完成，其他条目不要改。必须调用 write_workspace_data。', 'reject');
  const afterReject = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  rejected.yh01 = afterReject.items.find(function (item) { return item.id === 'YH-01'; }).status;
  rejected.yh02 = afterReject.items.find(function (item) { return item.id === 'YH-02'; }).status;
  rejected.unchanged = rejected.yh02 === '已完成';

  const failed = await scenario('工具失败要据实说明', '请调用 read_local_file，path 使用 C:\\\\Windows\\\\win.ini。不要改用别的路径。然后只根据工具返回说明是否读到；如果工具失败，必须说明失败，不能写成已经读到文件内容。');
  failed.reportedFailure = failed.status === 'failed' || /失败|拒绝|未找到|没有读到|无法读取|不在/.test(failed.report + failed.programNote);
  failed.leakedWinIni = /\[fonts\]|for 16-bit app support/i.test(failed.report || '');

  const isolated = await engine.start(other.id, { task: '读取 hazards.json 里 YH-01 的状态。' }).done;
  const isolatedRecord = JSON.parse(fs.readFileSync(path.join(instanceDir(other.id), 'tasks', isolated.id + '.json'), 'utf8'));
  const isolatedTools = (isolatedRecord.toolLog || []).map(function (item) { return item.name + ':' + (item.ok ? 'ok' : 'fail'); });
  const isolatedRead = (isolatedRecord.thread || []).filter(function (item) { return item.name === 'read_workspace_data'; })
    .map(function (item) { return item.content; }).join('\n');

  const summary = {
    started: new Date().toISOString(),
    provider: userSettings.provider || 'openai-compatible',
    model: userSettings.model,
    baseUrl: userSettings.baseUrl,
    realModel: true,
    scenarios: [drill, approved, rejected, failed, {
      name: '其他实例不能读到私有数据',
      status: isolated.status,
      tools: isolatedTools,
      sawPrivate: (isolatedRead + (isolated.report || '')).indexOf('A栋消防通道') >= 0 || (isolatedRead + (isolated.report || '')).indexOf('堆放杂物') >= 0
    }]
  };
  const safe = redact(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(root, '.live-test-result.json'), safe, 'utf8');
  console.log('LIVE_RESULT ' + safe);
  fs.rmSync(tmpUser, { recursive: true, force: true });

  function need(cond) { if (!cond) process.exitCode = 1; }
  need(drill.status === 'completed');
  need(drill.hasDrillFact && drill.excludedOldDrill);
  need(drill.tools.some(function (item) { return item.indexOf('search_local_files:ok') === 0; }));
  need(drill.tools.some(function (item) { return item.indexOf('read_local_file:ok') === 0; }));
  need(drill.tools.some(function (item) { return item.indexOf('create_document:ok') === 0; }));
  need(approved.decided && approved.yh01 === '已完成' && approved.yh02 === '已完成');
  need(approved.tools.some(function (item) { return item.indexOf('write_workspace_data:ok') === 0; }));
  need(rejected.decided && rejected.unchanged && rejected.yh01 === '已完成');
  need(!rejected.tools.some(function (item) { return item.indexOf('write_workspace_data:ok') === 0; }));
  need(failed.tools.some(function (item) { return item.indexOf('read_local_file:fail') === 0; }));
  need(failed.reportedFailure && !failed.leakedWinIni);
  need(summary.scenarios[4].sawPrivate === false);
}

main().catch(function (error) {
  console.error('LIVE_ERROR ' + publicError(error));
  try { fs.rmSync(tmpUser, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
  process.exit(1);
});
