/* BYOK 模型网关：程序自带的是能力（渲染/索引/溯源），智能由用户自己的模型提供。
 * 没配 key 时，查看索引、查资料、导出、打印全部可用，只是不能生成新内容。
 */
'use strict';
const fs = require('fs');
const { PATHS, readJson, writeJson } = require('./paths');

const DEFAULT_SETTINGS = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
  sendLocalData: true,
  maxContextChars: 24000,
  temperature: 0.3
};

const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', needKey: true }
];

function getSettings() {
  const s = readJson(PATHS.settings, {});
  return { ...DEFAULT_SETTINGS, ...s };
}
function setSettings(patch) {
  const next = { ...getSettings(), ...(patch || {}) };
  next.baseUrl = String(next.baseUrl || '').replace(/\/+$/, '');
  writeJson(PATHS.settings, next);
  return publicSettings(next);
}
function publicSettings(s) {
  s = s || getSettings();
  return { ...s, apiKey: s.apiKey ? '••••••••' + String(s.apiKey).slice(-4) : '', hasKey: !!s.apiKey };
}
function isConfigured(s) {
  s = s || getSettings();
  return !!s.apiKey || /127\.0\.0\.1|localhost/.test(s.baseUrl || '');
}

/** 把「当前助手」的资料索引裁成一段可追溯的上下文。只带岗位包声明的 chatContext 数据区。 */
function buildContext(pkg, index, settings) {
  settings = settings || getSettings();
  if (!settings.sendLocalData) {
    return { text: '（用户已关闭「随请求发送本机资料」，本次对话不含任何本机资料片段。）', includedFiles: 0, chars: 0, truncated: false, enabled: false };
  }
  if (!pkg || !index) {
    return { text: '（本机资料索引尚未建立，本次对话不含资料片段。）', includedFiles: 0, chars: 0, truncated: false, enabled: true };
  }
  const limit = Number(settings.maxContextChars) || 24000;
  const parts = [];
  const files = new Set();
  let truncated = false;

  (pkg.chatContext || []).forEach(zoneId => {
    const zone = (index.zones || {})[zoneId];
    const def = (pkg.zones || []).find(z => z.id === zoneId) || {};
    if (!zone || !zone.rows || !zone.rows.length) return;
    parts.push('\n### 数据区：' + (def.title || zoneId));
    for (const row of zone.rows) {
      const src = row.__source || {};
      if (src.rel) files.add(src.rel);
      let line;
      if (zone.view === 'documentList' || zone.view === 'timeline') {
        line = '- ' + (row.title || '') +
          (row.year ? '（' + row.year + ' 年）' : '') +
          (row.clause ? ' 涉及条款：' + row.clause : '') +
          '\n  来源：' + (src.rel || '未知') + (src.locator ? ' / ' + src.locator : '') +
          '\n  内容：' + String(row.text || row.excerpt || '').slice(0, 1600).replace(/\n+/g, ' ');
      } else {
        line = '- ' + (def.fields || []).map(f => f.label + '=' + (row[f.key] ?? '')).join('，') +
          '\n  来源：' + (src.rel || '未知') + (src.locator ? ' / ' + src.locator : '');
      }
      const joined = parts.join('\n') + '\n' + line;
      if (joined.length > limit) { truncated = true; break; }
      parts.push(line);
    }
  });

  const text = parts.length
    ? '以下是该助手本机资料索引的片段（生成时间 ' + (index.generatedAt || '未知') + '）：\n' + parts.join('\n')
    : '（本机资料索引中没有可带入的内容。）';
  return { text, includedFiles: files.size, chars: text.length, truncated, enabled: true };
}

function buildSystemPrompt(pkg, context) {
  return [
    '你是「' + ((pkg && pkg.name) || '岗位') + '」的本机岗位工作助手。',
    '',
    '硬性规则：',
    '1. 只依据下面提供的本机资料回答；资料里没有的信息，明确写「未找到」，不得推测、补写或编造数字、条款、日期。',
    '2. 每条关键结论标注来源：文件名 + 条款位置或表格行号。找不到出处的内容不要写成既定事实。',
    '3. 不得声称已经修改、删除或上传了本机文件；你只能输出文本，由用户决定是否保存。',
    '4. 涉及方案、报告起草时，沿用本机历年同类文件的结构与表述口径。',
    '5. 若资料被标记为「示例资料」，在回答开头提醒用户：当前依据的是演示数据，需替换为本单位真实台账。',
    '',
    context.text
  ].join('\n');
}

async function streamChat(args) {
  const { settings, system, messages, onChunk, signal } = args;
  const s = settings || getSettings();
  if (!isConfigured(s)) throw new Error('尚未配置模型。请在「设置」里填写 API Key 或选择本机模型；未配置时仍可查看资料与索引。');
  if (!s.model) throw new Error('尚未填写模型名称，请在「设置」里补全。');

  const isAnthropic = s.provider === 'anthropic';
  const url = isAnthropic ? s.baseUrl + '/v1/messages' : s.baseUrl + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (isAnthropic) {
    headers['x-api-key'] = s.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (s.apiKey) {
    headers['Authorization'] = 'Bearer ' + s.apiKey;
  }

  const body = isAnthropic
    ? { model: s.model, max_tokens: 4096, temperature: s.temperature, system, messages, stream: true }
    : { model: s.model, temperature: s.temperature, messages: [{ role: 'system', content: system }].concat(messages), stream: true };

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('模型请求失败（HTTP ' + res.status + '）：' + detail.slice(0, 300));
  }
  if (!res.body) throw new Error('模型返回为空，或当前环境不支持流式响应。');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '', full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';
    for (const block of chunks) {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch (e) { continue; }
        let piece = '';
        if (isAnthropic) {
          if (json.type === 'content_block_delta') piece = (json.delta && json.delta.text) || '';
        } else {
          piece = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || '';
        }
        if (piece) { full += piece; if (onChunk) onChunk(piece); }
      }
    }
  }
  return full;
}

function supportsTools(settings) {
  const s = settings || getSettings();
  if (!isConfigured(s)) return { ok: false, protocol: '', reason: '尚未配置模型。请在「设置」里填写 API Key 或选择本机模型。' };
  if (!s.model) return { ok: false, protocol: '', reason: '尚未填写模型名称，请在「设置」里补全。' };
  if (s.provider === 'anthropic') return { ok: true, protocol: 'anthropic', reason: '' };
  if (s.provider === 'openai-compatible') return { ok: true, protocol: 'openai', reason: '' };
  return { ok: false, protocol: '', reason: '当前模型协议「' + (s.provider || '未设置') + '」不支持工具调用。目前只支持 OpenAI 兼容接口（含 DeepSeek）和 Anthropic。' };
}

function toolDefinitions(protocol, tools) {
  return (tools || []).map(function (tool) {
    if (protocol === 'anthropic') {
      return { name: tool.name, description: tool.description, input_schema: tool.parameters };
    }
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
  });
}

function toOpenAIMessages(system, messages) {
  const out = [{ role: 'system', content: system || '' }];
  (messages || []).forEach(function (message) {
    if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: String(message.content || '') });
      return;
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length) {
      out.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.toolCalls.map(function (call) {
          return {
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) }
          };
        })
      });
      return;
    }
    out.push({ role: message.role, content: String(message.content || '') });
  });
  return out;
}

function toAnthropicMessages(messages) {
  const out = [];
  (messages || []).forEach(function (message) {
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: String(message.content || '') };
      const prev = out[out.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) prev.content.push(block);
      else out.push({ role: 'user', content: [block] });
      return;
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: String(message.content) });
      message.toolCalls.forEach(function (call) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments || {} });
      });
      out.push({ role: 'assistant', content: content });
      return;
    }
    out.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content || '') });
  });
  return out;
}

function parseOpenAICompletion(json) {
  const choice = json && json.choices && json.choices[0];
  const message = choice && choice.message || {};
  const toolCalls = [];
  (message.tool_calls || []).forEach(function (call, index) {
    let args = {};
    const raw = call.function && call.function.arguments;
    if (typeof raw === 'string' && raw.trim()) {
      try { args = JSON.parse(raw); }
      catch (e) { args = { __invalidJson: raw }; }
    } else if (raw && typeof raw === 'object') args = raw;
    toolCalls.push({
      id: call.id || ('call-' + index),
      name: call.function && call.function.name || '',
      arguments: args
    });
  });
  return { text: typeof message.content === 'string' ? message.content : '', toolCalls: toolCalls };
}

function parseAnthropicCompletion(json) {
  const blocks = json && Array.isArray(json.content) ? json.content : [];
  const text = [];
  const toolCalls = [];
  blocks.forEach(function (block, index) {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'text') text.push(block.text || '');
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id || ('tool-' + index),
        name: block.name || '',
        arguments: block.input && typeof block.input === 'object' ? block.input : {}
      });
    }
  });
  return { text: text.join(''), toolCalls: toolCalls };
}

async function completeWithTools(args) {
  const settings = args.settings || getSettings();
  const support = supportsTools(settings);
  if (!support.ok) throw new Error(support.reason);
  const tools = toolDefinitions(support.protocol, args.tools || []);
  const headers = { 'Content-Type': 'application/json' };
  let url;
  let body;
  if (support.protocol === 'anthropic') {
    url = settings.baseUrl + '/v1/messages';
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: settings.model,
      max_tokens: 4096,
      temperature: settings.temperature,
      system: args.system || '',
      messages: toAnthropicMessages(args.messages),
      tools: tools
    };
  } else {
    url = settings.baseUrl + '/chat/completions';
    if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
    body = {
      model: settings.model,
      temperature: settings.temperature,
      messages: toOpenAIMessages(args.system, args.messages),
      tools: tools
    };
  }
  const res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: args.signal });
  if (!res.ok) {
    const detail = await res.text().catch(function () { return ''; });
    throw new Error('模型请求失败（HTTP ' + res.status + '）：' + detail.slice(0, 300));
  }
  const json = await res.json();
  return support.protocol === 'anthropic' ? parseAnthropicCompletion(json) : parseOpenAICompletion(json);
}

module.exports = {
  DEFAULT_SETTINGS, PRESETS, getSettings, setSettings, publicSettings,
  isConfigured, buildContext, buildSystemPrompt, streamChat,
  supportsTools, toolDefinitions, toOpenAIMessages, toAnthropicMessages,
  parseOpenAICompletion, parseAnthropicCompletion, completeWithTools
};
