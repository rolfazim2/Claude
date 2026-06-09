'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gramDesktop', {
  getServer: () => ipcRenderer.invoke('gram:get-server'),
  setServer: (url) => ipcRenderer.invoke('gram:set-server', url),
  setBadge: (count) => ipcRenderer.send('gram:set-badge', count),
});
