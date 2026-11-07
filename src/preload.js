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
  addSyncFolders: () => ipcRenderer.invoke('nexus:add-sync-folders'),
  syncNow: () => ipcRenderer.invoke('nexus:sync-now'),
  syncStatus: () => ipcRenderer.invoke('nexus:sync-status'),
  syncSources: () => ipcRenderer.invoke('nexus:sync-sources'),
  removeSyncSource: id => ipcRenderer.invoke('nexus:remove-sync-source', id),
  onSyncStatus: callback => ipcRenderer.on('nexus:sync-status', (_event, status) => callback(status)),
  newFolder: (name, parentId) => ipcRenderer.invoke('nexus:new-folder', name, parentId),
  rename: (id, name, isFolder) => ipcRenderer.invoke('nexus:rename', id, name, isFolder),
  deleteItem: (id, isFolder) => ipcRenderer.invoke('nexus:delete', id, isFolder),
  previewFile: id => ipcRenderer.invoke('nexus:preview-file', id),
  onForceLock: callback => ipcRenderer.on('nexus:force-lock', callback)
});
