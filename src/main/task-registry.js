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
    try {
      if (!task || typeof task !== 'object') return;
      if (task.instanceId !== instanceId) {
        task.instanceId = instanceId;
        task.status = 'failed';
        task.error = '任务记录与助手实例不一致，已停止，没有继续执行。';
        task.programNote = task.error;
        task.pendingAction = null;
        task.finishedAt = task.finishedAt || new Date().toISOString();
        if (!Array.isArray(task.activity)) task.activity = [];
        task.activity.push({ at: task.finishedAt, text: task.error });
        save(task);
        return;
      }
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return;
      const waiting = task.status === 'waiting_confirmation';
      task.status = 'failed';
      task.error = waiting
        ? '程序已关闭，等待确认的操作没有执行。已保存的文件和数据保持原样。'
        : '程序已关闭，任务中断。已完成的文件写入仍然保留。';
      task.programNote = task.error;
      task.pendingAction = null;
      task.finishedAt = task.finishedAt || new Date().toISOString();
      if (!Array.isArray(task.activity)) task.activity = [];
      task.activity.push({ at: task.finishedAt, text: task.error });
      save(task);
    } catch (e) { /* 单条记录损坏时继续处理其他任务 */ }
  });
}

module.exports = { save, load, list, recover, sanitize };
