/* 任务引擎测试：工具真实读写测试资料，模型用可重复的步骤编排，不把“成功”两个字当成结果。
 * 用法：node tools/task-engine-test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmpUser = path.join(root, '.task-test-userdata');
const restarting = process.argv[2] === '--restart-check';
if (!restarting) {
  fs.rmSync(tmpUser, { recursive: true, force: true });
  fs.mkdirSync(tmpUser, { recursive: true });
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { isPackaged: false, getAppPath: () => root, getPath: () => tmpUser } };
  }
  return originalLoad.apply(this, arguments);
};

const assert = (cond, msg) => {
  if (!cond) { console.error('  [FAIL] ' + msg); process.exitCode = 1; }
  else console.log('  [OK]   ' + msg);
};

function runRestart() {
  const expect = JSON.parse(fs.readFileSync(path.join(tmpUser, 'restart-expect.json'), 'utf8'));
  const library = require('../src/main/library');
  const taskRegistry = require('../src/main/task-registry');
  library.init();
  const waiting = taskRegistry.load(expect.instanceId, expect.waitingId);
  assert(waiting && waiting.status === 'failed' && waiting.error.indexOf('等待确认的操作没有执行') >= 0, '新进程启动后，等待确认的任务标成未执行');
  assert(!waiting.pendingAction, '新进程启动后不再保留确认操作');
  assert(waiting.activity.some(function (item) { return item.text.indexOf('等待确认') >= 0; }), '中断原因写进了任务过程');
  const running = taskRegistry.load(expect.instanceId, expect.runningId);
  assert(running && running.status === 'failed' && running.error.indexOf('任务中断') >= 0, '新进程启动后，运行中的任务标成中断');
  const done = taskRegistry.load(expect.instanceId, expect.doneId);
  assert(done && done.status === 'completed' && done.report === '原报告', '已完成任务没有被重新执行');
  const cancelled = taskRegistry.load(expect.instanceId, expect.cancelledId);
  assert(cancelled && cancelled.status === 'cancelled', '已取消任务不会被改成失败或重新执行');
  assert(fs.readFileSync(expect.docFile, 'utf8') === expect.docText, '重启没有改写已经保存的文件');
  assert(!fs.existsSync(expect.absentFile), '中断任务没有被重新执行出新文件');
  const marks = waiting.activity.length;
  library.init();
  const again = taskRegistry.load(expect.instanceId, expect.waitingId);
  assert(again.activity.length === marks, '再次启动不会重复写下中断原因');
}

if (restarting) {
  try { runRestart(); }
  catch (e) { console.error('\n[ERROR] ' + (e.stack || e)); process.exitCode = 1; }
  process.exit(process.exitCode || 0);
}

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function parseTool(message) {
  try { return JSON.parse(message.content); }
  catch (e) { return { error: message.content }; }
}

function drillReport(text, indexFile) {
  const lines = String(text || '').split(/\r?\n/).slice(1).filter(Boolean);
  let body = '# 年度消防演练总结报告\n\n来源：消防演练记录.csv\n\n';
  lines.forEach(function (line) {
    const cols = line.split(',');
    if (!cols[0] || cols[0].indexOf('2026') !== 0) return;
    body += '- ' + cols[0]
      + '，地点：' + (cols[1] || '未找到')
      + '，科目：' + (cols[2] || '未找到')
      + '，参与人数：' + (cols[3] || '未找到')
      + '，问题：' + (cols[4] || '未找到') + '\n';
  });
  if (indexFile) body += '\n索引来源：' + indexFile + '\n';
  return body;
}

function drillModel() {
  return async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    const names = tools.map(function (message) { return message.name; });
    if (!names.length) {
      return { text: '先检索演练资料，再对照原文。', toolCalls: [{ id: 's1', name: 'search_local_files', arguments: { query: '演练' } }] };
    }
    const found = parseTool(tools[0]);
    if (names.indexOf('read_local_file') < 0) {
      const hit = (found.hits || []).find(function (item) { return item.name.indexOf('演练记录') >= 0; });
      return { text: '', toolCalls: [{ id: 'r1', name: 'read_local_file', arguments: { path: hit.path } }] };
    }
    if (names.filter(function (name) { return name === 'read_local_file'; }).length === 1) {
      const rule = (found.hits || []).find(function (item) { return item.name.indexOf('管理制度') >= 0; });
      if (rule) return { text: '', toolCalls: [{ id: 'r2', name: 'read_local_file', arguments: { path: rule.path } }] };
    }
    if (names.indexOf('search_business_index') < 0) {
      return { text: '', toolCalls: [{ id: 'i1', name: 'search_business_index', arguments: { query: '疏散演练' } }] };
    }
    if (names.indexOf('create_document') < 0) {
      const reads = tools.filter(function (message) { return message.name === 'read_local_file'; }).map(parseTool);
      const drill = reads.find(function (item) { return (item.name || '').indexOf('演练记录') >= 0; }) || reads[0];
      const rule = reads.find(function (item) { return (item.name || '').indexOf('管理制度') >= 0; });
      const indexed = parseTool(tools.find(function (message) { return message.name === 'search_business_index'; }));
      const indexFile = indexed.hits && indexed.hits[0] && indexed.hits[0].source && indexed.hits[0].source.file;
      let content = drillReport(drill.text, indexFile);
      if (rule && rule.text) content += '\n对照来源：' + rule.name + '\n' + String(rule.text).trim() + '\n';
      return { text: '', toolCalls: [{ id: 'w1', name: 'create_document', arguments: { title: '年度消防演练总结报告', content: content, format: 'md' } }] };
    }
    const saved = parseTool(tools.find(function (message) { return message.name === 'create_document'; }));
    return { text: '报告已由程序保存为 ' + saved.rel + '。缺失项已标为未找到。', toolCalls: [] };
  };
}

function hazardModel() {
  return async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    const names = tools.map(function (message) { return message.name; });
    if (!names.length) return { text: '检索隐患台账。', toolCalls: [{ id: 's1', name: 'search_local_files', arguments: { query: '隐患' } }] };
    if (names.indexOf('read_local_file') < 0) {
      const found = parseTool(tools[0]);
      const hit = (found.hits || []).find(function (item) { return item.name.indexOf('隐患台账') >= 0; });
      return { text: '', toolCalls: [{ id: 'r1', name: 'read_local_file', arguments: { path: hit.path } }] };
    }
    if (names.indexOf('create_document') < 0) {
      const file = parseTool(tools.find(function (message) { return message.name === 'read_local_file'; }));
      const lines = String(file.text || '').split(/\r?\n/).slice(1).filter(Boolean);
      let content = '# 待整改隐患清单\n\n来源：' + file.name + '\n\n';
      lines.forEach(function (line) {
        const cols = line.split(',');
        if (cols[3] === '已完成') return;
        content += '- ' + cols[0] + ' ' + cols[1] + ' ' + cols[2] + '，状态：' + cols[3] + '，来源：' + file.name + '\n';
      });
      return { text: '', toolCalls: [{ id: 'w1', name: 'create_document', arguments: { title: '待整改隐患清单', content: content, format: 'md' } }] };
    }
    const saved = parseTool(tools[tools.length - 1]);
    return { text: '清单已由程序保存为 ' + saved.rel, toolCalls: [] };
  };
}

function updateModel() {
  return async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    const reads = tools.filter(function (message) { return message.name === 'read_workspace_data'; });
    const writes = tools.filter(function (message) { return message.name === 'write_workspace_data'; });
    if (!reads.length) return { text: '读取隐患业务数据。', toolCalls: [{ id: 'd1', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] };
    if (!writes.length) {
      const current = parseTool(reads[0]);
      const next = JSON.parse(JSON.stringify(current.value));
      next.items.forEach(function (item) { if (item.id === 'YH-01') item.status = '已完成'; });
      return { text: '', toolCalls: [{ id: 'w1', name: 'write_workspace_data', arguments: { name: 'hazards.json', value: next } }] };
    }
    if (reads.length < 2) return { text: '', toolCalls: [{ id: 'd2', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] };
    const checked = parseTool(reads[1]);
    const item = checked.value.items.find(function (row) { return row.id === 'YH-01'; });
    return { text: '复核状态：' + item.status + '。数据文件：hazards.json', toolCalls: [] };
  };
}

async function main() {
  const library = require('../src/main/library');
  const engine = require('../src/main/task-engine');
  const executor = require('../src/main/tool-executor');
  const toolRegistry = require('../src/main/tool-registry');
  const taskRegistry = require('../src/main/task-registry');
  const gateway = require('../src/main/model-gateway');
  const { instanceDir, PATHS, writeJson } = require('../src/main/paths');

  library.init();
  const imported = library.importPackage(path.join(root, 'samples', 'park-fire-assistant'));
  const first = library.addInstance(imported.id, '园区消防甲');
  const second = library.addInstance(imported.id, '园区消防乙');
  library.switchAssistant(first.id);
  library.setAuthorizedPaths(first.id, [path.join(root, 'samples', 'park-fire-materials')]);
  library.reindexInstance(first.id);
  fs.writeFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), JSON.stringify({
    items: [
      { id: 'YH-01', place: 'A栋消防通道', desc: '堆放杂物', status: '未完成' },
      { id: 'YH-02', place: '地下室配电间', desc: '灭火器过期', status: '已完成' },
      { id: 'YH-03', place: '食堂后厨', desc: '应急灯故障', status: '整改中' }
    ]
  }, null, 2), 'utf8');

  console.log('\n== 工具登记与参数 ==');
  const names = toolRegistry.list().map(function (tool) { return tool.name; });
  assert(names.indexOf('run_shell') < 0 && names.indexOf('delete_file') < 0, '没有开放命令执行和删除');
  assert(names.indexOf('search_local_files') >= 0 && names.indexOf('create_document') >= 0 && names.indexOf('write_workspace_data') >= 0, '检索、文档和业务数据工具已登记');
  const badArgs = await executor.run(first.id, { id: 'x', name: 'search_local_files', arguments: { query: '', extra: true } });
  assert(!badArgs.ok, '空关键词和多余参数被拒绝');
  const escaped = await executor.run(first.id, { id: 'x2', name: 'write_workspace_data', arguments: { name: '../package/a.json', value: { a: 1 } } });
  assert(!escaped.ok && escaped.error.indexOf('上级目录') >= 0, '不能把业务数据写到模板目录');
  assert(!fs.existsSync(path.join(instanceDir(first.id), 'package', 'a.json')), '模板目录没有被写入');

  console.log('\n== 模型协议区分 ==');
  const openaiTools = gateway.toolDefinitions('openai', toolRegistry.list().slice(0, 1));
  const anthropicTools = gateway.toolDefinitions('anthropic', toolRegistry.list().slice(0, 1));
  assert(openaiTools[0].type === 'function' && openaiTools[0].function.name === 'search_local_files', 'OpenAI 兼容协议使用 function 工具');
  assert(anthropicTools[0].input_schema && !anthropicTools[0].function, 'Anthropic 使用 input_schema，不套 OpenAI 格式');
  const openaiMessages = gateway.toOpenAIMessages('系统', [
    { role: 'user', content: '做事' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_documents', arguments: {} }] },
    { role: 'tool', toolCallId: 'c1', content: '{"documents":[]}' }
  ]);
  assert(openaiMessages[3].role === 'tool' && openaiMessages[2].tool_calls[0].id === 'c1', 'OpenAI 工具结果用 tool 消息');
  const anthropicMessages = gateway.toAnthropicMessages([
    { role: 'assistant', content: '看一下', toolCalls: [{ id: 't1', name: 'list_documents', arguments: {} }] },
    { role: 'tool', toolCallId: 't1', content: '{"documents":[]}' }
  ]);
  assert(anthropicMessages[0].content[1].type === 'tool_use' && anthropicMessages[1].content[0].type === 'tool_result', 'Anthropic 工具结果用 tool_result');
  const parsed = gateway.parseOpenAICompletion({ choices: [{ message: { content: '好', tool_calls: [{ id: 'a', function: { name: 'list_documents', arguments: '{}' } }] } }] });
  assert(parsed.toolCalls[0].name === 'list_documents' && parsed.text === '好', '能解析 OpenAI 工具调用');
  const anthropicParsed = gateway.parseAnthropicCompletion({ content: [{ type: 'tool_use', id: 'b', name: 'read_local_file', input: { path: 'a.txt' } }] });
  assert(anthropicParsed.toolCalls[0].arguments.path === 'a.txt' && anthropicParsed.toolCalls[0].name === 'read_local_file', '能解析 Anthropic 工具调用');
  assert(!gateway.supportsTools({ provider: 'custom-rpc', model: 'x', apiKey: 'k', baseUrl: 'https://example.com' }).ok, '未知协议会明确拒绝工具调用');

  console.log('\n== 消防演练报告 ==');
  const drill = engine.start(first.id, { task: '帮我整理今年的消防演练记录，找出已经开展的演练、参与情况和存在的问题，生成一份年度消防演练总结报告，保存到我的工作文档中。' }, { complete: drillModel() });
  const drillResult = await drill.done;
  assert(drillResult.status === 'completed', '演练任务完成：' + (drillResult.error || drillResult.status));
  const drillFile = path.join(instanceDir(first.id), 'documents', '年度消防演练总结报告.md');
  const drillText = fs.readFileSync(drillFile, 'utf8');
  assert(drillText.indexOf('疏散演练') >= 0 && drillText.indexOf('部分员工未听到警报') >= 0, '报告里的演练和问题来自台账原文');
  assert(drillText.indexOf('冬季疏散') < 0, '去年的演练没有被写进今年的报告');
  assert(drillText.indexOf('地点：未找到') >= 0, '缺地点的记录标成未找到');
  assert(drillText.indexOf('消防演练记录.csv') >= 0 && drillText.indexOf('消防管理制度.txt') >= 0, '报告保留了两份资料来源');
  assert(drillResult.savedDocuments.some(function (file) { return file.rel === '年度消防演练总结报告.md'; }), '任务结果里的文件名和实际保存一致');
  const page = fs.readFileSync(path.join(root, 'samples', 'park-fire-assistant', 'workspace', 'scripts', 'main.js'), 'utf8');
  assert(page.indexOf('ai.execute') >= 0 && page.indexOf('getTaskStatus') >= 0 && page.indexOf('confirmAction') >= 0, '工作台页面会展示进度并提交确认');

  console.log('\n== 待整改清单 ==');
  const hazard = await engine.start(first.id, { task: '根据现有消防隐患台账，找出尚未完成整改的隐患，整理成一份待整改清单。' }, { complete: hazardModel() }).done;
  assert(hazard.status === 'completed', '隐患清单任务完成');
  const hazardText = fs.readFileSync(path.join(instanceDir(first.id), 'documents', '待整改隐患清单.md'), 'utf8');
  assert(hazardText.indexOf('YH-01') >= 0 && hazardText.indexOf('YH-03') >= 0, '未完成和整改中的隐患都在清单里');
  assert(hazardText.indexOf('YH-02') < 0, '已完成的隐患没有被列进待整改清单');
  assert(hazardText.indexOf('消防隐患台账.csv') >= 0, '每条隐患保留了台账来源');

  console.log('\n== 用户确认后才改数据 ==');
  const update = engine.start(first.id, { task: '把 YH-01 这条隐患的整改状态修改为已完成。' }, { complete: updateModel() });
  let waiting;
  for (let i = 0; i < 40; i++) {
    waiting = engine.getStatus(first.id, update.taskId);
    if (waiting.status === 'waiting_confirmation' || waiting.status === 'failed' || waiting.status === 'completed') break;
    await delay(20);
  }
  assert(waiting.status === 'waiting_confirmation', '修改业务数据前进入等待确认');
  assert(waiting.pendingAction.before.indexOf('未完成') >= 0 && waiting.pendingAction.after.indexOf('已完成') >= 0, '确认框展示修改前后的状态');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), 'utf8').indexOf('"status": "未完成"') >= 0, '用户确认前数据没有被改掉');
  engine.confirm(first.id, { taskId: update.taskId, actionId: waiting.pendingAction.id, approved: true });
  const updated = await update.done;
  assert(updated.status === 'completed' && updated.report.indexOf('复核状态：已完成') >= 0, '确认后的结果来自重新读取的数据');
  const stored = JSON.parse(fs.readFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), 'utf8'));
  assert(stored.items.find(function (item) { return item.id === 'YH-01'; }).status === '已完成', '业务数据文件已经更新');
  assert(stored.items.find(function (item) { return item.id === 'YH-03'; }).status === '整改中', '没有改到其他隐患');

  const rejectRun = engine.start(first.id, { task: '把 YH-03 的整改状态改成已完成。' }, { complete: function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) return Promise.resolve({ text: '', toolCalls: [{ id: 'd1', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] });
    const last = parseTool(tools[tools.length - 1]);
    if (last.value) {
      const next = JSON.parse(JSON.stringify(last.value));
      next.items.forEach(function (item) { if (item.id === 'YH-03') item.status = '已完成'; });
      return Promise.resolve({ text: '', toolCalls: [{ id: 'w1', name: 'write_workspace_data', arguments: { name: 'hazards.json', value: next } }] });
    }
    return Promise.resolve({ text: '未修改该隐患。', toolCalls: [] });
  } });
  let rejecting;
  for (let i = 0; i < 40; i++) {
    rejecting = engine.getStatus(first.id, rejectRun.taskId);
    if (rejecting.status === 'waiting_confirmation') break;
    await delay(20);
  }
  engine.confirm(first.id, { taskId: rejectRun.taskId, actionId: rejecting.pendingAction.id, approved: false });
  const rejected = await rejectRun.done;
  assert(rejected.status === 'completed' && rejected.report.indexOf('未修改') >= 0, '拒绝后任务说明没有修改');
  const afterReject = JSON.parse(fs.readFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), 'utf8'));
  assert(afterReject.items.find(function (item) { return item.id === 'YH-03'; }).status === '整改中', '拒绝后原状态还在');

  console.log('\n== 隔离、取消、上限和越权 ==');
  const isolated = engine.start(first.id, { task: '只给甲保存一份说明。' }, { complete: async function (input) {
    await delay(40);
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) return { text: '', toolCalls: [{ id: 'c1', name: 'create_document', arguments: { title: '隔离测试', content: '只属于甲', format: 'md' } }] };
    return { text: '已保存 ' + parseTool(tools[0]).rel, toolCalls: [] };
  } });
  library.switchAssistant(second.id);
  const isolatedResult = await isolated.done;
  assert(isolatedResult.status === 'completed', '切换助手后原任务仍能完成');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'documents', '隔离测试.md'), 'utf8') === '只属于甲', '文件写在发起任务的助手里');
  assert(!fs.existsSync(path.join(instanceDir(second.id), 'documents', '隔离测试.md')), '文件没有写进切换后的助手');
  library.switchAssistant(first.id);

  const cancelled = engine.start(first.id, { task: '这个任务会被取消。' }, { complete: function (input) {
    return new Promise(function (_resolve, reject) {
      const timer = setTimeout(function () { reject(new Error('不该等到这里')); }, 5000);
      input.signal.addEventListener('abort', function () {
        clearTimeout(timer);
        const error = new Error('任务已取消');
        error.name = 'AbortError';
        reject(error);
      });
    });
  } });
  engine.cancel(first.id, { taskId: cancelled.taskId });
  const cancelledResult = await cancelled.done;
  assert(cancelledResult.status === 'cancelled', '取消后的状态是 cancelled');

  const limited = await engine.start(first.id, { task: '一直列文档。' }, {
    limits: { rounds: 3, toolCalls: 30, modelMs: 2000, toolMs: 2000, taskMs: 10000 },
    complete: async function () {
      return { text: '', toolCalls: [{ id: 't' + Math.random(), name: 'list_documents', arguments: {} }] };
    }
  }).done;
  assert(limited.status === 'failed' && limited.error.indexOf('3 轮') >= 0, '超过轮数后停止：' + limited.error);

  const denied = await engine.start(first.id, { task: '读一个未授权文件。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) return { text: '', toolCalls: [{ id: 'p1', name: 'read_local_file', arguments: { path: 'C:\\Windows\\win.ini' } }] };
    return { text: '未找到未授权文件的内容。', toolCalls: [] };
  } }).done;
  assert(denied.status === 'failed' && denied.report.indexOf('未找到') >= 0, '无权读取时不会当成任务已经完成');
  const deniedTask = taskRegistry.load(first.id, denied.id);
  assert(deniedTask.toolLog.some(function (item) { return item.ok === false && item.error.indexOf('授权目录') >= 0; }), '越权读取被记录为失败');
  assert(denied.programNote.indexOf('read_local_file') >= 0, '读取失败的原因写进任务说明');
  const deniedTool = deniedTask.thread.find(function (message) { return message.role === 'tool' && message.name === 'read_local_file'; });
  assert(deniedTool && deniedTool.content.indexOf('授权') >= 0, '模型收到的工具结果里有失败原因');

  const shell = await engine.start(first.id, { task: '执行命令。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) return { text: '', toolCalls: [{ id: 'sh', name: 'run_shell', arguments: { command: 'dir' } }] };
    return { text: '未执行系统命令。', toolCalls: [] };
  } }).done;
  assert(shell.report.indexOf('未执行系统命令') >= 0, '未登记的命令工具不会被执行');

  console.log('\n== 任务记录 ==');
  const savedTask = fs.readFileSync(path.join(instanceDir(first.id), 'tasks', drill.taskId + '.json'), 'utf8');
  assert(savedTask.indexOf('"status": "completed"') >= 0, '任务记录写在该助手的 tasks 目录');
  assert(!/apiKey|authorization/i.test(savedTask), '任务记录没有 API Key');
  const otherHistory = engine.history(second.id);
  assert(!otherHistory.some(function (item) { return item.id === drill.taskId; }), '另一个助手看不到这条任务');
  let foreign = '';
  try { engine.getStatus(second.id, drill.taskId); }
  catch (e) { foreign = e.message; }
  assert(foreign.indexOf('任务不存在') >= 0, '不能用别的助手读取这条任务');
  fs.writeFileSync(path.join(instanceDir(first.id), 'tasks', 'task-stale.json'), JSON.stringify({
    id: 'task-stale', instanceId: first.id, status: 'running', request: '中断', startedAt: new Date().toISOString(), toolLog: []
  }), 'utf8');
  taskRegistry.recover(first.id);
  assert(taskRegistry.load(first.id, 'task-stale').status === 'failed', '重启时未完成的运行中任务标成中断');
  assert(taskRegistry.load(first.id, 'task-stale').error.indexOf('任务中断') >= 0, '中断原因写在任务记录里');
  fs.writeFileSync(path.join(instanceDir(first.id), 'tasks', 'task-wait.json'), JSON.stringify({
    id: 'task-wait', instanceId: first.id, status: 'waiting_confirmation', request: '等确认',
    startedAt: new Date().toISOString(), savedDocuments: [{ rel: '年度消防演练总结报告.md' }], toolLog: []
  }), 'utf8');
  fs.writeFileSync(path.join(instanceDir(first.id), 'tasks', 'task-done.json'), JSON.stringify({
    id: 'task-done', instanceId: first.id, status: 'completed', request: '已完成',
    startedAt: new Date().toISOString(), report: '完成', toolLog: []
  }), 'utf8');
  taskRegistry.recover(first.id);
  const waited = taskRegistry.load(first.id, 'task-wait');
  const doneTask = taskRegistry.load(first.id, 'task-done');
  assert(waited.status === 'failed' && waited.error.indexOf('等待确认的操作没有执行') >= 0, '等待确认的任务在重启后标成未执行');
  assert(doneTask.status === 'completed', '已完成的任务不会被改成失败');
  assert(fs.existsSync(path.join(instanceDir(first.id), 'documents', '年度消防演练总结报告.md')), '中断不会删掉已经保存的文件');

  console.log('\n== 超时、确认中取消、失败和部分成功 ==');
  const beforeTimeout = fs.readdirSync(path.join(instanceDir(first.id), 'documents'));
  const timed = await engine.start(first.id, { task: '这个请求会超时。' }, {
    limits: { rounds: 2, toolCalls: 4, modelMs: 40, toolMs: 40, taskMs: 1000 },
    complete: function (input) {
      return new Promise(function (_resolve, reject) {
        const timer = setTimeout(function () { reject(new Error('模型不该继续')); }, 400);
        const stop = function () {
          clearTimeout(timer);
          const error = new Error('任务已取消');
          error.name = 'AbortError';
          reject(error);
        };
        if (input.signal.aborted) stop();
        else input.signal.addEventListener('abort', stop, { once: true });
      });
    }
  }).done;
  assert(timed.status === 'failed' && timed.error.indexOf('超时') >= 0, '模型超时后任务失败并说明原因');
  assert(fs.readdirSync(path.join(instanceDir(first.id), 'documents')).join() === beforeTimeout.join(), '超时后没有新增文件');

  const blocked = new AbortController();
  blocked.abort();
  let refused = '';
  try {
    await executor.run(first.id, { id: 'late', name: 'create_document', arguments: { title: '不该出现', content: '迟到的写入', format: 'md' } }, blocked.signal);
  } catch (e) { refused = e.message; }
  assert(refused.indexOf('取消') >= 0 && !fs.existsSync(path.join(instanceDir(first.id), 'documents', '不该出现.md')), '取消后的工具不会继续写文件');

  const snapshot = fs.readFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), 'utf8');
  const hold = engine.start(first.id, { task: '准备修改但马上取消。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) return { text: '', toolCalls: [{ id: 'd1', name: 'read_workspace_data', arguments: { name: 'hazards.json' } }] };
    const current = parseTool(tools[0]);
    const next = JSON.parse(JSON.stringify(current.value));
    next.items[0].status = '取消后不该出现';
    return { text: '', toolCalls: [{ id: 'w1', name: 'write_workspace_data', arguments: { name: 'hazards.json', value: next } }] };
  } });
  let holding;
  for (let i = 0; i < 40; i++) {
    holding = engine.getStatus(first.id, hold.taskId);
    if (holding.status === 'waiting_confirmation') break;
    await delay(20);
  }
  const holdView = engine.cancel(first.id, { taskId: hold.taskId });
  assert(holdView.status === 'cancelled' && !holdView.pendingAction, '取消后马上是已取消，确认卡片也去掉了');
  const held = await hold.done;
  assert(held.status === 'cancelled' && held.error.indexOf('任务已取消') >= 0, '等待确认时可以取消');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'data', 'hazards.json'), 'utf8').indexOf('取消后不该出现') < 0, '取消后业务数据没有变化');

  const claimed = await engine.start(first.id, { task: '请保存一份不存在的报告。' }, { complete: async function () {
    return { text: '报告已经保存。', toolCalls: [] };
  } }).done;
  assert(claimed.status === 'failed' && claimed.programNote.indexOf('没有写入任何文档') >= 0, '只说已保存但没有文件时，任务不算完成');

  const partial = await engine.start(first.id, { task: '先保存一部分，再保存一份空文档。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) {
      return { text: '', toolCalls: [{ id: 'ok1', name: 'create_document', arguments: { title: '部分成果', content: '已经写好的部分', format: 'md' } }] };
    }
    if (tools.length === 1) {
      return { text: '', toolCalls: [{ id: 'bad1', name: 'create_document', arguments: { title: '空文档', content: '', format: 'md' } }] };
    }
    return { text: '两份都已经保存。', toolCalls: [] };
  } }).done;
  assert(partial.status === 'failed' && partial.programNote.indexOf('未完成的关键步骤') >= 0, '关键步骤失败时不会报全部完成');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'documents', '部分成果.md'), 'utf8') === '已经写好的部分', '已经写成的文件仍然保留');
  assert(!fs.existsSync(path.join(instanceDir(first.id), 'documents', '空文档.md')), '失败的文档没有被写进去');

  console.log('\n== 失败不可说成全部完成、隔离读取、覆盖确认 ==');
  const mixed = await engine.start(first.id, { task: '列出文档，并读取一个未授权文件。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) {
      return { text: '', toolCalls: [
        { id: 'mix-ok', name: 'list_documents', arguments: {} },
        { id: 'mix-bad', name: 'read_local_file', arguments: { path: 'C:\\Windows\\win.ini' } }
      ] };
    }
    return { text: '任务已经全部完成。', toolCalls: [] };
  } }).done;
  assert(mixed.status === 'failed', '部分工具失败时不能记成全部完成');
  const mixedTask = taskRegistry.load(first.id, mixed.id);
  assert(mixedTask.toolLog.some(function (item) { return item.name === 'list_documents' && item.ok; }), '成功的工具单独记成成功');
  assert(mixedTask.toolLog.some(function (item) { return item.name === 'read_local_file' && item.ok === false; }), '失败的工具单独记成失败');
  const mixedTool = mixedTask.thread.find(function (message) { return message.name === 'read_local_file'; });
  assert(mixedTool && mixedTool.content.indexOf('error') >= 0, '失败原因按工具结果交回模型');

  const privatePath = path.join(instanceDir(first.id), 'data', 'hazards.json');
  const otherData = await executor.run(second.id, { id: 'od', name: 'read_workspace_data', arguments: { name: 'hazards.json' } });
  assert(!otherData.ok && JSON.stringify(otherData).indexOf('YH-01') < 0, '其他助手读不到这份业务数据');
  const sneak = await executor.run(second.id, { id: 'sn', name: 'read_local_file', arguments: { path: privatePath } });
  assert(!sneak.ok && sneak.error.indexOf('授权') >= 0, '不能按路径读取其他助手实例里的文件');
  const searched = await executor.run(second.id, { id: 'sec', name: 'search_local_files', arguments: { query: '只属于甲' } });
  assert(searched.ok && !(searched.result.hits || []).some(function (hit) {
    return String(hit.path || '').indexOf(first.id) >= 0;
  }), '搜索没有带回另一个助手的私有文件');

  const originalReport = fs.readFileSync(path.join(instanceDir(first.id), 'documents', '年度消防演练总结报告.md'), 'utf8');
  const overwrite = engine.start(first.id, { task: '覆盖年度消防演练总结报告。' }, { complete: async function (input) {
    const tools = (input.messages || []).filter(function (message) { return message.role === 'tool'; });
    if (!tools.length) {
      return { text: '', toolCalls: [{ id: 'ov1', name: 'create_document', arguments: { title: '年度消防演练总结报告', content: '覆盖后的内容', format: 'md' } }] };
    }
    return { text: '没有覆盖。', toolCalls: [] };
  } });
  let overwriting;
  for (let i = 0; i < 40; i++) {
    overwriting = engine.getStatus(first.id, overwrite.taskId);
    if (overwriting.status === 'waiting_confirmation') break;
    await delay(20);
  }
  assert(overwriting.status === 'waiting_confirmation', '覆盖已有文档前要确认');
  engine.confirm(first.id, { taskId: overwrite.taskId, actionId: overwriting.pendingAction.id, approved: false });
  const overwriteRejected = await overwrite.done;
  assert(overwriteRejected.status === 'completed' && overwriteRejected.report.indexOf('没有覆盖') >= 0, '拒绝覆盖后任务说明没有改文件');
  assert(fs.readFileSync(path.join(instanceDir(first.id), 'documents', '年度消防演练总结报告.md'), 'utf8') === originalReport, '拒绝后原文还在');

  console.log('\n== 取消立刻停模型，超时后不再写文件 ==');
  writeJson(PATHS.settings, {
    provider: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'local-test-key',
    model: 'deepseek-chat',
    temperature: 0
  });
  const originalFetch = global.fetch;
  let seenSignal = null;
  global.fetch = function (_url, options) {
    seenSignal = options && options.signal;
    return new Promise(function (_resolve, reject) {
      const stop = function () {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (!options || !options.signal) {
        reject(new Error('模型请求没有带上 signal'));
        return;
      }
      if (options.signal.aborted) stop();
      else options.signal.addEventListener('abort', stop, { once: true });
    });
  };
  try {
    const live = engine.start(first.id, { task: '请检索已授权的消防资料。' }, {
      limits: { rounds: 2, toolCalls: 2, modelMs: 3000, toolMs: 2000, taskMs: 8000 }
    });
    await delay(30);
    const view = engine.cancel(first.id, { taskId: live.taskId });
    assert(view.status === 'cancelled' && view.error.indexOf('任务已取消') >= 0, '取消接口立刻返回已取消');
    const ended = await live.done;
    assert(ended.status === 'cancelled', '模型请求取消后任务不再继续');
    assert(seenSignal && seenSignal.aborted, '模型请求使用的 signal 已经中止');
    const disk = taskRegistry.load(first.id, live.taskId);
    assert(disk.status === 'cancelled' && !disk.pendingAction, '取消后的任务记录里没有残留确认');
  } finally {
    global.fetch = originalFetch;
  }

  const realRun = executor.run;
  const lateWrites = [];
  let toolEntered = false;
  executor.run = function (instanceId, call, signal) {
    const title = call && call.arguments && call.arguments.title;
    if (title === '取消后迟到' || title === '超时后迟到') {
      toolEntered = true;
      return new Promise(function (resolve, reject) {
        const runLate = function () {
          realRun(instanceId, call, signal).then(function (result) {
            lateWrites.push(title + ':' + (result && result.ok ? 'wrote' : 'refused'));
            resolve(result);
          }, function () {
            lateWrites.push(title + ':threw');
          });
        };
        const timer = setTimeout(runLate, 150);
        if (!signal) return;
        const stop = function () {
          clearTimeout(timer);
          const error = title === '超时后迟到'
            ? Object.assign(new Error('工具超时'), { name: 'TimeoutError', code: 'TIMEOUT' })
            : Object.assign(new Error('任务已取消'), { name: 'AbortError' });
          reject(error);
          setTimeout(runLate, 40);
        };
        if (signal.aborted) stop();
        else signal.addEventListener('abort', stop, { once: true });
      });
    }
    return realRun.apply(executor, arguments);
  };
  try {
    const slowCancel = engine.start(first.id, { task: '取消一个正在写的文档。' }, {
      limits: { rounds: 2, toolCalls: 2, modelMs: 2000, toolMs: 2000, taskMs: 8000 },
      complete: async function () {
        return { text: '', toolCalls: [{ id: 'slow-cancel', name: 'create_document', arguments: { title: '取消后迟到', content: '不该留下', format: 'md' } }] };
      }
    });
    for (let i = 0; i < 50 && !toolEntered; i++) await delay(10);
    assert(toolEntered, '写入工具已经开始，随后才取消');
    toolEntered = false;
    const slowView = engine.cancel(first.id, { taskId: slowCancel.taskId });
    assert(slowView.status === 'cancelled', '工具还在等待时取消，界面状态已经是已取消');
    const slowEnded = await slowCancel.done;
    await delay(120);
    assert(slowEnded.status === 'cancelled', '迟到的工具结束后任务仍是已取消');
    assert(!fs.existsSync(path.join(instanceDir(first.id), 'documents', '取消后迟到.md')), '取消后迟到的写入没有落盘');
    assert(lateWrites.indexOf('取消后迟到:wrote') < 0, '取消后的工具调用被拒绝');

    const slowTimeout = await engine.start(first.id, { task: '工具会超时。' }, {
      limits: { rounds: 2, toolCalls: 2, modelMs: 2000, toolMs: 40, taskMs: 8000 },
      complete: async function () {
        return { text: '', toolCalls: [{ id: 'slow-timeout', name: 'create_document', arguments: { title: '超时后迟到', content: '不该留下', format: 'md' } }] };
      }
    }).done;
    await delay(120);
    assert(slowTimeout.status === 'failed' && slowTimeout.error.indexOf('超时') >= 0, '工具超时后任务失败');
    assert(!fs.existsSync(path.join(instanceDir(first.id), 'documents', '超时后迟到.md')), '超时后迟到的写入没有落盘');
    assert(lateWrites.indexOf('超时后迟到:wrote') < 0, '超时后的工具调用被拒绝');
    const timeoutTask = taskRegistry.load(first.id, slowTimeout.id);
    assert(timeoutTask.toolLog.some(function (item) { return item.name === 'create_document' && item.ok === false; }), '超时的工具记成失败');
  } finally {
    executor.run = realRun;
  }

  console.log('\n== 符号链接与进程重启恢复 ==');
  const outside = path.join(tmpUser, 'outside-write');
  fs.mkdirSync(outside, { recursive: true });
  let linkOk = false;
  try {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(instanceDir(first.id), 'documents', '越权链接.md'), 'file');
    fs.symlinkSync(path.join(outside, 'secret.json'), path.join(instanceDir(first.id), 'data', 'linked.json'), 'file');
    linkOk = true;
  } catch (e) {
    console.log('  [SKIP] 当前环境不能创建符号链接，跳过越权写入测试：' + e.message);
  }
  if (linkOk) {
    const linkedDoc = await executor.run(first.id, { id: 'link1', name: 'create_document', arguments: { title: '越权链接', content: '不应写到外面', format: 'md' } });
    assert(!linkedDoc.ok && linkedDoc.error.indexOf('符号链接') >= 0, '符号链接不会被当成普通新文档写入');
    assert(!fs.existsSync(path.join(outside, 'secret.md')), '文档没有沿着符号链接写到助手外面');
    const proposed = await executor.run(first.id, { id: 'link2', name: 'write_workspace_data', arguments: { name: 'linked.json', value: { pwned: true } } });
    assert(proposed.needsConfirmation, '符号链接上的业务数据仍然先走确认');
    const committed = await executor.commit(first.id, proposed.proposal);
    assert(!committed.ok, '确认后也不会沿着符号链接写出');
    assert(!fs.existsSync(path.join(outside, 'secret.json')), '业务数据没有沿着符号链接写到助手外面');
  }
  const junctionOutside = path.join(tmpUser, 'junction-outside');
  fs.mkdirSync(junctionOutside, { recursive: true });
  fs.symlinkSync(junctionOutside, path.join(instanceDir(first.id), 'data', 'escape'), 'junction');
  const viaJunction = await executor.run(first.id, { id: 'j1', name: 'write_workspace_data', arguments: { name: 'escape/pwned.json', value: { pwned: true } } });
  assert(viaJunction.needsConfirmation, '指向外部的目录也要先确认');
  const junctionCommit = await executor.commit(first.id, viaJunction.proposal);
  assert(!junctionCommit.ok, '确认后也不会写到助手目录外面');
  assert(!fs.existsSync(path.join(junctionOutside, 'pwned.json')), '业务数据没有写进外部目录');

  const indexSrc = fs.readFileSync(path.join(root, 'src', 'main', 'index.js'), 'utf8');
  const librarySrc = fs.readFileSync(path.join(root, 'src', 'main', 'library.js'), 'utf8');
  assert(indexSrc.indexOf('recoverInterrupted()') >= 0, '主进程启动时会调用中断任务恢复');
  assert(librarySrc.indexOf('recoverInterrupted()') >= 0, '资料库初始化时会调用中断任务恢复');
  const docFile = path.join(instanceDir(first.id), 'documents', '重启保留.md');
  const absentFile = path.join(instanceDir(first.id), 'documents', '不该因为重启出现.md');
  fs.writeFileSync(docFile, '保留原文', 'utf8');
  const stamp = new Date().toISOString();
  function writeTask(id, body) {
    fs.writeFileSync(path.join(instanceDir(first.id), 'tasks', id + '.json'), JSON.stringify(Object.assign({
      id: id, instanceId: first.id, request: id, startedAt: stamp, toolLog: [], activity: []
    }, body)), 'utf8');
  }
  writeTask('task-boot-wait', {
    status: 'waiting_confirmation',
    pendingAction: { id: 'act-boot', title: '更新业务数据', target: 'hazards.json', before: '前', after: '后' }
  });
  writeTask('task-boot-run', { status: 'planning' });
  writeTask('task-boot-done', { status: 'completed', report: '原报告', finishedAt: stamp });
  writeTask('task-boot-cancel', { status: 'cancelled', error: '任务已取消', finishedAt: stamp });
  writeTask('task-foreign', { instanceId: second.id, status: 'running' });
  fs.writeFileSync(path.join(tmpUser, 'restart-expect.json'), JSON.stringify({
    instanceId: first.id,
    waitingId: 'task-boot-wait',
    runningId: 'task-boot-run',
    doneId: 'task-boot-done',
    cancelledId: 'task-boot-cancel',
    docFile: docFile,
    docText: '保留原文',
    absentFile: absentFile
  }), 'utf8');
  const child = spawnSync(process.execPath, [path.join(root, 'tools', 'task-engine-test.js'), '--restart-check'], {
    cwd: root,
    encoding: 'utf8'
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.status !== 0 && child.stderr) process.stderr.write(child.stderr);
  assert(child.status === 0, '独立进程里的启动恢复失败');
  const foreignTask = taskRegistry.load(first.id, 'task-foreign');
  assert(foreignTask && foreignTask.status === 'failed' && foreignTask.error.indexOf('实例不一致') >= 0, '串实例的任务记录被停掉');
  assert(!fs.existsSync(path.join(instanceDir(second.id), 'tasks', 'task-foreign.json')), '恢复没有把任务写进另一个助手');
  let expired = '';
  try { engine.confirm(first.id, { taskId: 'task-boot-wait', actionId: 'act-boot', approved: true }); }
  catch (e) { expired = e.message; }
  assert(expired.indexOf('没有等待确认') >= 0, '重启后不能再确认中断前的操作');
  assert(fs.readFileSync(docFile, 'utf8') === '保留原文', '主进程侧也能看到重启没有改文件');

  console.log('\n任务引擎测试结束。');
}

main().then(function () {
  fs.rmSync(tmpUser, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}, function (error) {
  console.error('\n[ERROR] ' + (error.stack || error));
  fs.rmSync(tmpUser, { recursive: true, force: true });
  process.exit(1);
});
