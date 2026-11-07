const { app, BrowserWindow, ipcMain, dialog, powerMonitor } = require('electron');
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

let win = null;
let pendingVaultPath = null;
let unlocked = null;
let isLocking = false;
let syncInterval = null;
let syncDebounce = null;
let syncWatchers = [];
let syncRunning = false;
let syncQueued = false;
let syncStats = { lastSyncAt: null, added: 0, updated: 0, failed: 0, sources: 0 };


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
  if (!Array.isArray(manifest.syncSources)) manifest.syncSources = [];
  unlocked = { path: folder, key, manifest };
  pendingVaultPath = folder;
  startSyncMonitoring();
}
function clearUnlocked() {
  if (isLocking) return;
  isLocking = true;
  stopSyncMonitoring();
  if (unlocked && unlocked.key) unlocked.key.fill(0);
  unlocked = null;
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

function currentSyncStatus() {
  return {
    ...syncStats,
    sources: unlocked ? (unlocked.manifest.syncSources || []).length : 0,
    active: Boolean(unlocked),
    running: syncRunning
  };
}
function publishSyncStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('nexus:sync-status', currentSyncStatus());
}
function stopSyncMonitoring() {
  if (syncInterval) clearInterval(syncInterval);
  if (syncDebounce) clearTimeout(syncDebounce);
  syncInterval = null;
  syncDebounce = null;
  for (const watcher of syncWatchers) {
    try { watcher.close(); } catch (_) {}
  }
  syncWatchers = [];
  syncQueued = false;
  publishSyncStatus();
}
function scheduleSync(delay = 900) {
  if (!unlocked) return;
  if (syncDebounce) clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => {
    syncDebounce = null;
    runSyncNow().catch(error => {
      syncStats.failed++;
      publishSyncStatus();
      console.error('NEXUS sync failed:', error);
    });
  }, delay);
}
function startSyncMonitoring() {
  stopSyncMonitoring();
  if (!unlocked) return;
  for (const source of unlocked.manifest.syncSources || []) {
    try {
      if (fs.existsSync(source.path)) {
        const watcher = fs.watch(source.path, { recursive: true }, () => scheduleSync());
        watcher.on('error', () => scheduleSync());
        syncWatchers.push(watcher);
      }
    } catch (_) {
      // The polling pass below remains as a fallback if Windows cannot watch this path.
    }
  }
  syncInterval = setInterval(() => scheduleSync(250), 15000);
  publishSyncStatus();
  scheduleSync(1200);
}
function findSyncedFile(sourceId, relativePath) {
  return unlocked.manifest.files.find(item =>
    item.syncSourceId === sourceId && item.syncRelativePath === relativePath
  );
}
function ensureSyncedFolder(source, relativePath, parentId, name, counts) {
  const state = requireUnlocked();
  let folder = state.manifest.folders.find(item =>
    item.syncSourceId === source.id && item.syncRelativePath === relativePath
  );
  if (!folder) {
    folder = {
      id: crypto.randomUUID(),
      name: uniqueName(parentId, cleanDisplayName(name), 'folder'),
      parentId,
      modified: new Date().toISOString(),
      syncSourceId: source.id,
      syncRelativePath: relativePath
    };
    state.manifest.folders.push(folder);
    counts.folders++;
  }
  return folder;
}
async function syncOneFile(source, fullPath, relativePath, parentId, counts) {
  const state = requireUnlocked();
  const before = await fs.promises.stat(fullPath);
  if (!before.isFile()) return;
  const existing = findSyncedFile(source.id, relativePath);
  if (existing && existing.size === before.size && existing.sourceMtimeMs === before.mtimeMs) return;

  const blobId = crypto.randomUUID();
  const finalPath = path.join(state.path, OBJECTS_DIR, blobId + '.nxb');
  const tempPath = finalPath + '.tmp';
  try {
    await encryptFileToBlob(fullPath, tempPath, state.key);
    const after = await fs.promises.stat(fullPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
      return;
    }
    requireUnlocked();
    fs.renameSync(tempPath, finalPath);
    const previousBlob = existing ? existing.blobId : null;
    if (existing) {
      existing.blobId = blobId;
      existing.size = after.size;
      existing.modified = after.mtime.toISOString();
      existing.sourceMtimeMs = after.mtimeMs;
      existing.name = cleanDisplayName(path.basename(fullPath));
      counts.updated++;
    } else {
      state.manifest.files.push({
        id: crypto.randomUUID(),
        name: uniqueName(parentId, cleanDisplayName(path.basename(fullPath)), 'file'),
        parentId,
        blobId,
        size: after.size,
        modified: after.mtime.toISOString(),
        syncSourceId: source.id,
        syncRelativePath: relativePath,
        sourceMtimeMs: after.mtimeMs
      });
      counts.added++;
    }
    try {
      writeManifest();
      if (previousBlob) {
        try { fs.rmSync(path.join(state.path, OBJECTS_DIR, previousBlob + '.nxb'), { force: true }); } catch (_) {}
      }
    } catch (error) {
      if (existing) {
        // Keep the previous encrypted object reference if the manifest could not be saved.
        existing.blobId = previousBlob;
      } else {
        state.manifest.files = state.manifest.files.filter(item => item.blobId !== blobId);
      }
      try { fs.rmSync(finalPath, { force: true }); } catch (_) {}
      throw error;
    }
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}
async function syncOneSource(source, counts) {
  const state = requireUnlocked();
  const root = path.resolve(source.path);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    counts.failed++;
    return;
  }
  if (isInside(state.path, root)) {
    counts.failed++;
    return;
  }
  const rootName = cleanDisplayName(path.basename(root) || source.label || 'Synced folder');
  const rootFolder = ensureSyncedFolder(source, '', null, rootName, counts);

  async function walk(directory, relativeDirectory, parentId) {
    if (!unlocked || unlocked !== state || !fs.existsSync(state.path)) return;
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch (_) {
      counts.failed++;
      return;
    }
    for (const entry of entries) {
      if (!unlocked || unlocked !== state) return;
      const fullPath = path.join(directory, entry.name);
      if (isInside(state.path, fullPath)) continue;
      let stat;
      try { stat = await fs.promises.lstat(fullPath); } catch (_) { counts.failed++; continue; }
      if (stat.isSymbolicLink()) continue;
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (stat.isDirectory()) {
        const folder = ensureSyncedFolder(source, relativePath, parentId, entry.name, counts);
        await walk(fullPath, relativePath, folder.id);
      } else if (stat.isFile()) {
        try { await syncOneFile(source, fullPath, relativePath, parentId, counts); }
        catch (error) { counts.failed++; console.error('NEXUS could not sync', fullPath, error); }
      }
    }
  }
  await walk(root, '', rootFolder.id);
}
async function runSyncNow() {
  if (!unlocked) return { error: 'Unlock the NEXUS vault before syncing.' };
  if (syncRunning) {
    syncQueued = true;
    return { ok: true, queued: true, ...currentSyncStatus() };
  }
  syncRunning = true;
  const counts = { added: 0, updated: 0, failed: 0, folders: 0 };
  try {
    const sources = [...(unlocked.manifest.syncSources || [])];
    for (const source of sources) {
      if (!unlocked) break;
      await syncOneSource(source, counts);
    }
    if (unlocked && counts.folders) writeManifest();
    syncStats = {
      lastSyncAt: new Date().toISOString(),
      added: counts.added,
      updated: counts.updated,
      failed: counts.failed,
      sources: sources.length
    };
  } finally {
    syncRunning = false;
    publishSyncStatus();
    if (syncQueued && unlocked) {
      syncQueued = false;
      scheduleSync(500);
    }
  }
  return { ok: true, ...currentSyncStatus() };
}
async function addSyncFolders() {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose PC folders to sync into the encrypted NEXUS USB',
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const state = requireUnlocked();
  const existing = new Set((state.manifest.syncSources || []).map(item => path.resolve(item.path).toLowerCase()));
  let added = 0;
  for (const folderPath of result.filePaths) {
    const absolute = path.resolve(folderPath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) continue;
    if (isInside(state.path, absolute)) continue;
    const key = absolute.toLowerCase();
    if (existing.has(key)) continue;
    state.manifest.syncSources.push({
      id: crypto.randomUUID(),
      path: absolute,
      label: path.basename(absolute) || absolute,
      addedAt: new Date().toISOString()
    });
    existing.add(key);
    added++;
  }
  writeManifest();
  startSyncMonitoring();
  const resultSync = await runSyncNow();
  return { ok: true, added, ...resultSync };
}
function findFile(id) {
  const state = requireUnlocked();
  const file = state.manifest.files.find(item => item.id === id);
  if (!file || !/^[a-f0-9-]{36}$/i.test(file.blobId)) throw new Error('That file no longer exists.');
  return file;
}

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.txt','.md','.markdown','.csv','.tsv','.json','.xml','.log','.js','.jsx',
  '.ts','.tsx','.css','.html','.htm','.py','.java','.c','.cpp','.h','.hpp',
  '.cs','.php','.sql','.yaml','.yml','.toml','.ini','.sh','.bat','.ps1'
]);
const PREVIEW_TYPES = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.ico': { kind: 'image', mime: 'image/x-icon' },
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mov': { kind: 'video', mime: 'video/quicktime' }
};
function previewFile(id) {
  const state = requireUnlocked();
  const file = findFile(id);
  const blobPath = path.join(state.path, OBJECTS_DIR, file.blobId + '.nxb');
  const stat = fs.statSync(blobPath);
  if (stat.size > MAX_PREVIEW_BYTES + 32) {
    throw new Error('This file is too large for the built-in NEXUS preview (32 MB limit). It remains encrypted on the USB.');
  }
  const plaintext = decryptRecord(fs.readFileSync(blobPath), state.key, FILE_MAGIC);
  const ext = path.extname(file.name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    const text = plaintext.toString('utf8');
    plaintext.fill(0);
    return { ok: true, kind: 'text', name: file.name, text };
  }
  const type = PREVIEW_TYPES[ext];
  if (!type) {
    plaintext.fill(0);
    throw new Error('NEXUS cannot preview this file type yet. It remains encrypted, and NEXUS will not open it in another application.');
  }
  const data = plaintext.toString('base64');
  plaintext.fill(0);
  return { ok: true, kind: type.kind, mime: type.mime, name: file.name, data };
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
app.whenReady().then(() => {
  pendingVaultPath = scanForVault();
  ensureWindow();
});
app.on('activate', () => { if (!win) ensureWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => clearUnlocked());
powerMonitor.on('suspend', () => clearUnlocked());
setInterval(() => { if (unlocked && !fs.existsSync(unlocked.path)) clearUnlocked(); }, 1500);

ipcMain.handle('nexus:initial', () => ({ vaultPath: pendingVaultPath || scanForVault(), unlocked: Boolean(unlocked) }));
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
ipcMain.handle('nexus:add-sync-folders', async () => { try { return await addSyncFolders(); } catch (error) { return { error: error.message }; } });
ipcMain.handle('nexus:sync-now', async () => { try { return await runSyncNow(); } catch (error) { return { error: error.message }; } });
ipcMain.handle('nexus:sync-status', () => currentSyncStatus());
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
ipcMain.handle('nexus:preview-file', (_event, id) => {
  try { return previewFile(id); } catch (error) { return { error: error.message }; }
});
