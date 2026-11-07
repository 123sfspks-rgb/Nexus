const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  systemInfo: () => ipcRenderer.invoke('system:info'),
  listFiles: () => ipcRenderer.invoke('workspace:list'),
  setWorkspace: folder => ipcRenderer.invoke('workspace:set', folder),
  openItem: name => ipcRenderer.invoke('workspace:open', name),
  startTerminal: () => ipcRenderer.invoke('terminal:start'),
  writeTerminal: data => ipcRenderer.send('terminal:write', data),
  resizeTerminal: size => ipcRenderer.send('terminal:resize', size),
  stopTerminal: () => ipcRenderer.send('terminal:stop'),
  onTerminalData: callback => ipcRenderer.on('terminal:data', (_event, data) => callback(data)),
  onTerminalExit: callback => ipcRenderer.on('terminal:exit', (_event, code) => callback(code))
});
