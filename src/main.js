const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { execFileSync } = require('child_process');

const VAULT_DIR = 'NEXUS_VAULT';
const CONFIG_FILE = 'config.json';
const MANIFEST_FILE = 'manifest.enc';
const OBJECTS_DIR = 'objects';
const MANIFEST_MAGIC = Buffer.from('NXM1');
const FILE_MAGIC = Buffer.from('NXB1');
const KDF = { N: 32768, r: 8, p: 1, keyLength: 32 };
const WATCHER_MODE = process.argv.includes('--watch-usb');

let win = null;
let tray = null;
let watcherTimer = null;
let lastDetectedVault = null;
let pendingVaultPath = null;
let unlocked = null;
let tempSessionPath = null;
let isLocking = false;

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function isValidVault(folder) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(folder, CONFIG_FILE), 'utf8'));
    return config.format === 'NEXUS-VAULT' && config.version === 1 && fs.existsSync(path.join(folder, MANIFEST_FILE));
  } catch (_) { return false; }
}
function locateVaultIn(folder) {
  if (!folder) return null;
  if (isValidVault(folder)) return path.resolve(folder);
  const nested = path.join(folder, VAULT_DIR);
  return isValidVault(nested) ? path.resolve(nested) : null;
}
function scanForVault() {
  if (process.platform !== 'win32') return null;
  for (let code = 65; code <= 90; code++) {
    const root = String.fromCharCode(code) + ':\\';
    try {
      const direct = locateVaultIn(root);
      if (direct) return direct;
      const nexusFolder = locateVaultIn(path.join(root, 'NEXUS'));
      if (nexusFolder) return nexusFolder;
    } catch (_) {}
  }
  return null;
}
function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, KDF.keyLength, {
    N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024
  });
}
function encryptRecord(data, key, magic) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data), 'utf8');
  return Buffer.concat([magic, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}
function decryptRecord(buffer, key, magic) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32 || !buffer.subarray(0, 4).equals(magic)) {
    throw new Error('The vault data is invalid or damaged.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(buffer.length - 16));
  return Buffer.concat([decipher.update(buffer.subarray(16, buffer.length - 16)), decipher.final()]);
}
function requireUnlocked() {
  if (!unlocked || !fs.existsSync(unlocked.path)) throw new Error('The vault is locked or its USB drive has been removed.');
  return unlocked;
}
function writeManifest() {
  const state = requireUnlocked();
  const temp = path.join(state.path, MANIFEST_FILE + '.tmp');
  fs.writeFileSync(temp, encryptRecord(state.manifest, state.key, MANIFEST_MAGIC));
  fs.renameSync(temp, path.join(state.path, MANIFEST_FILE));
}
function setUnlocked(folder, key, manifest) {
  unlocked = { path: folder, key, manifest };
  pendingVaultPath = folder;
  tempSessionPath = path.join(app.getPath('temp'), 'NEXUS-SESSION-' + process.pid + '-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(tempSessionPath, { recursive: true });
}
function clearUnlocked() {
  if (isLocking) return;
  isLocking = true;
  if (unlocked && unlocked.key) unlocked.key.fill(0);
  unlocked = null;
  if (tempSessionPath) {
    try { fs.rmSync(tempSessionPath, { recursive: true, force: true }); } catch (_) {}
    tempSessionPath = null;
  }
  if (win && !win.isDestroyed()) win.webContents.send('nexus:force-lock');
  isLocking = false;
}
function ensureWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1180, height: 790, minWidth: 850, minHeight: 560,
    title: 'NEXUS', backgroundColor: '#080d14', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}
function createVault(parentFolder, password) {
  if (typeof password !== 'string' || password.length < 10) throw new Error('Use a password with at least 10 characters.');
  const parent = path.resolve(parentFolder);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error('Choose an existing folder on your USB drive.');
  const vaultPath = path.join(parent, VAULT_DIR);
  if (fs.existsSync(vaultPath)) throw new Error('A NEXUS_VAULT folder already exists here. Locate it instead.');
  fs.mkdirSync(path.join(vaultPath, OBJECTS_DIR), { recursive: true });
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const manifest = { version: 1, folders: [], files: [] };
  try {
    fs.writeFileSync(path.join(vaultPath, CONFIG_FILE), JSON.stringify({
      format: 'NEXUS-VAULT', version: 1, cipher: 'AES-256-GCM', kdf: 'scrypt',
      parameters: KDF, salt: salt.toString('base64'), created: new Date().toISOString()
    }, null, 2));
    fs.writeFileSync(path.join(vaultPath, MANIFEST_FILE), encryptRecord(manifest, key, MANIFEST_MAGIC));
    if (process.platform === 'win32') {
      try { execFileSync('attrib.exe', ['+h', '+s', vaultPath], { windowsHide: true }); } catch (_) {}
    }
    setUnlocked(vaultPath, key, manifest);
    return { ok: true, folder: vaultPath };
  } catch (error) {
    key.fill(0);
    try { fs.rmSync(vaultPath, { recursive: true, force: true }); } catch (_) {}
    throw error;
  }
}
function unlockVault(folder, password) {
  const vaultPath = locateVaultIn(folder);
  if (!vaultPath) throw new Error('NEXUS could not find a valid vault on that drive.');
  const config = JSON.parse(fs.readFileSync(path.join(vaultPath, CONFIG_FILE), 'utf8'));
  const key = deriveKey(password, Buffer.from(config.salt, 'base64'));
  try {
    const manifest = JSON.parse(decryptRecord(fs.readFileSync(path.join(vaultPath, MANIFEST_FILE)), key, MANIFEST_MAGIC).toString('utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.folders)) throw new Error('Invalid vault index.');
    setUnlocked(vaultPath, key, manifest);
    return { ok: true, folder: vaultPath };
  } catch (_) {
    key.fill(0);
    throw new Error('Incorrect password, or the vault is damaged.');
  }
}
function folderChain(folderId, manifest) {
  const chain = [];
  let cursor = folderId, guard = 0;
  while (cursor && guard++ < 1000) {
    const folder = manifest.folders.find(item => item.id === cursor);
    if (!folder) break;
    chain.unshift({ id: folder.id, name: folder.name });
    cursor = folder.parentId;
  }
  return chain;
}
function listFolder(folderId) {
  const state = requireUnlocked();
  const id = folderId || null;
  if (id && !state.manifest.folders.some(item => item.id === id)) throw new Error('That folder no longer exists.');
  const folders = state.manifest.folders.filter(item => item.parentId === id)
    .map(item => ({ id: item.id, name: item.name, directory: true, size: 0, modified: item.modified }));
  const files = state.manifest.files.filter(item => item.parentId === id)
    .map(item => ({ id: item.id, name: item.name, directory: false, size: item.size, modified: item.modified }));
  return { folderId: id, breadcrumbs: folderChain(id, state.manifest), entries: folders.concat(files).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })) };
}
function cleanDisplayName(name) {
  const result = path.basename(String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')).trim();
  if (!result || result === '.' || result === '..') throw new Error('That name is not valid.');
  return result.slice(0, 180);
}
function uniqueName(parentId, name, kind) {
  const state = requireUnlocked();
  const all = state.manifest.folders.concat(state.manifest.files).filter(item => item.parentId === parentId);
  const existing = new Set(all.map(item => item.name.toLowerCase()));
  if (!existing.has(name.toLowerCase())) return name;
  const ext = kind === 'file' ? path.extname(name) : '';
  const stem = kind === 'file' ? name.slice(0, name.length - ext.length) : name;
  let number = 2, candidate;
  do { candidate = stem + ' (' + number++ + ')' + ext; } while (existing.has(candidate.toLowerCase()));
  return candidate;
}
async function encryptFileToBlob(source, target, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const output = fs.createWriteStream(target, { flags: 'wx' });
  output.write(Buffer.concat([FILE_MAGIC, iv]));
  try {
    await pipeline(fs.createReadStream(source), cipher, output);
    await fs.promises.appendFile(target, cipher.getAuthTag());
  } catch (error) {
    try { fs.rmSync(target, { force: true }); } catch (_) {}
    throw error;
  }
}
async function decryptBlobToFile(blobPath, destination, key) {
  const stat = fs.statSync(blobPath);
  if (stat.size < 32) throw new Error('Encrypted file is damaged.');
  const fd = fs.openSync(blobPath, 'r');
  const header = Buffer.alloc(16), tag = Buffer.alloc(16);
  try { fs.readSync(fd, header, 0, 16, 0); fs.readSync(fd, tag, 0, 16, stat.size - 16); }
  finally { fs.closeSync(fd); }
  if (!header.subarray(0, 4).equals(FILE_MAGIC)) throw new Error('Encrypted file format is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(4, 16));
  decipher.setAuthTag(tag);
  if (stat.size === 32) {
    decipher.final();
    fs.writeFileSync(destination, Buffer.alloc(0));
  } else {
    await pipeline(fs.createReadStream(blobPath, { start: 16, end: stat.size - 17 }), decipher, fs.createWriteStream(destination, { flags: 'w' }));
  }
}
async function importPath(sourcePath, parentId, counts) {
  const state = requireUnlocked();
  const full = path.resolve(sourcePath);
  if (isInside(state.path, full)) return;
  const stat = await fs.promises.lstat(full);
  if (stat.isSymbolicLink()) return;
  const rawName = cleanDisplayName(path.basename(full));
  if (stat.isDirectory()) {
    const id = crypto.randomUUID();
    state.manifest.folders.push({ id, name: uniqueName(parentId, rawName, 'folder'), parentId, modified: stat.mtime.toISOString() });
    counts.folders++;
    const entries = await fs.promises.readdir(full, { withFileTypes: true });
    for (const entry of entries) await importPath(path.join(full, entry.name), id, counts);
  } else if (stat.isFile()) {
    const id = crypto.randomUUID(), blobId = crypto.randomUUID();
    await encryptFileToBlob(full, path.join(state.path, OBJECTS_DIR, blobId + '.nxb'), state.key);
    state.manifest.files.push({ id, name: uniqueName(parentId, rawName, 'file'), parentId, blobId, size: stat.size, modified: stat.mtime.toISOString() });
    counts.files++; counts.bytes += stat.size;
  }
}
async function importSelectedItems(parentId) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Import files and folders into the encrypted NEXUS vault',
    properties: ['openFile', 'openDirectory', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const counts = { files: 0, folders: 0, bytes: 0 };
  for (const item of result.filePaths) await importPath(item, parentId || null, counts);
  writeManifest();
  return { ok: true, ...counts };
}
function findFile(id) {
  const state = requireUnlocked();
  const file = state.manifest.files.find(item => item.id === id);
  if (!file || !/^[a-f0-9-]{36}$/i.test(file.blobId)) throw new Error('That file no longer exists.');
  return file;
}
function findFolder(id) {
  const folder = requireUnlocked().manifest.folders.find(item => item.id === id);
  if (!folder) throw new Error('That folder no longer exists.');
  return folder;
}
function removeFolderContents(folderId) {
  const state = requireUnlocked();
  for (const folder of state.manifest.folders.filter(item => item.parentId === folderId)) removeFolderContents(folder.id);
  for (const file of state.manifest.files.filter(item => item.parentId === folderId)) {
    try { fs.rmSync(path.join(state.path, OBJECTS_DIR, file.blobId + '.nxb'), { force: true }); } catch (_) {}
  }
  state.manifest.files = state.manifest.files.filter(item => item.parentId !== folderId);
  state.manifest.folders = state.manifest.folders.filter(item => item.id !== folderId);
}
function startupShortcutPath() {
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'NEXUS USB Auto-Launch.lnk');
}
async function enableAutoLaunch() {
  if (process.platform !== 'win32') throw new Error('USB auto-launch is supported on Windows only.');
  if (!app.isPackaged) throw new Error('Enable auto-launch from the compiled NEXUS.exe.');
  const targetFolder = path.join(app.getPath('appData'), 'NEXUS');
  fs.mkdirSync(targetFolder, { recursive: true });
  const targetExe = path.join(targetFolder, 'NEXUS.exe');
  if (path.resolve(process.execPath).toLowerCase() !== path.resolve(targetExe).toLowerCase()) fs.copyFileSync(process.execPath, targetExe);
  const startupFolder = path.dirname(startupShortcutPath());
  fs.mkdirSync(startupFolder, { recursive: true });
  const ok = shell.writeShortcutLink(startupShortcutPath(), 'create', {
    target: targetExe, args: '--watch-usb',
    description: 'NEXUS: open the encrypted vault when its USB drive is connected.',
    icon: targetExe, iconIndex: 0
  });
  if (!ok) throw new Error('Windows could not create the startup shortcut.');
  return { enabled: true };
}
function disableAutoLaunch() {
  if (process.platform === 'win32') {
    try { fs.rmSync(startupShortcutPath(), { force: true }); } catch (_) {}
    if (!WATCHER_MODE) { try { fs.rmSync(path.join(app.getPath('appData'), 'NEXUS', 'NEXUS.exe'), { force: true }); } catch (_) {} }
  }
  return { enabled: false };
}
function isAutoLaunchEnabled() { return process.platform === 'win32' && fs.existsSync(startupShortcutPath()); }
function startWatcher() {
  const scanAndOpen = () => {
    const found = scanForVault();
    if (found && found !== lastDetectedVault) {
      lastDetectedVault = found; pendingVaultPath = found; ensureWindow();
    } else if (!found && lastDetectedVault) {
      lastDetectedVault = null; pendingVaultPath = null; clearUnlocked();
    }
  };
  app.getFileIcon(process.execPath, { size: 'small' }).then(icon => {
    tray = new Tray(icon);
    tray.setToolTip('NEXUS USB Auto-Launch');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'NEXUS USB watcher is active', enabled: false },
      { type: 'separator' },
      { label: 'Check for USB vault now', click: scanAndOpen },
      { label: 'Disable auto-launch on this PC', click: () => { disableAutoLaunch(); app.quit(); } },
      { label: 'Quit watcher', click: () => app.quit() }
    ]));
  }).catch(() => {});
  scanAndOpen();
  watcherTimer = setInterval(scanAndOpen, 2500);
}
app.whenReady().then(() => {
  if (WATCHER_MODE && process.platform === 'win32') startWatcher();
  else { pendingVaultPath = scanForVault(); ensureWindow(); }
});
app.on('activate', () => { if (!win && !WATCHER_MODE) ensureWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !WATCHER_MODE) app.quit(); });
app.on('will-quit', () => { if (watcherTimer) clearInterval(watcherTimer); clearUnlocked(); });
powerMonitor.on('suspend', () => clearUnlocked());
setInterval(() => { if (unlocked && !fs.existsSync(unlocked.path)) clearUnlocked(); }, 1500);

ipcMain.handle('nexus:initial', () => ({ vaultPath: pendingVaultPath || scanForVault(), unlocked: Boolean(unlocked), autoLaunch: isAutoLaunchEnabled() }));
ipcMain.handle('nexus:choose-location', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Choose your USB drive or NEXUS folder', properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths[0] ? { canceled: true } : { path: result.filePaths[0] };
});
ipcMain.handle('nexus:locate-vault', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Select the NEXUS_VAULT folder or its USB drive', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const found = locateVaultIn(result.filePaths[0]);
  if (!found) return { error: 'No NEXUS encrypted vault was found there. Select the USB drive or NEXUS_VAULT folder.' };
  pendingVaultPath = found; return { ok: true, vaultPath: found };
});
ipcMain.handle('nexus:create-vault', (_event, data) => { try { return createVault(data.parentPath, data.password); } catch (error) { return { error: error.message }; } });
ipcMain.handle('nexus:unlock', (_event, password) => {
  try {
    if (!pendingVaultPath || !fs.existsSync(pendingVaultPath)) pendingVaultPath = scanForVault();
    if (!pendingVaultPath) throw new Error('No NEXUS vault found. Connect the USB or locate the vault.');
    return unlockVault(pendingVaultPath, password);
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:lock', () => { clearUnlocked(); return { ok: true }; });
ipcMain.handle('nexus:list', (_event, folderId) => { try { return listFolder(folderId); } catch (error) { return { error: error.message }; } });
ipcMain.handle('nexus:import', async (_event, parentId) => { try { return await importSelectedItems(parentId); } catch (error) { return { error: error.message }; } });
ipcMain.handle('nexus:new-folder', (_event, name, parentId) => {
  try {
    const state = requireUnlocked();
    const folder = { id: crypto.randomUUID(), name: uniqueName(parentId || null, cleanDisplayName(name), 'folder'), parentId: parentId || null, modified: new Date().toISOString() };
    state.manifest.folders.push(folder); writeManifest(); return { ok: true, folder };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:rename', (_event, id, name, isFolder) => {
  try {
    const state = requireUnlocked(), item = isFolder ? findFolder(id) : findFile(id);
    const clean = cleanDisplayName(name);
    const collision = state.manifest.folders.concat(state.manifest.files).some(other => other.id !== id && other.parentId === item.parentId && other.name.toLowerCase() === clean.toLowerCase());
    if (collision) throw new Error('An item with that name already exists in this folder.');
    item.name = clean; writeManifest(); return { ok: true };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:delete', (_event, id, isFolder) => {
  try {
    const state = requireUnlocked();
    if (isFolder) { findFolder(id); removeFolderContents(id); }
    else {
      const file = findFile(id);
      try { fs.rmSync(path.join(state.path, OBJECTS_DIR, file.blobId + '.nxb'), { force: true }); } catch (_) {}
      state.manifest.files = state.manifest.files.filter(item => item.id !== id);
    }
    writeManifest(); return { ok: true };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:open-file', async (_event, id) => {
  let tempFile = null;
  try {
    const state = requireUnlocked(), file = findFile(id), ext = path.extname(file.name);
    tempFile = path.join(tempSessionPath, crypto.randomUUID() + ext);
    await decryptBlobToFile(path.join(state.path, OBJECTS_DIR, file.blobId + '.nxb'), tempFile, state.key);
    const error = await shell.openPath(tempFile);
    return { ok: !error, error: error || null };
  } catch (error) {
    if (tempFile) { try { fs.rmSync(tempFile, { force: true }); } catch (_) {} }
    return { error: error.message };
  }
});
ipcMain.handle('nexus:export-file', async (_event, id) => {
  try {
    const state = requireUnlocked(), file = findFile(id);
    const result = await dialog.showSaveDialog(win, { title: 'Export an unencrypted copy', defaultPath: file.name });
    if (result.canceled || !result.filePath) return { canceled: true };
    await decryptBlobToFile(path.join(state.path, OBJECTS_DIR, file.blobId + '.nxb'), result.filePath, state.key);
    return { ok: true, path: result.filePath };
  } catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:auto-launch', async (_event, enabled) => {
  try { return enabled ? await enableAutoLaunch() : disableAutoLaunch(); }
  catch (error) { return { error: error.message }; }
});
ipcMain.handle('nexus:close-window', () => { if (!WATCHER_MODE) app.quit(); else if (win) win.hide(); return { ok: true }; });
