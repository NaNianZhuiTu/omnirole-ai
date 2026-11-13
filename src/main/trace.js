/* 只增不改的轨迹日志（Trajectory 思路）：每次扫描、对话都留一条，便于回放与追责。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { instanceDir } = require('./paths');

function file(instanceId) { return path.join(instanceDir(instanceId), 'trace.jsonl'); }

function append(instanceId, type, payload) {
  try {
    const dir = instanceDir(instanceId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), type, ...(payload || {}) });
    fs.appendFileSync(file(instanceId), line + '\n', 'utf8');
  } catch (e) { /* 轨迹失败不应阻断主流程 */ }
}

function read(instanceId, limit) {
  const f = file(instanceId);
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-(limit || 200)).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

module.exports = { append, read };
