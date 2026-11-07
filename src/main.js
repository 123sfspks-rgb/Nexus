const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win;
let currentPath = process.env.NEXUS_HOME ||
  process.env.PORTABLE_EXECUTABLE_DIR ||
  (app.isPackaged ? path.dirname(process.execPath) : process.cwd());

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 850, minHeight: 560,
    title: 'NEXUS', backgroundColor: '#0b0f15',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

function listDrives() {
  if (process.platform !== 'win32') return [{ name: '/', path: '/', kind: 'system' }];
  const drives = [];
  for (let code = 65; code <= 90; code++) {
    const drive = String.fromCharCode(code) + ':\\';
    try {
      if (fs.existsSync(drive)) drives.push({
        name: drive,
        path: drive,
        kind: drive.toUpperCase() === path.parse(currentPath).root.toUpperCase() ? 'current' : 'drive'
      });
    } catch (_) {}
  }
  return drives;
}

function readFolder(folder) {
  const resolved = path.resolve(folder);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error('That location is not a folder.');
  currentPath = resolved;
  const entries = fs.readdirSync(resolved, { withFileTypes: true }).map(entry => {
    const fullPath = path.join(resolved, entry.name);
    let info = {};
    try { info = fs.statSync(fullPath); } catch (_) {}
    return {
      name: entry.name,
      path: fullPath,
      directory: entry.isDirectory(),
      size: info.size || 0,
      modified: info.mtime ? info.mtime.toISOString() : '',
      extension: entry.isDirectory() ? 'Folder' : (path.extname(entry.name).slice(1).toUpperCase() || 'FILE')
    };
  }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return {
    path: currentPath,
    parent: path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath),
    entries,
    drives: listDrives(),
    platform: os.platform()
  };
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('nexus:initial', () => {
  try { return readFolder(currentPath); }
  catch (_) { return readFolder(os.homedir()); }
});

ipcMain.handle('nexus:navigate', (_event, folder) => {
  try { return readFolder(folder); }
  catch (error) { return { error: error.message }; }
});

ipcMain.handle('nexus:choose-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a folder in NEXUS',
    defaultPath: currentPath,
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try { return readFolder(result.filePaths[0]); }
  catch (error) { return { error: error.message }; }
});

ipcMain.handle('nexus:open-file', async (_event, filePath) => {
  const target = path.resolve(String(filePath || ''));
  if (!fs.existsSync(target)) return 'This item no longer exists.';
  const result = await shell.openPath(target);
  return result || null;
});

ipcMain.handle('nexus:drives', () => listDrives());
