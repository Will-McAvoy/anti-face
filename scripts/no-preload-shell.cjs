// Opens the production page without preload so panels must show the desktop-only empty state.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.loadFile(path.join(__dirname, '../dist/index.html'));
});
