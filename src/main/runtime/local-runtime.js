/* 自写薄底座：实现适配层的四个接口，零第三方运行时依赖。
 * 借鉴 Harness 的设计思路（本地文件 provider / 会话 / 只增不改轨迹 / 可替换 profile），
 * 但不引入它的插件机制与 danger-full-access 沙箱模型。
 */
'use strict';
const R = require('../file-reader');
const library = require('../library');
const model = require('../model-gateway');
const trace = require('../trace');

const LocalRuntime = {
  name: 'local',
  label: '本机薄底座',

  status() {
    return {
      available: true,
      modelConfigured: model.isConfigured(),
      note: '读文件、跑索引、留轨迹全部在本机完成；模型只在生成内容时按需调用。'
    };
  },

  async readFiles(args) {
    const { roots, patterns, maxChars } = args || {};
    const out = [];
    (roots || []).forEach(root => {
      (patterns || ['*']).forEach(pattern => {
        R.listFiles(root, pattern, 100).forEach(f => {
          let text = '';
          try { text = R.readText(f.abs); } catch (e) { text = ''; }
          out.push({ rel: f.rel, abs: f.abs, text: String(text).slice(0, maxChars || 8000) });
        });
      });
    });
    return out;
  },

  async runTask(args) {
    const { type, payload } = args || {};
    if (type === 'reindex') return library.reindexInstance(payload.instanceId);
    if (type === 'trace') return trace.read(payload.instanceId, payload.limit);
    throw new Error('未知任务类型：' + type);
  },

  async chat(args) {
    const { pkg, index, settings, messages, onChunk, signal } = args;
    const ctx = model.buildContext(pkg, index, settings);
    const system = model.buildSystemPrompt(pkg, ctx);
    const text = await model.streamChat({ settings, system, messages, onChunk, signal });
    return {
      text,
      context: {
        enabled: ctx.enabled, includedFiles: ctx.includedFiles,
        chars: ctx.chars, truncated: ctx.truncated
      }
    };
  },

  trace(args) {
    const { instanceId, type, payload } = args || {};
    if (!instanceId) return { ok: false };
    trace.append(instanceId, type || 'event', payload || {});
    return { ok: true };
  }
};

module.exports = LocalRuntime;
