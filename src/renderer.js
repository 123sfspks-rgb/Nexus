let currentFolderId = null;
let currentEntries = [];
let selectedItem = null;
let vaultPath = null;
let activeObjectUrl = null;
let syncStatus = null;
const $ = id => document.getElementById(id);

function showLock(message) {
  $('vault-app').classList.add('hidden');
  $('lock-screen').classList.remove('hidden');
  $('unlock-panel').classList.add('hidden');
  $('no-vault-panel').classList.add('hidden');
  $('create-panel').classList.add('hidden');
  $('unlock-error').textContent = '';
  $('create-error').textContent = '';
  $('lock-description').textContent = message || 'Your files are encrypted. Enter your vault password to unlock them.';
}
function showUnlock() {
  $('unlock-panel').classList.remove('hidden');
  $('no-vault-panel').classList.add('hidden');
  $('create-panel').classList.add('hidden');
  $('lock-description').textContent = 'Your NEXUS vault was found. Enter the password to decrypt and access your files.';
  $('lock-status').textContent = 'ENCRYPTED VAULT DETECTED';
}
function showNoVault() {
  $('unlock-panel').classList.add('hidden');
  $('no-vault-panel').classList.remove('hidden');
  $('create-panel').classList.add('hidden');
  $('lock-description').textContent = 'Connect the USB containing your vault, locate it, or create a new encrypted vault on a USB drive.';
  $('lock-status').textContent = 'NO VAULT SELECTED';
}
async function initialize() {
  const state = await window.nexus.initial();
  vaultPath = state.vaultPath;
  if (state.unlocked) await openVault();
  else if (vaultPath) showUnlock();
  else showNoVault();
}
async function unlock() {
  const password = $('unlock-password').value;
  if (!password) { $('unlock-error').textContent = 'Enter your password.'; return; }
  $('unlock-button').disabled = true;
  const result = await window.nexus.unlock(password);
  $('unlock-button').disabled = false;
  $('unlock-password').value = '';
  if (result.error) { $('unlock-error').textContent = result.error; return; }
  await openVault();
}
async function openVault(folderId = null) {
  $('lock-screen').classList.add('hidden');
  $('vault-app').classList.remove('hidden');
  currentFolderId = folderId;
  selectedItem = null;
  $('search').value = '';
  await refreshFolder();
}
async function refreshFolder() {
  const data = await window.nexus.list(currentFolderId);
  if (data.error) { showLock(data.error); return; }
  currentEntries = data.entries;
  $('folder-title').textContent = data.breadcrumbs.length ? data.breadcrumbs[data.breadcrumbs.length - 1].name : 'Vault root';
  $('item-count').textContent = data.entries.length + (data.entries.length === 1 ? ' item' : ' items');
  $('up-button').disabled = !currentFolderId;
  const bar = $('breadcrumbs'); bar.innerHTML = '';
  const root = document.createElement('button'); root.className = 'crumb'; root.textContent = 'My files';
  root.addEventListener('click', () => openVault(null)); bar.append(root);
  data.breadcrumbs.forEach(folder => {
    const sep = document.createElement('span'); sep.textContent = '›'; sep.className = 'crumb-sep'; bar.append(sep);
    const crumb = document.createElement('button'); crumb.className = 'crumb'; crumb.textContent = folder.name;
    crumb.addEventListener('click', () => openVault(folder.id)); bar.append(crumb);
  });
  drawEntries(currentEntries.filter(item => item.name.toLowerCase().includes($('search').value.toLowerCase())));
}
function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB']; let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + units[i];
}
function humanDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function drawEntries(entries) {
  const list = $('file-list'); list.innerHTML = ''; selectedItem = null;
  $('empty-state').classList.toggle('hidden', entries.length !== 0);
  for (const item of entries) {
    const row = document.createElement('button'); row.className = 'file-row';
    const name = document.createElement('span'); name.className = 'file-name';
    const icon = document.createElement('span'); icon.className = item.directory ? 'item-icon folder-icon' : 'item-icon file-icon'; icon.textContent = item.directory ? '▰' : '▤';
    const label = document.createElement('span'); label.textContent = item.name; name.append(icon, label);
    const type = document.createElement('span'); type.className = 'file-type'; type.textContent = item.directory ? 'FOLDER' : (item.name.split('.').pop() || 'FILE').toUpperCase();
    const date = document.createElement('span'); date.className = 'file-date'; date.textContent = humanDate(item.modified);
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = item.directory ? '—' : humanSize(item.size);
    row.append(name, type, date, size);
    row.addEventListener('click', () => {
      document.querySelectorAll('.file-row').forEach(el => el.classList.remove('focused'));
      row.classList.add('focused'); selectedItem = item;
    });
    row.addEventListener('dblclick', async () => {
      if (item.directory) await openVault(item.id);
      else await previewItem(item);
    });
    list.append(row);
  }
}

async function previewItem(item) {
  closeViewer();
  const result = await window.nexus.previewFile(item.id);
  if (result.error) { alert(result.error); return; }
  $('viewer-title').textContent = result.name;
  const host = $('viewer-content');
  host.replaceChildren();
  if (result.kind === 'text') {
    const pre = document.createElement('pre');
    pre.className = 'text-preview';
    pre.textContent = result.text;
    host.append(pre);
  } else {
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: result.mime });
    activeObjectUrl = URL.createObjectURL(blob);
    let element;
    if (result.kind === 'image') {
      element = document.createElement('img');
      element.className = 'image-preview';
    } else if (result.kind === 'pdf') {
      element = document.createElement('iframe');
      element.className = 'pdf-preview';
      element.title = result.name;
    } else {
      element = document.createElement(result.kind);
      element.controls = true;
      element.className = result.kind + '-preview';
    }
    element.src = activeObjectUrl;
    host.append(element);
  }
  $('viewer').classList.remove('hidden');
}
function closeViewer() {
  $('viewer').classList.add('hidden');
  $('viewer-content').replaceChildren();
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}


function renderSyncStatus(status) {
  syncStatus = status;
  const count = status && Number(status.sources || 0);
  const label = $('sync-status');
  if (!label) return;
  const manageButton = $('sync-folders-button');
  if (manageButton) manageButton.textContent = status && status.sources ? 'MANAGE SYNC (' + status.sources + ')' : '＋ SYNC PC FOLDERS';
  if (!status || !status.active) label.textContent = 'SYNC PAUSED';
  else if (!count) label.textContent = 'NO PC FOLDERS SYNCED';
  else if (status.running) label.textContent = 'SYNCING ' + count + ' FOLDER' + (count === 1 ? '' : 'S');
  else label.textContent = 'AUTO-SYNC ON · ' + count + ' FOLDER' + (count === 1 ? '' : 'S');
  if (status && status.lastSyncAt) {
    label.title = 'Last sync: ' + new Date(status.lastSyncAt).toLocaleString() +
      ' · Added ' + (status.added || 0) + ' · Updated ' + (status.updated || 0) +
      ' · Errors ' + (status.failed || 0);
  } else {
    label.title = 'Choose PC folders to keep encrypted copies synced to this USB.';
  }
}
async function setupSyncFolders() {
  const current = await window.nexus.syncSources();
  if (current.sources.length) {
    const lines = current.sources.map((source, index) =>
      (index + 1) + '. ' + source.label + '\\n   ' + source.path
    ).join('\\n');
    const choice = prompt(
      'AUTOMATIC PC SYNC\\n\\n' + lines +
      '\\n\\nType ADD to add more folders, or enter a folder number to stop syncing it. ' +
      'Its already-encrypted files will stay in NEXUS.'
    );
    if (choice === null) return;
    if (choice.trim().toLowerCase() !== 'add') {
      const index = Number(choice.trim()) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= current.sources.length) {
        alert('No change made.');
        return;
      }
      const source = current.sources[index];
      if (!confirm('Stop syncing "' + source.label + '"? Its encrypted files will remain in the vault.')) return;
      const removed = await window.nexus.removeSyncSource(source.id);
      if (removed.error) alert(removed.error);
      renderSyncStatus(await window.nexus.syncStatus());
      return;
    }
  }
  const result = await window.nexus.addSyncFolders();
  if (result.error) { alert(result.error); return; }
  if (result.canceled) return;
  renderSyncStatus(await window.nexus.syncStatus());
  if (result.added) {
    alert('NEXUS added ' + result.added + ' PC folder' + (result.added === 1 ? '' : 's') +
      ' to automatic sync. New and changed files will be encrypted into this USB while it is connected and the vault is unlocked.');
  } else {
    alert('Those folders were already in your sync list. NEXUS checked them again.');
  }
}

async function createVault() {
  const password = $('new-password').value, confirmPassword = $('confirm-password').value;
  if (password.length < 10) { $('create-error').textContent = 'Use at least 10 characters.'; return; }
  if (password !== confirmPassword) { $('create-error').textContent = 'The passwords do not match.'; return; }
  $('create-vault-button').disabled = true;
  const result = await window.nexus.createVault({ parentPath: window.selectedVaultParent, password });
  $('create-vault-button').disabled = false;
  $('new-password').value = ''; $('confirm-password').value = '';
  if (result.error) { $('create-error').textContent = result.error; return; }
  vaultPath = result.folder; await openVault(null);
}
$('unlock-button').addEventListener('click', unlock);
$('unlock-password').addEventListener('keydown', event => { if (event.key === 'Enter') unlock(); });
$('locate-button').addEventListener('click', async () => {
  const result = await window.nexus.locateVault();
  if (result.error) { alert(result.error); return; }
  if (!result.canceled) { vaultPath = result.vaultPath; showUnlock(); }
});
$('create-button').addEventListener('click', async () => {
  const result = await window.nexus.chooseLocation();
  if (result.canceled) return;
  window.selectedVaultParent = result.path;
  $('selected-location').textContent = 'Vault will be created in: ' + result.path + '\\NEXUS_VAULT';
  $('no-vault-panel').classList.add('hidden'); $('create-panel').classList.remove('hidden');
});
$('create-vault-button').addEventListener('click', createVault);
$('lock-button').addEventListener('click', async () => {
  closeViewer();
  await window.nexus.lock();
  if (vaultPath) showUnlock(); else showNoVault();
});
$('vault-home').addEventListener('click', () => openVault(null));
$('up-button').addEventListener('click', async () => {
  const data = await window.nexus.list(currentFolderId);
  if (data.breadcrumbs.length) await openVault(data.breadcrumbs.length > 1 ? data.breadcrumbs[data.breadcrumbs.length - 2].id : null);
});
$('refresh-button').addEventListener('click', refreshFolder);
$('search').addEventListener('input', () => drawEntries(currentEntries.filter(item => item.name.toLowerCase().includes($('search').value.toLowerCase()))));
$('sync-folders-button').addEventListener('click', setupSyncFolders);
$('sync-now-button').addEventListener('click', async () => {
  const result = await window.nexus.syncNow();
  if (result.error) alert(result.error);
  renderSyncStatus(await window.nexus.syncStatus());
});
window.nexus.onSyncStatus(renderSyncStatus);
window.nexus.syncStatus().then(renderSyncStatus);
$('import-button').addEventListener('click', async () => {
  const result = await window.nexus.importItems(currentFolderId);
  if (result.error) { alert(result.error); return; }
  if (result.canceled) return;
  await refreshFolder();
  alert('Encrypted import complete: ' + result.files + ' files and ' + result.folders + ' folders. Original source copies remain unchanged. If they are on this USB, they are still readable outside NEXUS.');
});
$('new-folder-button').addEventListener('click', async () => {
  const name = prompt('New folder name:');
  if (!name) return;
  const result = await window.nexus.newFolder(name, currentFolderId);
  if (result.error) alert(result.error); else await refreshFolder();
});
$('file-list').addEventListener('contextmenu', event => {
  const row = event.target.closest('.file-row'); if (!row) return;
  event.preventDefault(); row.click(); if (!selectedItem) return;
  const action = prompt('Type: rename or delete');
  if (!action) return;
  if (action.toLowerCase() === 'rename') {
    const name = prompt('New name:', selectedItem.name);
    if (name) window.nexus.rename(selectedItem.id, name, selectedItem.directory).then(result => result.error ? alert(result.error) : refreshFolder());
  } else if (action.toLowerCase() === 'delete') {
    if (confirm('Delete ' + selectedItem.name + ' from the encrypted vault? This cannot be undone.')) {
      window.nexus.deleteItem(selectedItem.id, selectedItem.directory).then(result => result.error ? alert(result.error) : refreshFolder());
    }
  }
});
window.nexus.onForceLock(() => {
  closeViewer();
  vaultPath = null;
  showLock('The USB was removed or the device suspended. NEXUS has locked the vault.');
});
$('viewer-close').addEventListener('click', closeViewer);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeViewer(); });
window.addEventListener('beforeunload', () => { closeViewer(); window.nexus.lock(); });
initialize();
