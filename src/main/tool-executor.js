/* 执行已登记的工具。实例 ID 来自任务绑定，不看用户后来切换到了哪个助手。 */
'use strict';
const fs = require('fs');
const path = require('path');
const registry = require('./tool-registry');
const workspaceApi = require('./workspace-api');
const indexer = require('./indexer');
const { instanceDir } = require('./paths');
const { isInside } = require('./safe-path');

function checkArgs(tool, args) {
  if (args && args.__invalidJson) throw new Error('工具参数不是合法 JSON');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
  ['__proto__', 'constructor', 'prototype'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(args, key)) throw new Error('不允许的参数：' + key);
  });
  const props = (tool.parameters && tool.parameters.properties) || {};
  const required = (tool.parameters && tool.parameters.required) || [];
  Object.keys(args).forEach(function (key) {
    if (!props[key]) throw new Error('不允许的参数：' + key);
  });
  required.forEach(function (key) {
    if (args[key] == null || args[key] === '') throw new Error('缺少参数：' + key);
  });
  Object.keys(props).forEach(function (key) {
    if (args[key] == null) return;
    const expect = props[key].type;
    if (expect === 'number' && typeof args[key] !== 'number') throw new Error(key + ' 必须是数字');
    if (expect === 'string' && typeof args[key] !== 'string') throw new Error(key + ' 必须是字符串');
  });
}

function fileNameFromTitle(title, format) {
  const ext = { md: '.md', txt: '.txt', json: '.json' }[format] || '.md';
  let base = String(title || '工作文档').replace(/[<>:"/\\|?*\u0000]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = '工作文档';
  if (base.length > 40) base = base.slice(0, 40).trim();
  return base + ext;
}

function preview(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '（空）';
  return text.length > 1500 ? text.slice(0, 1500) + '…' : text;
}

function readIfInside(root, rel) {
  const abs = path.resolve(root, ...String(rel || '').split('/'));
  if (!isInside(root, abs) || !fs.existsSync(abs)) return null;
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink() || !st.isFile()) return null;
  return fs.readFileSync(abs, 'utf8');
}

function searchBusinessIndex(instanceId, args) {
  const index = indexer.loadIndex(instanceId);
  if (!index) return { hits: [], note: '尚未建立业务索引' };
  const query = String(args.query || '').trim().toLowerCase();
  const hits = [];
  Object.keys(index.zones || {}).forEach(function (zoneId) {
    const zone = index.zones[zoneId];
    if (args.zoneId && zone.id !== args.zoneId) return;
    (zone.rows || []).forEach(function (row, indexNo) {
      const blob = JSON.stringify(row).toLowerCase();
      if (blob.indexOf(query) < 0) return;
      const source = row.__source || {};
      const fields = {};
      Object.keys(row).forEach(function (key) {
        if (key === '__source') return;
        fields[key] = row[key];
      });
      hits.push({
        zoneId: zone.id,
        zoneTitle: zone.title,
        row: indexNo + 1,
        fields: fields,
        source: {
          file: source.file || '',
          rel: source.rel || '',
          path: source.path || '',
          locator: source.locator || ''
        }
      });
    });
  });
  return { query: args.query, hits: hits.slice(0, 30) };
}

function stopped(signal) {
  if (!signal || !signal.aborted) return null;
  if (signal.reason && signal.reason.code === 'TIMEOUT') return signal.reason;
  const error = new Error('任务已取消');
  error.name = 'AbortError';
  return error;
}

function ensureActive(signal) {
  const error = stopped(signal);
  if (error) throw error;
}

function verifyWritten(abs, label) {
  if (!fs.existsSync(abs)) throw new Error(label + '没有出现在磁盘上');
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink() || !st.isFile() || st.size < 0) throw new Error(label + '没有通过写入校验');
  return st;
}
async function perform(instanceId, name, args, signal) {
  ensureActive(signal);
  if (name === 'search_local_files') {
    const found = workspaceApi.searchFiles(instanceId, { query: args.query, limit: args.limit }, 'bound');
    return {
      activity: '正在检索资料：「' + args.query + '」',
      result: {
        query: found.query,
        hits: (found.hits || []).map(function (hit) {
          return {
            name: hit.name,
            path: hit.path,
            rel: hit.rel,
            excerpt: hit.excerpt || '',
            source: { file: hit.name, rel: hit.rel, path: hit.path, locator: hit.excerpt ? '内容片段' : '文件名' }
          };
        })
      }
    };
  }
  if (name === 'read_local_file') {
    const file = workspaceApi.readFile(instanceId, { path: args.path, maxChars: args.maxChars }, 'bound');
    return {
      activity: '正在阅读：' + file.name,
      result: {
        name: file.name,
        path: file.path,
        text: file.text,
        truncated: file.truncated,
        source: { file: file.name, path: file.path, locator: '全文' }
      }
    };
  }
  if (name === 'search_business_index') {
    return { activity: '正在查询业务索引：「' + args.query + '」', result: searchBusinessIndex(instanceId, args) };
  }
  if (name === 'list_documents') {
    return { activity: '正在查看已保存的文档', result: workspaceApi.listDocuments(instanceId, 'bound') };
  }
  if (name === 'read_workspace_data') {
    const data = workspaceApi.readData(instanceId, { name: args.name }, 'bound');
    return { activity: '正在读取业务数据：' + data.name, result: data };
  }
  if (name === 'create_document') {
    ensureActive(signal);
    const format = args.format || 'md';
    if (['md', 'txt', 'json'].indexOf(format) < 0) throw new Error('format 只能是 md、txt 或 json');
    const nameOnDisk = fileNameFromTitle(args.title, format);
    const saved = workspaceApi.createDocument(instanceId, { name: nameOnDisk, content: args.content, format: format }, 'bound');
    const abs = path.join(instanceDir(instanceId), 'documents', saved.rel);
    const st = verifyWritten(abs, '文档');
    return {
      activity: '已保存文档：' + saved.rel,
      savedDocument: { rel: saved.rel, bytes: st.size, path: abs },
      result: { saved: true, rel: saved.rel, bytes: st.size, path: abs }
    };
  }
  if (name === 'write_workspace_data') {
    ensureActive(signal);
    if (!args.value || typeof args.value !== 'object') throw new Error('value 必须是 JSON 对象或数组');
    const saved = workspaceApi.writeData(instanceId, { name: args.name, value: args.value }, 'bound');
    const abs = path.join(instanceDir(instanceId), 'data', saved.name);
    verifyWritten(abs, '业务数据');
    const written = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return {
      activity: '已更新业务数据：' + saved.name,
      dataWrite: saved,
      result: { saved: true, name: saved.name, bytes: saved.bytes, value: written }
    };
  }
  throw new Error('没有这个工具：' + name);
}

function proposalFor(instanceId, call, args) {
  if (call.name === 'write_workspace_data') {
    const before = readIfInside(path.join(instanceDir(instanceId), 'data'), args.name);
    return {
      id: call.id,
      tool: call.name,
      title: '更新业务数据',
      target: args.name,
      before: before == null ? '（尚无此文件）' : preview(before),
      after: preview(args.value),
      arguments: { name: args.name, value: args.value }
    };
  }
  const format = args.format || 'md';
  const name = fileNameFromTitle(args.title, format);
  const before = readIfInside(path.join(instanceDir(instanceId), 'documents'), name);
  if (before == null) return null;
  return {
    id: call.id,
    tool: call.name,
    title: '覆盖已有文档',
    target: name,
    before: preview(before),
    after: preview(args.content),
    arguments: { title: args.title, content: args.content, format: format }
  };
}

async function run(instanceId, call, signal) {
  const blocked = stopped(signal);
  if (blocked) throw blocked;
  const tool = registry.get(call && call.name);
  if (!tool) return { ok: false, error: '没有这个工具：' + (call && call.name || '') + '。程序只执行已登记的工具。' };
  let args;
  try {
    args = call.arguments || {};
    checkArgs(tool, args);
  } catch (e) {
    return { ok: false, error: e.message, activity: '参数不正确，没有执行 ' + tool.name };
  }
  if (tool.name === 'write_workspace_data') {
    if (!args.value || typeof args.value !== 'object') {
      return { ok: false, error: 'value 必须是 JSON 对象或数组', activity: '参数不正确，没有写入数据' };
    }
    try {
      const rel = require('./safe-path').safeRelative(args.name, 'name');
      if (!rel.toLowerCase().endsWith('.json')) throw new Error('数据文件必须是 .json');
    } catch (e) {
      return { ok: false, error: e.message, activity: '数据路径不合法，没有写入' };
    }
  }
  if (tool.confirm === 'always' || tool.confirm === 'overwrite') {
    const proposal = proposalFor(instanceId, { id: call.id, name: tool.name }, args);
    if (proposal) {
      return { ok: true, needsConfirmation: true, proposal: proposal, activity: '等待确认：' + proposal.title + ' ' + proposal.target };
    }
  }
  try {
    const done = await perform(instanceId, tool.name, args, signal);
    return { ok: true, activity: done.activity, result: done.result, savedDocument: done.savedDocument, dataWrite: done.dataWrite };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'TIMEOUT')) throw e;
    return { ok: false, error: e.message, activity: tool.name + ' 没有完成：' + e.message };
  }
}

async function commit(instanceId, proposal, signal) {
  const blocked = stopped(signal);
  if (blocked) throw blocked;
  const tool = registry.get(proposal && proposal.tool);
  if (!tool) return { ok: false, error: '没有这个工具：' + (proposal && proposal.tool || '') };
  try { checkArgs(tool, proposal.arguments || {}); }
  catch (e) { return { ok: false, error: e.message }; }
  try {
    const done = await perform(instanceId, tool.name, proposal.arguments, signal);
    return { ok: true, activity: done.activity, result: done.result, savedDocument: done.savedDocument, dataWrite: done.dataWrite };
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'TIMEOUT')) throw e;
    return { ok: false, error: e.message, activity: tool.name + ' 没有完成：' + e.message };
  }
}

module.exports = { run, commit, checkArgs, fileNameFromTitle };
