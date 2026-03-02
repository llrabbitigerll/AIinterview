import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes safe APIs to the renderer process.
 * contextIsolation: true ensures renderer cannot access Node.js directly.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Database
  dbQuery: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:query', sql, params),
  dbRun: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db:run', sql, params),

  // Platform info
  platform: process.platform,
  appVersion: process.env.npm_package_version ?? '0.1.0',
});
