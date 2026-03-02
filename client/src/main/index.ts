import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'AI模拟面试',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for better-sqlite3
    },
  });

  // Grant microphone permission for the renderer (required when loading from http://localhost)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });

  // CSP: allow WASM (for VAD/ONNX), WebSocket connections, and blob: for audio.
  // 'unsafe-inline' is required for Vite's React Fast Refresh preamble.
  // Use app.isPackaged (Electron-canonical) to distinguish dev vs production —
  // this is bullet-proof unlike relying on NODE_ENV which cross-env may not
  // propagate into the Electron child process in all PowerShell environments.
  const isDev = !app.isPackaged;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"
      : "'self' 'wasm-unsafe-eval' blob:";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; ` +
          `script-src ${scriptSrc}; ` +
          `connect-src 'self' ws://localhost:* wss://*.xfyun.cn wss://*.microsoft.com wss://*.azure.com http://localhost:*; ` +
          `style-src 'self' 'unsafe-inline'; ` +
          `img-src 'self' data: blob:; ` +
          `worker-src 'self' blob:; ` +
          `media-src 'self' blob:;`
        ],
      },
    });
  });

  // In development, load from Vite dev server
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers ──────────────────────────────────────────────
// Database operations will be exposed via IPC
ipcMain.handle('db:query', async (_event, sql: string, params?: unknown[]) => {
  // Will be wired to better-sqlite3 in the database module
  const { query } = await import('./database');
  return query(sql, params);
});

ipcMain.handle('db:run', async (_event, sql: string, params?: unknown[]) => {
  const { run } = await import('./database');
  return run(sql, params);
});
