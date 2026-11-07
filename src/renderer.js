const { Terminal } = window;
const { FitAddon } = window;
let term;
let fit;
let activeView = 'overview';

const $ = id => document.getElementById(id);
function showView(name) {
  activeView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== name));
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const titles = { overview: ['OVERVIEW','Command centre'], terminal: ['TERMINAL','Local terminal'], files: ['FILE EXPLORER','Workspace files'] };
  $('current-section').textContent = titles[name][0];
  $('page-title').textContent = titles[name][1];
  if (name === 'terminal') startTerminal();
  if (name === 'files') refreshFiles();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showView(b.dataset.go)));

async function loadSystem() {
  const info = await window.nexus.systemInfo();
  $('hostname').textContent = info.hostname;
  $('platform').textContent = info.platform + ' · ' + info.release;
  $('username').textContent = info.username;
  $('cwd').textContent = info.cwd;
  $('file-path').textContent = info.cwd;
}
async function startTerminal() {
  if (term) { fit.fit(); return; }
  term = new Terminal({
    cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13,
    theme: { background:'#05090e', foreground:'#d8e8ed', cursor:'#55e6dc',
      selectionBackground:'#23515b', black:'#071018', green:'#55e6a7', cyan:'#55e6dc',
      blue:'#5799ff', yellow:'#e8c779', red:'#ef7c83' },
    convertEol: false, scrollback: 5000
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open($('terminal-root'));
  fit.fit();
  term.onData(data => window.nexus.writeTerminal(data));
  window.nexus.onTerminalData(data => term.write(data));
  window.nexus.onTerminalExit(code => term.write('\r\n\x1b[90m[process exited: ' + code + ']\x1b[0m\r\n'));
  try {
    const result = await window.nexus.startTerminal();
    $('shell-label').textContent = result.shell.toUpperCase();
    term.focus();
  } catch (error) {
    term.write('\r\n\x1b[31mUnable to start shell: ' + error.message + '\x1b[0m\r\n');
  }
  window.addEventListener('resize', () => { if (activeView === 'terminal') { fit.fit(); window.nexus.resizeTerminal(term.cols, term.rows); } });
}
term && term.onResize(({cols,rows}) => window.nexus.resizeTerminal({cols,rows}));
$('restart-terminal').addEventListener('click', async () => {
  window.nexus.stopTerminal();
  if (term) { term.dispose(); term = null; fit = null; }
  $('terminal-root').innerHTML = '';
  await startTerminal();
});
async function refreshFiles() {
  const info = await window.nexus.systemInfo();
  $('file-path').textContent = info.cwd;
  const entries = await window.nexus.listFiles();
  const list = $('file-list'); list.innerHTML = '';
  if (!Array.isArray(entries)) { list.textContent = entries.error || 'Unable to read this folder.'; return; }
  if (!entries.length) { list.textContent = 'This folder is empty.'; return; }
  entries.forEach(item => {
    const button = document.createElement('button');
    button.className = 'file-item';
    const icon = document.createElement('span'); icon.textContent = item.directory ? '▣' : '▤';
    const name = document.createElement('span'); name.textContent = item.name;
    const type = document.createElement('small'); type.textContent = item.directory ? 'FOLDER' : 'FILE';
    button.append(icon,name,type);
    button.addEventListener('click', async () => {
      const result = await window.nexus.openItem(item.name);
      if (result) alert(result);
    });
    list.append(button);
  });
}
$('choose-folder').addEventListener('click', async () => {
  // Folder selection is performed through a native dialog in a later release.
  alert('To change the working folder for now, use the terminal command: cd "C:\\path\\to\\folder"');
});
loadSystem();
