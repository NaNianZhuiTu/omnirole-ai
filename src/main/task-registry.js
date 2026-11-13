/* 任务记录：每个助手实例一个 tasks 目录，重启后仍在。记录里不放 API Key。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { instanceDir, readJson, writeJson } = require('./paths');

function dir(instanceId) {
  return path.join(instanceDir(instanceId), 'tasks');
}

function file(instanceId, taskId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(taskId || ''))) throw new Error('任务 ID 不合法');
  return path.join(dir(instanceId), taskId + '.json');
}

function sanitize(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (/api[-_]?key|authorization|secret|token|password/i.test(key)) return undefined;
    return item;
  }));
}

function save(task) {
  const clean = sanitize(task);
  fs.mkdirSync(dir(task.instanceId), { recursive: true });
  writeJson(file(task.instanceId, task.id), clean);
  return clean;
}

function load(instanceId, taskId) {
  const target = file(instanceId, taskId);
  if (!fs.existsSync(target)) return null;
  return readJson(target, null);
}

function list(instanceId) {
  const root = dir(instanceId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(function (name) { return name.endsWith('.json'); })
    .map(function (name) { return readJson(path.join(root, name), null); })
    .filter(Boolean)
    .sort(function (a, b) { return String(b.startedAt || '').localeCompare(String(a.startedAt || '')); });
}

function recover(instanceId) {
  list(instanceId).forEach(function (task) {
    if (task.status === 'running' || task.status === 'planning' || task.status === 'created') {
      task.status = 'failed';
      task.error = '程序已关闭，任务中断。已完成的文件写入仍然保留。';
      task.finishedAt = task.finishedAt || new Date().toISOString();
      save(task);
    }
  });
}

module.exports = { save, load, list, recover, sanitize };
