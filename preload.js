const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('electron', {
    // Get server status
    getStatus: () => ipcRenderer.invoke('get-status'),
    
    // Get list of printers
    getPrinters: () => ipcRenderer.invoke('get-printers'),
    
    // Restart the print server
    restartServer: () => ipcRenderer.invoke('restart-server'),
    
    // Get log content
    getLogs: () => ipcRenderer.invoke('get-logs'),
    
    // Hide the window
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    
    // Platform info
    platform: process.platform,
    
    // Version info
    version: require('./package.json').version
});

// Also keep the original aaravpos namespace for compatibility
contextBridge.exposeInMainWorld('aaravpos', {
    platform: process.platform,
    version: require('./package.json').version
});