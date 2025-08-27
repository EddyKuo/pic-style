const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // General IPC invoke method
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  
  // Specific methods for better organization
  getPaths: () => ipcRenderer.invoke('get-paths'),
  readResource: (path) => ipcRenderer.invoke('read-resource', path),
  readExtraResource: (path) => ipcRenderer.invoke('read-extra-resource', path),
  saveImage: (base64Data) => ipcRenderer.invoke('save-image', base64Data),
  batchProcess: (files, settings) => ipcRenderer.invoke('batch-process', files, settings)
});