const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

let win;
let terminal = null;
let workspace = process.env.NEXUS_HOME || (process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : process.cwd()));

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 620,
    title: 'NEXUS', backgroundColor: '#070b12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { if (terminal) terminal.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('system:info', () => ({
  platform: os.platform(), release: os.release(), username: os.userInfo().username,
  hostname: os.hostname(), home: os.homedir(), cwd: workspace
}));

ipcMain.handle('workspace:list', () => {
  try {
    return fs.readdirSync(workspace, { withFileTypes: true }).map(entry => ({
      name: entry.name, directory: entry.isDirectory()
    })).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Choose NEXUS workspace', defaultPath: workspace, properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  workspace = result.filePaths[0];
  if (terminal) terminal.kill();
  terminal = null;
  return { cwd: workspace };
});

ipcMain.handle('workspace:open', async (_event, name) => {
  const root = path.resolve(workspace);
  const target = path.resolve(root, String(name || ''));
  if (target !== root && !target.startsWith(root + path.sep)) return 'Invalid path.';
  if (!fs.existsSync(target)) return 'Item not found.';
  return shell.openPath(target);
});

ipcMain.handle('terminal:start', () => {
  if (terminal) terminal.kill();
  const isWindows = process.platform === 'win32';
  const shellPath = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const args = isWindows ? ['-NoLogo'] : [];
  terminal = pty.spawn(shellPath, args, {
    name: 'xterm-256color', cols: 100, rows: 28, cwd: workspace,
    env: { ...process.env, TERM: 'xterm-256color' }
  });
  terminal.onData(data => win?.webContents.send('terminal:data', data));
  terminal.onExit(({ exitCode }) => {
    win?.webContents.send('terminal:exit', exitCode);
    terminal = null;
  });
  return { started: true, shell: shellPath, cwd: workspace };
});
ipcMain.on('terminal:write', (_event, data) => {
  if (terminal && typeof data === 'string') terminal.write(data);
});
ipcMain.on('terminal:resize', (_event, size) => {
  if (terminal && Number.isInteger(size?.cols) && Number.isInteger(size?.rows)) {
    terminal.resize(Math.max(20, Math.min(300, size.cols)), Math.max(5, Math.min(100, size.rows)));
  }
});
ipcMain.on('terminal:stop', () => { if (terminal) terminal.kill(); terminal = null; });
