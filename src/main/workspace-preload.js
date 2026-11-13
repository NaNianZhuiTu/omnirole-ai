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
 * window.desktop.ai.execute({ task })
 * window.desktop.ai.getTaskStatus({ taskId })
 * window.desktop.ai.getTaskHistory()
 * window.desktop.ai.confirmAction({ taskId, actionId, approved })
 * window.desktop.ai.cancelTask({ taskId })
 * window.desktop.ai.onProgress(callback)  返回取消监听的函数
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
    chat: function (p) { return call('ws:ai:chat', p || {}); },
    execute: function (p) { return call('ws:ai:execute', p || {}); },
    getTaskStatus: function (p) { return call('ws:ai:getTaskStatus', p || {}); },
    getTaskHistory: function () { return call('ws:ai:getTaskHistory', {}); },
    confirmAction: function (p) { return call('ws:ai:confirmAction', p || {}); },
    cancelTask: function (p) { return call('ws:ai:cancelTask', p || {}); },
    onProgress: function (cb) {
      const handler = function (_event, data) { cb(data); };
      ipcRenderer.on('ws:task:progress', handler);
      return function () { ipcRenderer.removeListener('ws:task:progress', handler); };
    }
  }
});
