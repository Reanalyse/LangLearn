const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // invoke (request/response)
  openLocalFile: () => ipcRenderer.invoke('open-local-file'),
  loadYoutube: (url) => ipcRenderer.invoke('load-youtube', { url }),
  cancelProcessing: () => ipcRenderer.invoke('cancel-processing'),
  deleteCacheEntries: (keys) => ipcRenderer.invoke('delete-cache-entries', { keys }),
  getCacheIndex: () => ipcRenderer.invoke('get-cache-index'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  changeCacheDir: () => ipcRenderer.invoke('change-cache-dir'),
  changeModel: (model) => ipcRenderer.invoke('change-model', { model }),
  loadCached: (key) => ipcRenderer.invoke('load-cached', { key }),
  loadLocalPath: (absPath) => ipcRenderer.invoke('load-local-path', { absPath }),

  // push events (main → renderer)
  onProgress: (cb) => ipcRenderer.on('processing-progress', (_, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('processing-done', (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('processing-error', (_, data) => cb(data)),
  onCacheIndex: (cb) => ipcRenderer.on('cache-index', (_, data) => cb(data)),

  // cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
})
