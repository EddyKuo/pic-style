const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Determine development mode using Electron's built-in flag.
// app.isPackaged === true when running as a packaged app; invert to get isDev.
const isDev = !app.isPackaged;

ipcMain.handle('get-paths', () => {
  // Return only JSON-serializable primitives to avoid "object could not be cloned" errors
  return {
    isDev: !!isDev,
    resourcesPath: String(process.resourcesPath || ''),
    dirname: String(__dirname || '')
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

  // Open the DevTools for debugging (temporarily enabled for troubleshooting)
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
    title: '儲存圖片',
    defaultPath: `底片效果.png`,
    filters: [{ name: '圖片檔案', extensions: ['png'] }],
  });

  if (!filePath) {
    return { success: false, error: '取消儲存' };
  }

  try {
    const data = base64Data.replace(/^data:image\/png;base64,/, '');
    await fs.promises.writeFile(filePath, data, 'base64');
    console.log('圖片儲存成功:', filePath);
    return { success: true, filePath };
  } catch (err) {
    console.error('圖片儲存失敗:', err);
    return { success: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('batch-process', async (event, files, settings) => {
  // Sanitize inputs: ensure files is an array of strings and settings is a plain object
  const safeFiles = Array.isArray(files) ? files.map(f => String(f)) : [];
  const safeSettings = settings && typeof settings === 'object' ? JSON.parse(JSON.stringify(settings)) : {};

  console.log('收到批次處理請求:', safeFiles);
  console.log('設定參數:', safeSettings);

  // Simulate processing and return a serializable summary
  const processed = safeFiles.map(file => {
    const newPath = file.replace(/(\.[\w\d_-]+)$/i, '_底片$1');
    return { input: file, output: newPath };
  });

  return { success: true, message: '批次處理模擬完成', processed };
});

// Read a resource (text) from inside the app. Works both in dev and when packaged (inside app.asar).
ipcMain.handle('read-resource', async (event, relativePath) => {
    try {
    // app.getAppPath() will point to the project folder in dev, and to the app.asar path when packaged.
    let requested = String(relativePath || '');

    // Normalize slashes for matching
    const reqNormalized = requested.replace(/\\/g, '/');
    const resourcesDir = String(process.resourcesPath || '').replace(/\\/g, '/');

    // If the incoming path contains '/resources/', strip everything up to and including that segment
    const resIdx = reqNormalized.toLowerCase().indexOf('/resources/');
    if (resIdx !== -1) {
      requested = reqNormalized.slice(resIdx + '/resources/'.length).replace(/^\/+/, '');
    } else if (resourcesDir && reqNormalized.toLowerCase().startsWith(resourcesDir.toLowerCase())) {
      // If it starts with the full resourcesDir, strip that prefix
      requested = reqNormalized.slice(resourcesDir.length).replace(/^\/+/, '');
    } else if (path.isAbsolute(reqNormalized)) {
      // If an absolute path was provided, drop drive letter and leading slash
      requested = reqNormalized.replace(/^([A-Za-z]:)?\//, '');
    } else {
      // otherwise leave requested as-is
      requested = reqNormalized.replace(/^\/+/, '');
    }

    // Now join with app path (works when app.getAppPath() points into app.asar)
    const fullPath = path.join(app.getAppPath(), requested);
    console.log('read-resource resolved:', { requested, fullPath });
    const content = await fs.promises.readFile(fullPath, 'utf8');
    return content;
  } catch (err) {
    console.error('read-resource failed for', relativePath, err);
    throw err;
  }
});

// Read a file from extraResources. Works when packaged (outside app.asar).
ipcMain.handle('read-extra-resource', async (event, relativePath) => {
  try {
    let requested = String(relativePath || '');
    
    // In development, use project directory
    if (isDev) {
      const fullPath = path.join(__dirname, requested);
      console.log('read-extra-resource (dev) resolved:', { requested, fullPath });
      const content = await fs.promises.readFile(fullPath, 'utf8');
      return content;
    }
    
    // In production, extraResources are in the resources folder
    const fullPath = path.join(process.resourcesPath, requested);
    console.log('read-extra-resource (prod) resolved:', { requested, fullPath });
    const content = await fs.promises.readFile(fullPath, 'utf8');
    return content;
  } catch (err) {
    console.error('read-extra-resource failed for', relativePath, err);
    throw err;
  }
});
