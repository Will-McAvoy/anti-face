const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickSwitcher', {
  init: () => ipcRenderer.invoke('switcher:init'),
  selectTarget: targetId => ipcRenderer.invoke('switcher:selectTarget', { targetId }),
  applyTheme: (themeId, targetId) => ipcRenderer.invoke('switcher:apply', { themeId, targetId }),
  resolveConflict: (choice,targetId) => ipcRenderer.invoke('switcher:resolveConflict', { choice,targetId }),
  close: () => ipcRenderer.invoke('switcher:close'),
  onDataChanged: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('switcher:data-changed', listener);
    return () => ipcRenderer.removeListener('switcher:data-changed', listener);
  }
});
