const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  initial: () => ipcRenderer.invoke('nexus:initial'),
  navigate: folder => ipcRenderer.invoke('nexus:navigate', folder),
  chooseFolder: () => ipcRenderer.invoke('nexus:choose-folder'),
  openFile: filePath => ipcRenderer.invoke('nexus:open-file', filePath),
  getDrives: () => ipcRenderer.invoke('nexus:drives')
});
