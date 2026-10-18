/*
 * preload.js — мост между игрой и Electron.
 * Открывает странице только автообновление: скачать новый exe и перезапуститься.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vcUpdater', {
  install: (url, name) => ipcRenderer.invoke('vc:install', { url: String(url || ''), name: String(name || '') }),
  onProgress: (cb) => { if (typeof cb === 'function') ipcRenderer.on('vc:progress', (e, d) => cb(d || {})); },
  onError: (cb) => { if (typeof cb === 'function') ipcRenderer.on('vc:error', (e, m) => cb(String(m || ''))); }
});
