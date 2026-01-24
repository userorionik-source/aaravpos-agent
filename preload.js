const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printerAPI', {
  printFile: (filePath) => ipcRenderer.invoke('print:create', filePath),
  getQueue: () => ipcRenderer.invoke('print:list'),
  pausePrinter: () => ipcRenderer.invoke('print:pause'),
  resumePrinter: () => ipcRenderer.invoke('print:resume'),
  cancelJob: (jobId) => ipcRenderer.invoke('print:cancel', jobId),
  clearQueue: () => ipcRenderer.invoke('print:clear'),
  getPrinterState: () => ipcRenderer.invoke('print:state')
});
