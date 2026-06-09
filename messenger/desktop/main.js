'use strict';

// Gram для macOS: окно Electron поверх веб-клиента.
// Адрес сервера хранится в userData/config.json и меняется через меню.

const { app, BrowserWindow, Menu, ipcMain, Notification, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_SERVER = process.env.GRAM_SERVER || 'http://localhost:3000';
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return { serverUrl: DEFAULT_SERVER };
  }
}

function saveConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

let mainWindow = null;

function createMainWindow() {
  const config = loadConfig();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Gram',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(config.serverUrl).catch(() => showConnectionError(config.serverUrl));
  mainWindow.webContents.on('did-fail-load', () => showConnectionError(config.serverUrl));

  // Внешние ссылки — в браузер по умолчанию
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function showConnectionError(serverUrl) {
  if (!mainWindow) return;
  const html = `
    <html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, sans-serif; display: flex; align-items: center;
             justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; }
      .card { text-align: center; max-width: 420px; }
      h2 { margin-bottom: 8px; } p { color: #707579; }
      code { background: #e4e4e6; padding: 2px 6px; border-radius: 6px; }
    </style></head><body><div class="card">
      <h2>Сервер недоступен</h2>
      <p>Не удалось подключиться к <code>${serverUrl}</code>.</p>
      <p>Запустите сервер или укажите другой адрес:<br>меню <b>Gram → Адрес сервера…</b></p>
    </div></body></html>`;
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function openServerSettings() {
  const win = new BrowserWindow({
    width: 420,
    height: 200,
    resizable: false,
    title: 'Адрес сервера',
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'settings.html'));
}

ipcMain.handle('gram:get-server', () => loadConfig().serverUrl);

ipcMain.handle('gram:set-server', (event, url) => {
  try {
    const parsed = new URL(String(url));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    return { ok: false, error: 'Введите корректный адрес, например http://192.168.1.10:3000' };
  }
  saveConfig({ ...loadConfig(), serverUrl: String(url).replace(/\/$/, '') });
  if (mainWindow) mainWindow.loadURL(loadConfig().serverUrl);
  BrowserWindow.fromWebContents(event.sender)?.close();
  return { ok: true };
});

// Бейдж непрочитанных в доке macOS (клиент шлёт количество через preload)
ipcMain.on('gram:set-badge', (event, count) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count > 0 ? String(count) : '');
  }
});

function buildMenu() {
  const template = [
    {
      label: 'Gram',
      submenu: [
        { role: 'about', label: 'О программе Gram' },
        { type: 'separator' },
        { label: 'Адрес сервера…', accelerator: 'Cmd+,', click: openServerSettings },
        { type: 'separator' },
        { role: 'hide', label: 'Скрыть Gram' },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'quit', label: 'Завершить Gram' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Скопировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выбрать всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'togglefullscreen', label: 'Полноэкранный режим' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Изменить размер' },
        { role: 'close', label: 'Закрыть окно' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // На macOS приложение остаётся в доке после закрытия окна
  if (process.platform !== 'darwin') app.quit();
});
