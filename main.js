const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = require('electron-is-dev');

ipcMain.handle('get-paths', () => {
    return {
        isDev: isDev,
        resourcesPath: process.resourcesPath,
        dirname: String(__dirname)
    };
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('save-image', async (event, base64Data) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Save Image',
    defaultPath: `film_look.png`,
    filters: [{ name: 'Images', extensions: ['png'] }],
  });

  if (filePath) {
    const data = base64Data.replace(/^data:image\/png;base64,/, '');
    fs.writeFile(filePath, data, 'base64', (err) => {
      if (err) {
        console.error('Failed to save image:', err);
        return { success: false, error: err.message };
      }
      console.log('Image saved successfully:', filePath);
      return { success: true, filePath };
    });
  }
  return { success: false, error: 'Save dialog cancelled' };
});

ipcMain.handle('batch-process', async (event, files, settings) => {
    // This is a placeholder for the batch processing logic
    // In a real implementation, we would process each file here
    console.log('Batch processing request received for:', files);
    console.log('With settings:', settings);
    // Simulate processing
    for (const file of files) {
        const newPath = file.replace(/(\.[\w\d_-]+)$/i, '_film$1');
        console.log(`Simulating processing for ${file} -> ${newPath}`);
    }
    return { success: true, message: 'Batch processing simulated.' };
});
