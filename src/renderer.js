let current = null;
let history = [];
let historyIndex = -1;
const $ = id => document.getElementById(id);

function formatSize(bytes) {
  if (!bytes) return '—';
  const units = ['B','KB','MB','GB','TB'];
  let size = bytes, unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return size.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
}
function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function setActive(buttonId) {
  document.querySelectorAll('.side-link').forEach(button => button.classList.remove('selected'));
  if (buttonId) $(buttonId).classList.add('selected');
}
function renderDrives(drives) {
  const list = $('drive-list');
  list.innerHTML = '';
  drives.forEach(drive => {
    const button = document.createElement('button');
    button.className = 'drive-link';
    button.innerHTML = '<span>▣</span><span></span>';
    button.lastElementChild.textContent = drive.name;
    button.addEventListener('click', () => navigate(drive.path));
    list.append(button);
  });
}
function renderBreadcrumbs(folderPath) {
  const bar = $('breadcrumbs');
  bar.innerHTML = '';
  const parsed = folderPath.replace(/\\/g, '/');
  const parts = parsed.split('/').filter(Boolean);
  let currentPath = folderPath.startsWith('/') ? '/' : '';
  if (/^[A-Za-z]:/.test(parts[0] || '')) {
    currentPath = parts[0] + '\\';
    parts.shift();
  }
  const root = document.createElement('button');
  root.className = 'crumb';
  root.textContent = 'This PC';
  root.addEventListener('click', showHome);
  bar.append(root);
  parts.forEach((part, index) => {
    const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›'; bar.append(sep);
    currentPath = currentPath === '/' ? '/' + part : currentPath ? currentPath.replace(/[\\/]$/, '') + (currentPath.includes(':') ? '\\' : '/') + part : part;
    const crumb = document.createElement('button');
    crumb.className = 'crumb';
    crumb.textContent = part;
    const target = index === parts.length - 1 ? folderPath : currentPath;
    crumb.addEventListener('click', () => navigate(target));
    bar.append(crumb);
  });
}
function renderFolder(data, addHistory = true) {
  if (!data || data.error) { alert(data?.error || 'Unable to open folder.'); return; }
  current = data;
  if (addHistory) {
    history = history.slice(0, historyIndex + 1);
    history.push(data.path);
    historyIndex = history.length - 1;
  }
  $('welcome').classList.add('hidden');
  $('quick-access').classList.add('hidden');
  $('file-area').classList.remove('hidden');
  $('page-title').textContent = data.path;
  $('folder-title').textContent = data.path.split(/[\\/]/).filter(Boolean).pop() || data.path;
  $('item-count').textContent = data.entries.length + (data.entries.length === 1 ? ' item' : ' items');
  $('back-button').disabled = historyIndex <= 0;
  $('up-button').disabled = !data.parent;
  renderBreadcrumbs(data.path);
  renderDrives(data.drives || []);
  drawEntries(data.entries);
}
function drawEntries(entries) {
  const list = $('file-list');
  list.innerHTML = '';
  $('empty-state').classList.toggle('hidden', entries.length !== 0);
  entries.forEach(entry => {
    const row = document.createElement('button');
    row.className = 'file-row';
    const name = document.createElement('span'); name.className = 'file-name';
    const icon = document.createElement('span'); icon.className = entry.directory ? 'item-icon folder-icon' : 'item-icon file-icon';
    icon.textContent = entry.directory ? '▰' : '▤';
    const label = document.createElement('span'); label.textContent = entry.name;
    name.append(icon, label);
    const type = document.createElement('span'); type.className = 'file-type'; type.textContent = entry.extension;
    const date = document.createElement('span'); date.className = 'file-date'; date.textContent = formatDate(entry.modified);
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = entry.directory ? '—' : formatSize(entry.size);
    row.append(name, type, date, size);
    row.addEventListener('dblclick', async () => {
      if (entry.directory) await navigate(entry.path);
      else {
        const error = await window.nexus.openFile(entry.path);
        if (error) alert(error);
      }
    });
    row.addEventListener('click', () => {
      document.querySelectorAll('.file-row').forEach(item => item.classList.remove('focused'));
      row.classList.add('focused');
    });
    list.append(row);
  });
}
async function navigate(folder, addHistory = true) {
  const result = await window.nexus.navigate(folder);
  renderFolder(result, addHistory);
}
function showHome() {
  $('welcome').classList.remove('hidden');
  $('quick-access').classList.remove('hidden');
  $('file-area').classList.add('hidden');
  $('page-title').textContent = 'Home';
  $('folder-title').textContent = 'Quick access';
  $('item-count').textContent = '';
  $('breadcrumbs').innerHTML = '';
  setActive('home-button');
}
async function showComputer() {
  const drives = await window.nexus.getDrives();
  renderDrives(drives);
  $('welcome').classList.add('hidden');
  $('quick-access').classList.remove('hidden');
  $('file-area').classList.add('hidden');
  $('page-title').textContent = 'This PC';
  $('folder-title').textContent = 'Available drives';
  $('item-count').textContent = drives.length + ' drives';
  $('usb-card').classList.add('hidden');
  $('computer-card').classList.add('hidden');
  $('breadcrumbs').innerHTML = '<span class="crumb current">This PC</span>';
  setActive('all-files-button');
  const grid = $('quick-access');
  grid.innerHTML = '';
  drives.forEach(drive => {
    const card = document.createElement('button');
    card.className = 'quick-card';
    card.innerHTML = '<span class="quick-symbol pc-symbol">▣</span><b></b><small>Open drive</small>';
    card.querySelector('b').textContent = drive.name;
    card.addEventListener('click', () => navigate(drive.path));
    grid.append(card);
  });
}
$('home-button').addEventListener('click', showHome);
$('all-files-button').addEventListener('click', showComputer);
$('usb-card').addEventListener('click', () => navigate(current?.path || ''));
$('computer-card').addEventListener('click', showComputer);
$('browse-button').addEventListener('click', async () => {
  const result = await window.nexus.chooseFolder();
  if (!result.canceled) renderFolder(result);
});
$('open-folder').addEventListener('click', async () => {
  const result = await window.nexus.chooseFolder();
  if (!result.canceled) renderFolder(result);
});
$('up-button').addEventListener('click', () => { if (current?.parent) navigate(current.parent); });
$('back-button').addEventListener('click', async () => {
  if (historyIndex > 0) {
    historyIndex--;
    const result = await window.nexus.navigate(history[historyIndex]);
    renderFolder(result, false);
  }
});
$('refresh-button').addEventListener('click', () => { if (current) navigate(current.path, false); });
$('search').addEventListener('input', event => {
  if (!current) return;
  const query = event.target.value.toLowerCase();
  drawEntries(current.entries.filter(entry => entry.name.toLowerCase().includes(query)));
});
(async () => {
  const data = await window.nexus.initial();
  renderFolder(data);
  showHome();
})();
