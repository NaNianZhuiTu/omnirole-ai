'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('desktop', {
  app: {
    info: () => call('app:info'),
    onMenuAction: (cb) => {
      const handler = (_event, action) => cb(action);
      ipcRenderer.on('menu:action', handler);
      return () => ipcRenderer.removeListener('menu:action', handler);
    },
    toggleMaximize: () => call('win:toggleMaximize')
  },
  library: {
    list: () => call('library:list'),
    available: () => call('library:available'),
    add: (p) => call('library:add', p),
    switchTo: (p) => call('library:switchTo', p),
    remove: (p) => call('library:remove', p),
    rename: (p) => call('library:rename', p),
    import: (p) => call('library:import', p),
    pickPackage: () => call('library:pickPackage'),
    pickFolder: () => call('library:pickFolder')
  },
  assistant: {
    current: () => call('assistant:current'),
    reindex: (p) => call('assistant:reindex', p),
    paths: (p) => call('assistant:paths', p),
    setPaths: (p) => call('assistant:setPaths', p),
    trace: (p) => call('assistant:trace', p),
    listDir: (p) => call('assistant:listDir', p)
  },
  chat: {
    send: (p) => call('chat:send', p),
    abort: (p) => call('chat:abort', p),
    clear: (p) => call('chat:clear', p),
    newThread: (p) => call('chat:new', p),
    openThread: (p) => call('chat:open', p),
    removeThread: (p) => call('chat:remove', p),
    onChunk: (cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on('chat:chunk', handler);
      return () => ipcRenderer.removeListener('chat:chunk', handler);
    }
  },
  settings: {
    get: () => call('settings:get'),
    set: (p) => call('settings:set', p)
  },
  files: {
    props: (p) => call('files:props', p),
    copy: (p) => call('files:copy', p),
    move: (p) => call('files:move', p),
    trash: (p) => call('files:trash', p)
  },
  system: {
    reveal: (p) => call('system:reveal', p),
    open: (p) => call('system:open', p),
    openDataDir: () => call('system:openDataDir'),
    exportIndex: (p) => call('system:exportIndex', p)
  }
});
