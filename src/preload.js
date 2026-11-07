const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexus', {
  initial: () => ipcRenderer.invoke('nexus:initial'),
  chooseLocation: () => ipcRenderer.invoke('nexus:choose-location'),
  locateVault: () => ipcRenderer.invoke('nexus:locate-vault'),
  createVault: data => ipcRenderer.invoke('nexus:create-vault', data),
  unlock: password => ipcRenderer.invoke('nexus:unlock', password),
  lock: () => ipcRenderer.invoke('nexus:lock'),
  list: folderId => ipcRenderer.invoke('nexus:list', folderId),
  importItems: parentId => ipcRenderer.invoke('nexus:import', parentId),
  newFolder: (name, parentId) => ipcRenderer.invoke('nexus:new-folder', name, parentId),
  rename: (id, name, isFolder) => ipcRenderer.invoke('nexus:rename', id, name, isFolder),
  deleteItem: (id, isFolder) => ipcRenderer.invoke('nexus:delete', id, isFolder),
  previewFile: id => ipcRenderer.invoke('nexus:preview-file', id),
  onForceLock: callback => ipcRenderer.on('nexus:force-lock', callback)
});
