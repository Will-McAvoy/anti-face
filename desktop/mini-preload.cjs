const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('antiFaceMini', {
  snapshot: () => ipcRenderer.invoke('mini:snapshot'),
  openMain: () => ipcRenderer.invoke('mini:open-main'),
  dismiss: () => ipcRenderer.invoke('mini:dismiss'),
  saveBounds: bounds => ipcRenderer.invoke('mini:bounds', bounds),
  onUpdate: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('mini:update', listener);
    return () => ipcRenderer.removeListener('mini:update', listener);
  }
});
