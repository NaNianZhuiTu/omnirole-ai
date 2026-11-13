/* AI 可调用的工具。只有这里登记过的工具才能执行，没有 Shell，也没有任意删文件。 */
'use strict';

const TOOLS = [
  {
    name: 'search_local_files',
    description: '在当前助手已授权的目录里按文件名或内容搜索资料，返回可追溯到原文件的摘要。',
    confirm: 'never',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '要搜索的关键词' },
        limit: { type: 'number', description: '最多返回条数，1 到 20' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_local_file',
    description: '读取当前助手已授权目录中的一个文本文件，并带回文件来源。',
    confirm: 'never',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'search_local_files 返回的文件路径' },
        maxChars: { type: 'number', description: '最多读取的字符数' }
      },
      required: ['path']
    }
  },
  {
    name: 'search_business_index',
    description: '查询当前助手已经建立的业务索引，按关键词查找记录和资料来源。',
    confirm: 'never',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '业务对象、状态或关键词' },
        zoneId: { type: 'string', description: '可选，限定某个数据区' }
      },
      required: ['query']
    }
  },
  {
    name: 'create_document',
    description: '把工作成果保存成当前助手 documents 目录中的新文档。覆盖同名文件前必须等用户确认。',
    confirm: 'overwrite',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '文档标题，用来生成文件名' },
        content: { type: 'string', description: '文档正文' },
        format: { type: 'string', description: 'md、txt 或 json' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'list_documents',
    description: '列出当前助手已经保存的工作文档。',
    confirm: 'never',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] }
  },
  {
    name: 'read_workspace_data',
    description: '读取当前助手 data 目录中的 JSON 业务数据。',
    confirm: 'never',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string', description: '数据文件名，例如 hazards.json' } },
      required: ['name']
    }
  },
  {
    name: 'write_workspace_data',
    description: '准备更新当前助手自己的 JSON 业务数据。程序会先请用户确认，确认前不会写入。',
    confirm: 'always',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: '数据文件名，必须以 .json 结尾' },
        value: { description: '要保存的 JSON 对象或数组' }
      },
      required: ['name', 'value']
    }
  }
];

function list() { return TOOLS.map(function (tool) { return Object.assign({}, tool); }); }
function get(name) { return TOOLS.find(function (tool) { return tool.name === name; }) || null; }

module.exports = { list, get };
