let currentFolderId = null;
let currentEntries = [];
let selectedItem = null;
let vaultPath = null;
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
      else {
        const result = await window.nexus.openFile(item.id);
        if (result.error) alert(result.error);
      }
    });
    list.append(row);
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
$('import-button').addEventListener('click', async () => {
  const result = await window.nexus.importItems(currentFolderId);
  if (result.error) { alert(result.error); return; }
  if (result.canceled) return;
  await refreshFolder();
  alert('Encrypted import complete: ' + result.files + ' files and ' + result.folders + ' folders. Original source copies have NOT been deleted.');
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
  const action = prompt('Type: rename, export, or delete');
  if (!action) return;
  if (action.toLowerCase() === 'rename') {
    const name = prompt('New name:', selectedItem.name);
    if (name) window.nexus.rename(selectedItem.id, name, selectedItem.directory).then(result => result.error ? alert(result.error) : refreshFolder());
  } else if (action.toLowerCase() === 'export' && !selectedItem.directory) {
    window.nexus.exportFile(selectedItem.id).then(result => { if (result.error) alert(result.error); });
  } else if (action.toLowerCase() === 'delete') {
    if (confirm('Delete ' + selectedItem.name + ' from the encrypted vault? This cannot be undone.')) {
      window.nexus.deleteItem(selectedItem.id, selectedItem.directory).then(result => result.error ? alert(result.error) : refreshFolder());
    }
  }
});
window.nexus.onForceLock(() => {
  vaultPath = null;
  showLock('The USB was removed or the device suspended. NEXUS has locked the vault.');
});
window.addEventListener('beforeunload', () => { window.nexus.lock(); });
initialize();
