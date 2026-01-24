const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printer', {
    printBarcode: (printerName, barcode) =>
        ipcRenderer.invoke('print-barcode', { printerName, barcode })
});
