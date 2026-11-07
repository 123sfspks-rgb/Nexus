const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  systemInfo: () => ipcRenderer.invoke('system:info'),
  listFiles: () => ipcRenderer.invoke('workspace:list'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openItem: name => ipcRenderer.invoke('workspace:open', name),
  startTerminal: () => ipcRenderer.invoke('terminal:start'),
  writeTerminal: data => ipcRenderer.send('terminal:write', data),
  resizeTerminal: size => ipcRenderer.send('terminal:resize', size),
  stopTerminal: () => ipcRenderer.send('terminal:stop'),
  onTerminalData: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  onTerminalExit: callback => {
    const listener = (_event, code) => callback(code);
    ipcRenderer.on('terminal:exit', listener);
    return () => ipcRenderer.removeListener('terminal:exit', listener);
  }
});
