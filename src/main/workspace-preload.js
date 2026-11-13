/* HTML 工作台专用 preload。只暴露下面这些方法，没有通用 invoke，也没有 Node。
 * 通道名全部写死，页面不能改道去调桌面主界面的 IPC。
 *
 * window.desktop.assistant.getInfo()
 * window.desktop.workspace.getInfo()
 * window.desktop.files.list({ path? })
 * window.desktop.files.search({ query, path?, limit? })
 * window.desktop.files.read({ path, maxChars? })
 * window.desktop.data.read({ name })
 * window.desktop.data.write({ name, value })
 * window.desktop.documents.list()
 * window.desktop.documents.create({ name, content, format? })
 * window.desktop.ai.chat({ messages })
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function call(channel, payload) {
  return ipcRenderer.invoke(channel, payload === undefined ? {} : payload).then(function (res) {
    if (!res || res.ok === false) throw new Error((res && res.error) || '操作失败');
    return res.data;
  });
}

contextBridge.exposeInMainWorld('desktop', {
  assistant: {
    getInfo: function () { return call('ws:assistant:getInfo', {}); }
  },
  workspace: {
    getInfo: function () { return call('ws:workspace:getInfo', {}); }
  },
  files: {
    list: function (p) { return call('ws:files:list', p || {}); },
    search: function (p) { return call('ws:files:search', p || {}); },
    read: function (p) { return call('ws:files:read', p || {}); }
  },
  data: {
    read: function (p) { return call('ws:data:read', p || {}); },
    write: function (p) { return call('ws:data:write', p || {}); }
  },
  documents: {
    list: function () { return call('ws:documents:list', {}); },
    create: function (p) { return call('ws:documents:create', p || {}); }
  },
  ai: {
    chat: function (p) { return call('ws:ai:chat', p || {}); }
  }
});
