/* 任务引擎测试：工具真实读写测试资料，模型用可重复的步骤编排，不把“成功”两个字当成结果。
 * 用法：node tools/task-engine-test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const root = path.join(__dirname, '..');
const tmpUser = path.join(root, '.task-test-userdata');
fs.rmSync(tmpUser, { recursive: true, force: true });
fs.mkdirSync(tmpUser, { recursive: true });

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
  const { instanceDir } = require('../src/main/paths');

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
  assert(denied.status === 'completed' && denied.report.indexOf('未找到') >= 0, '无权读取时不会当成已经读到');
  const deniedTask = taskRegistry.load(first.id, denied.id);
  assert(deniedTask.toolLog.some(function (item) { return item.ok === false && item.error.indexOf('授权目录') >= 0; }), '越权读取被记录为失败');

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
