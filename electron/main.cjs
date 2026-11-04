const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;

// Test if the local Vite dev server is running
function checkDevServer(url) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = http.get(
        {
          hostname: parsed.hostname,
          port: parsed.port || 3000,
          path: '/',
          timeout: 1000,
        },
        (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 400);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 880,
    minWidth: 960,
    minHeight: 650,
    title: 'Military Flight Desk for MSFS',
    backgroundColor: '#0f172a',
    show: true,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allows fetch to read local JSON files (airports.json, runways.json) under file://
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
  });

  // Open external links in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hotkey F12 or Ctrl+Shift+I to toggle DevTools if needed
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Log any load failure to console for quick diagnostics
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
  });

  // Smart URL loader:
  // 1. If DEV_SERVER_URL is explicitly set, use it.
  // 2. Otherwise check if localhost:3000 (Vite) is running.
  // 3. Otherwise fall back to local dist/index.html.
  const targetDevUrl = process.env.DEV_SERVER_URL || 'http://localhost:3000';
  const distPath = path.join(__dirname, '../dist/index.html');

  // Security: a packaged app must never load whatever happens to listen on localhost:3000,
  // because this window exposes file-saving IPC. The dev server is only used when running unpackaged.
  const devServerCheck = app.isPackaged ? Promise.resolve(false) : checkDevServer(targetDevUrl);

  devServerCheck.then((isDevServerLive) => {
    if (!mainWindow) return;

    if (isDevServerLive) {
      console.log(`[Electron] Connected to live Vite dev server at ${targetDevUrl}`);
      mainWindow.loadURL(targetDevUrl);
    } else if (fs.existsSync(distPath)) {
      console.log(`[Electron] Loading production build from ${distPath}`);
      mainWindow.loadFile(distPath);
    } else if (!app.isPackaged) {
      console.warn(`[Electron] Dev server offline and dist/index.html not found. Loading ${targetDevUrl}...`);
      mainWindow.loadURL(targetDevUrl);
    } else {
      console.error(`[Electron] Production build not found at ${distPath}`);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==================== IPC HANDLERS ====================

// Native OS Save File Dialog Window Popup
ipcMain.handle('sim:save-file-dialog', async (event, { defaultFilename, content, extension, filterName }) => {
  if (!mainWindow) return { canceled: true };

  const ext = extension || 'pln';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Save Flight Plan (${ext.toUpperCase()})`,
    defaultPath: defaultFilename,
    filters: [
      { name: filterName || 'Flight Plan File', extensions: [ext] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return {
      success: true,
      filePath: result.filePath,
      filename: path.basename(result.filePath),
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
});

// Native OS Save PDF Dialog Window Popup
ipcMain.handle('sim:save-pdf-dialog', async (event, { defaultFilename, pdfBase64 }) => {
  if (!mainWindow) return { canceled: true };

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Kneeboard PDF',
    defaultPath: defaultFilename,
    filters: [
      { name: 'PDF Documents', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  try {
    const buffer = Buffer.from(pdfBase64, 'base64');
    fs.writeFileSync(result.filePath, buffer);
    return {
      success: true,
      filePath: result.filePath,
      filename: path.basename(result.filePath),
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
});

// Reveal file in File Explorer / Finder
ipcMain.handle('sim:show-item', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: 'File not found' };
});

// ==================== AUTO UPDATE ====================

// Checks GitHub Releases for a newer version, downloads it in the background and asks before installing.
// Only the installed (NSIS) app can update itself: the portable .exe and unpackaged runs are skipped.
// Every failure (no internet, no release yet, missing module) is ignored so the app always starts normally.
function setupAutoUpdate() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('Auto-update unavailable:', err && err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // never install without asking
  autoUpdater.logger = null;

  let asked = false;
  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err && err.message);
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (asked) return;
    asked = true;
    dialog
      .showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
        type: 'info',
        title: 'Update ready',
        message: `Military Flight Desk ${info.version} is ready to install.`,
        detail: 'Restart now to finish the update, or choose Later and you will be asked again next time you start the app.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      })
      .catch(() => {});
  });

  // Wait a few seconds so the check never slows down start-up.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// ==================== APP LIFECYCLE ====================

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
