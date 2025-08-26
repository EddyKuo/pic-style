const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveImage: (base64Data) => ipcRenderer.invoke('save-image', base64Data),
  batchProcess: (files, settings) => ipcRenderer.invoke('batch-process', files, settings),
});
