'use strict';

// OpenLoomiPet — Electron 主进程。
// 透明置顶小窗（桌宠）+ 托盘 + 两个后台模块：
//   watcher（盯 OpenLoomi 真实活动）→ pet:state
//   brain（DeepSeek 生成台词）      → pet:bubble

const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');

try { app.setName('openloomipet'); } catch {}
try { app.setAppUserModelId('com.openloomi.pet'); } catch {}

const config = require('./backend/config');
const { log, LOG_PATH } = require('./backend/log');
const { createWatcher } = require('./backend/watcher');
const { createBrain } = require('./backend/brain');

const WIN_W = 240;
const WIN_H = 280;

let petWin = null;
let tray = null;
let watcher = null;
let brain = null;
let lastState = null;

function send(channel, payload) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
}

function frontendConfig() {
  const c = config.get();
  return { muted: !!c.muted };
}

function createPetWindow() {
  const saved = config.get().petPosition;
  let x, y;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { x = saved.x; y = saved.y; }
  else {
    try {
      const wa = screen.getPrimaryDisplay().workArea;
      x = wa.x + wa.width - WIN_W - 24;
      y = wa.y + wa.height - WIN_H - 24;
    } catch {}
  }

  petWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x, y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  petWin.setAlwaysOnTop(true, 'floating');
  try { petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  petWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  petWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));

  petWin.on('moved', () => {
    if (!petWin) return;
    const b = petWin.getBounds();
    config.save({ petPosition: { x: b.x, y: b.y } });
  });
  petWin.webContents.on('did-finish-load', () => {
    send('pet:config', frontendConfig());
    if (lastState) send('pet:state', lastState);
  });
}

function launchOpenLoomi() {
  const { spawn } = require('child_process');
  const open = (bin, args) => new Promise((resolve) => {
    try {
      const c = spawn(bin, args, { detached: true, stdio: 'ignore' });
      c.on('error', () => resolve(false));
      c.on('spawn', () => { c.unref(); resolve(true); });
    } catch { resolve(false); }
  });
  (async () => {
    if (process.platform === 'darwin' && (await open('open', ['-a', 'openloomi']))) return;
    if (process.platform === 'win32' && (await open('cmd.exe', ['/c', 'start', '', 'openloomi://']))) return;
    if (process.platform === 'linux' && (await open('openloomi', []))) return;
    await open(process.platform === 'darwin' ? 'open' : 'xdg-open', ['https://openloomi.ai']);
  })().catch(() => {});
}

function registerIpc() {
  ipcMain.handle('get-config', () => frontendConfig());
  ipcMain.handle('get-win-pos', () => {
    if (!petWin || petWin.isDestroyed()) return [0, 0];
    const b = petWin.getBounds();
    return [b.x, b.y];
  });
  ipcMain.on('set-win-pos', (_e, x, y) => {
    if (petWin && !petWin.isDestroyed() && Number.isFinite(x) && Number.isFinite(y)) {
      const b = petWin.getBounds();
      petWin.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
    }
  });
  ipcMain.on('set-ignore-mouse', (_e, ignore) => {
    if (petWin && !petWin.isDestroyed()) {
      try { petWin.setIgnoreMouseEvents(!!ignore, { forward: true }); } catch {}
    }
  });
  ipcMain.on('launch-openloomi', launchOpenLoomi);
  ipcMain.on('toggle-mute', () => {
    config.save({ muted: !config.get().muted });
    send('pet:config', frontendConfig());
    refreshTrayMenu();
  });
  ipcMain.on('open-log', () => shell.openPath(LOG_PATH));
  ipcMain.on('quit-app', () => app.quit());
  ipcMain.on('pet-log', (_e, tag, msg) => log('ui:' + tag, msg));
}

function bootBackend() {
  brain = createBrain((text) => {
    if (!config.get().muted) send('pet:bubble', { text, ts: Date.now() });
  });
  watcher = createWatcher({
    onState: (s) => { lastState = s; send('pet:state', s); },
    onMoment: (m) => brain.say(m),
  });
  watcher.start();
}

function buildTray() {
  let img;
  try {
    img = nativeImage
      .createFromPath(path.join(__dirname, 'assets', 'loomi', 'loomi-idle.png'))
      .resize({ width: 18, height: 18 });
  } catch {}
  tray = new Tray(img || nativeImage.createEmpty());
  tray.setToolTip('OpenLoomiPet — OpenLoomi 桌宠');
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const muted = config.get().muted;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🐾 显示桌宠', click: () => petWin && petWin.show() },
    { label: '🚀 唤起 OpenLoomi', click: launchOpenLoomi },
    { type: 'separator' },
    { label: muted ? '🔔 打开台词气泡' : '🔇 关闭台词气泡', click: () => {
      config.save({ muted: !muted });
      send('pet:config', frontendConfig());
      refreshTrayMenu();
    } },
    { label: '📄 打开日志', click: () => shell.openPath(LOG_PATH) },
    { type: 'separator' },
    { label: '⏻ 退出', click: () => app.quit() },
  ]));
}

// pid 文件：OpenLoomi 客户端（apps/web 的 pet launcher）靠它检测在跑/停止。
const PID_PATH = path.join(require('os').homedir(), '.openloomipet', 'pet.pid');
function writePidFile() {
  try {
    require('fs').mkdirSync(path.dirname(PID_PATH), { recursive: true });
    require('fs').writeFileSync(PID_PATH, String(process.pid), 'utf8');
  } catch {}
}
function removePidFile() {
  try {
    const cur = require('fs').readFileSync(PID_PATH, 'utf8').trim();
    if (cur === String(process.pid)) require('fs').unlinkSync(PID_PATH);
  } catch {}
}

// 单实例：客户端自动拉起 + 用户手动启动不叠加两只
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    writePidFile();
    registerIpc();
    bootBackend();
    createPetWindow();
    try { buildTray(); } catch (e) { log('main', 'tray unavailable:', e.message); }
    log('main', 'OpenLoomiPet ready');
  });
}

app.on('window-all-closed', () => { /* 托盘应用：保持存活 */ });

// launcher 用 SIGTERM 停桌宠 → 走正常退出流程
process.on('SIGTERM', () => app.quit());

app.on('before-quit', () => {
  try { if (watcher) watcher.stop(); } catch {}
  removePidFile();
  log('main', 'OpenLoomiPet quit');
});
