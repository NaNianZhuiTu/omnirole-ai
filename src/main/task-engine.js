/* 任务执行：模型提出工具调用，程序检查并执行，再把真实结果交回模型。 */
'use strict';
const model = require('./model-gateway');
const tools = require('./tool-registry');
const executor = require('./tool-executor');
const registry = require('./task-registry');
const library = require('./library');

const LIMITS = { rounds: 12, toolCalls: 30, modelMs: 45000, toolMs: 15000, taskMs: 180000 };
const runners = new Map();
let progressSink = function () {};

function setProgressSink(fn) { progressSink = typeof fn === 'function' ? fn : function () {}; }

function newId() {
  return 'task-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function publicView(task) {
  if (!task) return null;
  return {
    id: task.id,
    instanceId: task.instanceId,
    request: task.request,
    status: task.status,
    plan: task.plan || [],
    activity: task.activity || [],
    pendingAction: task.pendingAction ? {
      id: task.pendingAction.id,
      title: task.pendingAction.title,
      target: task.pendingAction.target,
      before: task.pendingAction.before,
      after: task.pendingAction.after
    } : null,
    savedDocuments: task.savedDocuments || [],
    dataWrites: task.dataWrites || [],
    report: task.report || '',
    programNote: task.programNote || '',
    error: task.error || '',
    startedAt: task.startedAt || '',
    finishedAt: task.finishedAt || '',
    toolCount: (task.toolLog || []).length
  };
}

function publish(task) {
  registry.save(task);
  try { progressSink(task.instanceId, publicView(task)); } catch (e) { /* 页面不在时不影响任务 */ }
}

function systemPrompt(pkg) {
  return [
    '你是「' + ((pkg && pkg.name) || '岗位') + '」的岗位工作助手。用户交给你的是要完成的工作，不是闲聊。',
    '你只能通过工具读取资料、查询索引、保存文档和准备数据更新。程序会真正执行工具。',
    '没有工具结果的内容一律写成「未找到」，不得编造数字、日期、人员或整改状态。',
    '说「已保存」之前，必须先成功调用 create_document。用户是否同意修改数据，只以程序返回的确认结果为准。',
    '每条结论都要带上工具结果里的文件名或定位信息。'
  ].join('\n');
}

function withTimeout(work, ms, signal, label) {
  const controller = new AbortController();
  let settled = false;
  let timer = null;
  function detach(onAbort) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  return new Promise(function (resolve, reject) {
    const finish = function (fn, value) {
      if (settled) return;
      settled = true;
      detach(onAbort);
      fn(value);
    };
    const onAbort = function () {
      const error = new Error('任务已取消');
      error.name = 'AbortError';
      try { controller.abort(error); } catch (e) { /* 已经中止 */ }
      finish(reject, error);
    };
    timer = setTimeout(function () {
      const error = new Error(label + '超时');
      error.name = 'TimeoutError';
      error.code = 'TIMEOUT';
      try { controller.abort(error); } catch (e) { /* 已经中止 */ }
      finish(reject, error);
    }, ms);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort);
    }
    Promise.resolve().then(function () { return work(controller.signal); }).then(function (value) {
      if (controller.signal.aborted) return;
      finish(resolve, value);
    }, function (error) {
      if (settled) return;
      if (signal && signal.aborted) return onAbort();
      if (controller.signal.aborted && controller.signal.reason && controller.signal.reason.code === 'TIMEOUT') {
        finish(reject, controller.signal.reason);
        return;
      }
      finish(reject, error);
    });
  });
}

function isCancel(error) {
  return !!(error && (error.name === 'AbortError' || error.message === '任务已取消'));
}

function isTimeout(error) {
  return !!(error && (error.name === 'TimeoutError' || error.code === 'TIMEOUT'));
}

function terminal(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function clip(text) {
  const value = String(text || '');
  return value.length > 12000 ? value.slice(0, 12000) + '\n…（结果已截断）' : value;
}

function rememberResult(task, call, outcome) {
  task.toolLog.push({
    id: call.id,
    name: call.name,
    ok: !!outcome.ok,
    error: outcome.error || '',
    at: new Date().toISOString()
  });
  if (outcome.activity) task.activity.push({ at: new Date().toISOString(), text: outcome.activity });
  if (outcome.savedDocument) task.savedDocuments.push(outcome.savedDocument);
  if (outcome.dataWrite) task.dataWrites.push({ name: outcome.dataWrite.name, bytes: outcome.dataWrite.bytes });
  task.thread.push({
    role: 'tool',
    toolCallId: call.id,
    name: call.name,
    content: clip(JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error || '执行失败' }))
  });
}

async function finish(task, status, extra) {
  if (terminal(task.status)) {
    runners.delete(task.id);
    return publicView(task);
  }
  task.status = status;
  task.finishedAt = new Date().toISOString();
  task.pendingAction = null;
  if (extra && extra.error) task.error = extra.error;
  if (status === 'cancelled' && !task.error) task.error = '任务已取消';
  if (extra && extra.report != null) task.report = extra.report;
  if (extra && extra.programNote) task.programNote = extra.programNote;
  if (!Array.isArray(task.activity)) task.activity = [];
  if ((status === 'cancelled' || status === 'failed') && task.error) {
    if (!task.activity.some(function (item) { return item.text === task.error; })) {
      task.activity.push({ at: task.finishedAt, text: task.error });
    }
  }
  publish(task);
  runners.delete(task.id);
  return publicView(task);
}

function conclude(task, modelText) {
  task.report = modelText || '';
  const failed = (task.toolLog || []).filter(function (item) {
    return !item.ok && item.error !== '用户拒绝了该操作';
  });
  const critical = failed.filter(function (item) {
    return item.name === 'create_document' || item.name === 'write_workspace_data';
  });
  const saved = (task.savedDocuments || []).length;
  const wrote = (task.dataWrites || []).length;
  const notes = [];
  if (/已保存|已经保存/.test(task.report) && !saved) {
    notes.push('程序没有写入任何文档。模型里的“已保存”没有对应的文件。');
  }
  if (critical.length) {
    notes.push('未完成的关键步骤：' + critical.map(function (item) {
      return item.name + '：' + item.error;
    }).join('；'));
  }
  const others = failed.filter(function (item) { return critical.indexOf(item) < 0; });
  if (others.length) {
    notes.push('有步骤没有成功：' + others.map(function (item) {
      return item.name + '：' + item.error;
    }).join('；'));
  }
  task.programNote = notes.join('');
  const claimedOnly = /已保存|已经保存/.test(task.report) && !saved;
  if (failed.length && (saved || wrote)) {
    return finish(task, 'failed', {
      report: task.report,
      error: '部分成果已保留，仍有步骤未完成。' + task.programNote,
      programNote: task.programNote
    });
  }
  if (failed.length || claimedOnly) {
    return finish(task, 'failed', {
      report: task.report,
      error: task.programNote || '有步骤没有完成，任务未全部完成。',
      programNote: task.programNote
    });
  }
  return finish(task, 'completed', { report: task.report, programNote: task.programNote });
}

async function runLoop(task, signal, limits, complete) {
  let boundPkg = null;
  try { boundPkg = require('./package-loader').loadForInstance(task.instanceId, '').pkg; }
  catch (e) { boundPkg = null; }
  const deadline = Date.now() + limits.taskMs;
  let rounds = 0;
  while (rounds < limits.rounds) {
    if (task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
    if (Date.now() > deadline) return finish(task, 'failed', { error: '任务超过最长执行时间，已停止。' });
    rounds += 1;
    task.status = rounds === 1 ? 'planning' : 'running';
    publish(task);
    let reply;
    try {
      reply = await withTimeout(function (inner) {
        return complete({
          settings: model.getSettings(),
          system: systemPrompt(boundPkg),
          messages: task.thread,
          tools: tools.list(),
          signal: inner
        });
      }, limits.modelMs, signal, '模型请求');
    } catch (e) {
      if (isCancel(e) || task.status === 'cancelled') return finish(task, 'cancelled');
      return finish(task, 'failed', { error: e.message || '模型请求失败' });
    }
    if (task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
    const calls = reply && Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
    task.thread.push({ role: 'assistant', content: reply && reply.text || '', toolCalls: calls });
    if (!calls.length) {
      if (rounds === 1 && reply && reply.text) task.plan = String(reply.text).split(/\n+/).map(function (line) { return line.trim(); }).filter(Boolean).slice(0, 8);
      return conclude(task, reply && reply.text || '');
    }
    if (rounds === 1 && reply.text) task.plan = String(reply.text).split(/\n+/).filter(Boolean).slice(0, 8);
    for (let i = 0; i < calls.length; i++) {
      if (task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
      if (task.toolLog.length >= limits.toolCalls) {
        return finish(task, 'failed', { error: '工具调用超过 ' + limits.toolCalls + ' 次，已停止。' });
      }
      const call = calls[i];
      let outcome;
      try {
        outcome = await withTimeout(function (inner) {
          return executor.run(task.instanceId, call, inner);
        }, limits.toolMs, signal, '工具');
      } catch (e) {
        if (isCancel(e) || task.status === 'cancelled') return finish(task, 'cancelled');
        if (isTimeout(e)) {
          task.toolLog.push({ id: call.id, name: call.name, ok: false, error: e.message, at: new Date().toISOString() });
          if (!Array.isArray(task.activity)) task.activity = [];
          task.activity.push({ at: new Date().toISOString(), text: (call.name || '工具') + '已停止：' + e.message });
          return finish(task, 'failed', { error: e.message });
        }
        outcome = { ok: false, error: e.message, activity: (call.name || '工具') + ' 没有完成：' + e.message };
      }
      if (outcome.needsConfirmation) {
        task.pendingAction = outcome.proposal;
        task.status = 'waiting_confirmation';
        if (outcome.activity) task.activity.push({ at: new Date().toISOString(), text: outcome.activity });
        publish(task);
        const approved = await new Promise(function (resolve, reject) {
          const runner = runners.get(task.id);
          runner.decide = { actionId: outcome.proposal.id, resolve: resolve, reject: reject };
          const onAbort = function () {
            const error = new Error('任务已取消');
            error.name = 'AbortError';
            reject(error);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }).catch(function (error) {
          if (error && error.name === 'AbortError') return 'cancelled';
          throw error;
        });
        if (approved === 'cancelled' || task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
        task.confirmations.push({
          actionId: outcome.proposal.id,
          approved: approved === true,
          at: new Date().toISOString(),
          by: 'user'
        });
        task.pendingAction = null;
        task.status = 'running';
        if (approved !== true) {
          rememberResult(task, call, { ok: false, error: '用户拒绝了该操作', activity: '用户拒绝了：' + outcome.proposal.title });
          publish(task);
          continue;
        }
        if (task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
        try {
          outcome = await withTimeout(function (inner) {
            return executor.commit(task.instanceId, outcome.proposal, inner);
          }, limits.toolMs, signal, '工具');
        } catch (e) {
          if (isCancel(e) || task.status === 'cancelled') return finish(task, 'cancelled');
          if (isTimeout(e)) {
            task.toolLog.push({ id: call.id, name: call.name, ok: false, error: e.message, at: new Date().toISOString() });
            if (!Array.isArray(task.activity)) task.activity = [];
            task.activity.push({ at: new Date().toISOString(), text: '确认后的操作已停止：' + e.message });
            return finish(task, 'failed', { error: e.message });
          }
          outcome = { ok: false, error: e.message, activity: '确认后的操作没有完成：' + e.message };
        }
      }
      if (task.status === 'cancelled' || signal.aborted) return finish(task, 'cancelled');
      rememberResult(task, call, outcome);
      publish(task);
    }
  }
  return finish(task, 'failed', { error: '模型工具交互超过 ' + limits.rounds + ' 轮，已停止。' });
}

function start(instanceId, payload, options) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(instanceId || ''))) throw new Error('助手实例无效');
  const body = payload || {};
  const request = typeof body.task === 'string' ? body.task.trim() : '';
  if (!request) throw new Error('任务内容不能为空');
  if (request.length > 4000) throw new Error('任务内容过长');
  const found = (library.listInstances().instances || []).find(function (item) { return item.id === instanceId; });
  if (!found) throw new Error('助手实例不存在');
  const limits = Object.assign({}, LIMITS, options && options.limits || {});
  const complete = options && options.complete ? options.complete : model.completeWithTools;
  if (!options || !options.complete) {
    const support = model.supportsTools(model.getSettings());
    if (!support.ok) throw new Error(support.reason);
  }
  const task = {
    id: newId(),
    instanceId: instanceId,
    request: request,
    status: 'created',
    plan: ['理解任务', '检索并阅读授权资料', '生成并保存工作成果'],
    activity: [],
    toolLog: [],
    confirmations: [],
    savedDocuments: [],
    dataWrites: [],
    pendingAction: null,
    report: '',
    programNote: '',
    error: '',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    thread: [{ role: 'user', content: request }]
  };
  const controller = new AbortController();
  runners.set(task.id, { controller: controller, instanceId: instanceId, decide: null, task: task });
  publish(task);
  const done = runLoop(task, controller.signal, limits, complete).catch(function (e) {
    return finish(task, 'failed', { error: e.message || '任务失败' });
  });
  return { taskId: task.id, status: task.status, done: done };
}

function owned(instanceId, taskId) {
  const task = registry.load(instanceId, taskId);
  if (!task || task.instanceId !== instanceId) throw new Error('任务不存在');
  return task;
}

function getStatus(instanceId, taskId) {
  return publicView(owned(instanceId, taskId));
}

function history(instanceId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(instanceId || ''))) throw new Error('助手实例无效');
  return registry.list(instanceId).filter(function (task) { return task.instanceId === instanceId; }).slice(0, 50).map(publicView);
}

function confirm(instanceId, payload) {
  const body = payload || {};
  const task = owned(instanceId, body.taskId);
  if (task.status !== 'waiting_confirmation' || !task.pendingAction) throw new Error('当前没有等待确认的操作');
  if (body.actionId !== task.pendingAction.id) throw new Error('确认的操作和当前等待的操作不一致');
  if (typeof body.approved !== 'boolean') throw new Error('approved 必须是布尔值');
  const runner = runners.get(task.id);
  if (!runner || !runner.decide || runner.decide.actionId !== body.actionId) {
    throw new Error('这个确认已经过期。请重新发起任务。');
  }
  runner.decide.resolve(body.approved);
  runner.decide = null;
  return { accepted: true, taskId: task.id, approved: body.approved };
}

function cancel(instanceId, payload) {
  const stored = owned(instanceId, payload && payload.taskId);
  const runner = runners.get(stored.id);
  const task = runner && runner.task ? runner.task : stored;
  if (terminal(task.status)) return publicView(task);
  task.status = 'cancelled';
  task.finishedAt = new Date().toISOString();
  task.error = '任务已取消';
  if (!task.programNote) task.programNote = '任务已取消';
  task.pendingAction = null;
  if (!Array.isArray(task.activity)) task.activity = [];
  task.activity.push({ at: task.finishedAt, text: '任务已取消' });
  publish(task);
  if (runner) {
    if (runner.decide) {
      const error = new Error('任务已取消');
      error.name = 'AbortError';
      const decide = runner.decide;
      runner.decide = null;
      try { decide.reject(error); } catch (e) { /* 确认回调已经结束 */ }
    }
    try { runner.controller.abort(); } catch (e) { /* 已经中止 */ }
  }
  return publicView(task);
}

function recoverInterrupted() {
  (library.listInstances().instances || []).forEach(function (inst) { registry.recover(inst.id); });
}

module.exports = {
  LIMITS, setProgressSink, start, getStatus, history, confirm, cancel, recoverInterrupted, publicView
};
