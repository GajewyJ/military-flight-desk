const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

// The packaged app is served from its own app:// origin instead of file://, so web security can stay on.
const APP_ORIGIN = 'app://app';
const DIST_ROOT = path.join(__dirname, '../dist');

// Only the services the app really calls (see README, "Online services").
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://server.arcgisonline.com https://*.tile.opentopomap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://metar.vatsim.net https://data.vatsim.net https://datis.clowd.io https://api.open-meteo.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

protocol.registerSchemeAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

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
      webSecurity: true,
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
      mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
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

// Only our own pages may use the file-saving IPC (the app:// pages, or the Vite dev server when unpackaged).
function isTrustedSender(event) {
  const url = event.senderFrame && event.senderFrame.url;
  if (!url) return false;
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  if (app.isPackaged) return false;
  const devOrigin = new URL(process.env.DEV_SERVER_URL || 'http://localhost:3000').origin;
  return url.startsWith(`${devOrigin}/`);
}

// Native OS Save File Dialog Window Popup
ipcMain.handle('sim:save-file-dialog', async (event, { defaultFilename, content, extension, filterName }) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
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
  if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
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
  if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
  return { success: false, error: 'File not found' };
});

// ==================== APP LIFECYCLE ====================

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = path.normalize(path.join(DIST_ROOT, relative));
    // Never serve anything outside dist/ (blocks ../ tricks).
    if (filePath !== DIST_ROOT && !filePath.startsWith(DIST_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
