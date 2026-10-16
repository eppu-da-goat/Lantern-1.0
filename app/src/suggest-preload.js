'use strict';
// Bridge for the omnibox suggestion popup: it only renders what the browser sends and reports clicks.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanternSuggest', {
  onRender: (fn) => ipcRenderer.on('suggest:render', (_e, data) => fn(data)),
  pick: (index, summary) => ipcRenderer.send('suggest-popup', { type: 'pick', index, summary: !!summary }),
  remove: (index) => ipcRenderer.send('suggest-popup', { type: 'remove', index }),
});
