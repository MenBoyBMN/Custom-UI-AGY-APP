const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioAPI', {
  init: () => ipcRenderer.invoke('studio:init'),
  rescan: (customPath) => ipcRenderer.invoke('studio:rescan', customPath),
  selectAgyFolder: () => ipcRenderer.invoke('studio:select-agy-folder'),
  pickMedia: (kind) => ipcRenderer.invoke('studio:pick-media', kind),
  readMedia: (assetRef) => ipcRenderer.invoke('studio:read-media', assetRef),
  saveDraft: (config) => ipcRenderer.invoke('studio:save-draft', config),
  applyToAgy: (payload) => ipcRenderer.invoke('studio:apply-to-agy', payload),
  restoreAgy: (payload) => ipcRenderer.invoke('studio:restore-agy', payload),
  launchAgy: (agyRootPath) => ipcRenderer.invoke('studio:launch-agy', agyRootPath),
  openFolder: (folderPath) => ipcRenderer.invoke('studio:open-folder', folderPath),
  exportConfig: (config) => ipcRenderer.invoke('studio:export-config', config),
  importConfig: () => ipcRenderer.invoke('studio:import-config')
});
