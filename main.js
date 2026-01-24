const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const PrinterAgent = require('./printerAgent.js');

let mainWindow;
let printerAgent;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  
  printerAgent = new PrinterAgent(mainWindow);
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

// IPC Handlers
ipcMain.handle('print:create', async (event, filePath) => {
  return await printerAgent.printFile(filePath);
});

ipcMain.handle('print:list', async () => {
  return await printerAgent.getQueue();
});

ipcMain.handle('print:pause', async () => {
  return await printerAgent.pauseQueue();
});

ipcMain.handle('print:resume', async () => {
  return await printerAgent.resumeQueue();
});

ipcMain.handle('print:cancel', async (event, jobId) => {
  return await printerAgent.cancelJob(jobId);
});

ipcMain.handle('print:clear', async () => {
  return await printerAgent.clearQueue();
});

ipcMain.handle('print:state', async () => {
  return await printerAgent.getPrinterState();
});
