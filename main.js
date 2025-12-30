const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const PrintServer = require('./print-server.js');
const TrayMenu = require('./tray-menu.js');

// Configuration
const config = {
    appName: 'AaravPOS Agent',
    appId: 'com.aaravpos.agent',
    port: 9978,
    autoStart: true,
    showStatusWindowOnStart: false
};

let mainWindow = null;
let tray = null;
let printServer = null;
let isQuitting = false;
let statusWindow = null;

// Get the correct resource path (works in both dev and production)
function getResourcePath(relativePath) {
    if (app.isPackaged) {
        // In production, resources are in the unpacked asar
        return path.join(process.resourcesPath, relativePath);
    } else {
        // In development
        return path.join(__dirname, relativePath);
    }
}

// Create logs directory
const logsDir = path.join(app.getPath('userData'), 'logs');
if (!fsSync.existsSync(logsDir)) {
    fsSync.mkdirSync(logsDir, { recursive: true });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    return;
}

app.setAppUserModelId(config.appId);

// Get platform-specific icon path with fallback
function getIconPath() {
    let iconName;
    
    if (process.platform === 'win32') {
        iconName = 'icon.ico';
    } else if (process.platform === 'darwin') {
        iconName = 'icon.icns';
    } else {
        iconName = 'icon.png';
    }
    
    const iconPath = getResourcePath(path.join('assets', iconName));
    
    // Check if icon exists, if not use PNG as fallback
    if (!fsSync.existsSync(iconPath)) {
        console.warn(`Icon not found at ${iconPath}, trying PNG fallback`);
        const pngPath = getResourcePath(path.join('assets', 'icon.png'));
        if (fsSync.existsSync(pngPath)) {
            return pngPath;
        }
        console.error('No icon files found in assets directory');
        return null;
    }
    
    return iconPath;
}

// Create main window (hidden)
async function createMainWindow() {
    const iconPath = getIconPath();
    
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: config.showStatusWindowOnStart,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: iconPath,
        title: config.appName
    });

    // Load status page
    const statusPagePath = path.join(__dirname, 'status.html');
    if (fsSync.existsSync(statusPagePath)) {
        await mainWindow.loadFile(statusPagePath);
    } else {
        const defaultStatusHtml = createDefaultStatusPage();
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(defaultStatusHtml)}`);
    }

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    setupIpcHandlers();
}

// Create system tray with proper icon handling
function createTray() {
    const iconPath = getIconPath();
    
    if (!iconPath) {
        console.error('Cannot create tray: no icon available');
        dialog.showErrorBox(
            'Icon Missing',
            'Tray icon files are missing. Please reinstall the application.'
        );
        return;
    }
    
    try {
        const icon = nativeImage.createFromPath(iconPath);
        
        if (icon.isEmpty()) {
            console.error('Icon is empty or invalid:', iconPath);
            return;
        }
        
        // Resize icon for tray (platform-specific sizes)
        let resizedIcon = icon;
        if (process.platform === 'win32') {
            resizedIcon = icon.resize({ width: 16, height: 16 });
        } else if (process.platform === 'darwin') {
            resizedIcon = icon.resize({ width: 22, height: 22 });
        } else {
            resizedIcon = icon.resize({ width: 22, height: 22 });
        }
        
        tray = new Tray(resizedIcon);
        tray.setToolTip(config.appName);
        
        // Initial menu
        updateTrayMenu();
        
        // Update tray menu every 5 seconds
        setInterval(updateTrayMenu, 5000);
        
        // Platform-specific click handlers
        if (process.platform === 'win32') {
            tray.on('double-click', () => {
                showStatusWindow();
            });
            tray.on('click', () => {
                tray.popUpContextMenu();
            });
        } else if (process.platform === 'darwin') {
            tray.on('click', () => {
                tray.popUpContextMenu();
            });
        } else {
            tray.on('click', () => {
                tray.popUpContextMenu();
            });
        }
        
        console.log('Tray icon created successfully');
    } catch (error) {
        console.error('Error creating tray icon:', error);
        dialog.showErrorBox(
            'Tray Icon Error',
            `Failed to create tray icon: ${error.message}`
        );
    }
}

// Update tray menu with current status
function updateTrayMenu() {
    if (!tray) return;

    const status = printServer ? printServer.getStatus() : {
        isRunning: false,
        port: config.port,
        connections: 0,
        logPath: path.join(logsDir, 'aaravpos-agent.log')
    };

    const menuTemplate = TrayMenu.createMenu(
        status,
        () => showLogs(),
        () => showStatusWindow(),
        () => restartServer(),
        () => {
            isQuitting = true;
            app.quit();
        }
    );

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    tray.setContextMenu(contextMenu);

    // Update tray icon status indicator (macOS)
    if (process.platform === 'darwin') {
        tray.setTitle(status.isRunning ? '●' : '○');
    }
}

// Show log file
async function showLogs() {
    if (!printServer) return;

    const logPath = printServer.logPath;
    try {
        await fs.access(logPath);
        const { shell } = require('electron');
        shell.openPath(logPath).catch(console.error);
    } catch (error) {
        const logContent = `${new Date().toISOString()} - Log file created\n`;
        await fs.writeFile(logPath, logContent, { flag: 'a' });
        const { shell } = require('electron');
        shell.openPath(logPath).catch(console.error);
    }
}

// Show status window
function showStatusWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    } else {
        createMainWindow().then(() => {
            mainWindow.show();
            mainWindow.focus();
        });
    }
}

// Restart print server
async function restartServer() {
    if (printServer) {
        try {
            await printServer.stop();
            printServer = null;
            updateTrayMenu();

            setTimeout(async () => {
                await startPrintServer();
                updateTrayMenu();
            }, 1000);
        } catch (error) {
            console.error('Error restarting server:', error);
        }
    } else {
        await startPrintServer();
    }
}

// Start print server
async function startPrintServer() {
    printServer = new PrintServer();

    try {
        await printServer.start();
        console.log('Print server started successfully');

        const startupLog = `${new Date().toISOString()} - ${config.appName} started on port ${config.port}\n`;
        const logPath = path.join(logsDir, 'aaravpos-agent.log');
        await fs.writeFile(logPath, startupLog, { flag: 'a' });

    } catch (error) {
        console.error('Failed to start print server:', error);

        if (mainWindow && mainWindow.isVisible()) {
            dialog.showErrorBox(
                'Server Error',
                `Failed to start print server on port ${config.port}.\n\nError: ${error.message}`
            );
        }

        setTimeout(startPrintServer, 10000);
    }
}

// Setup IPC handlers for status window
function setupIpcHandlers() {
    ipcMain.handle('get-status', async () => {
        if (!printServer) return { isRunning: false, error: 'Server not initialized' };
        return printServer.getStatus();
    });

    ipcMain.handle('get-printers', async () => {
        if (!printServer) return [];
        return await printServer.getPrinters();
    });

    ipcMain.handle('restart-server', async () => {
        await restartServer();
        return { success: true };
    });

    ipcMain.handle('get-logs', async () => {
        try {
            const logPath = printServer ? printServer.logPath : path.join(logsDir, 'aaravpos-agent.log');
            const logContent = await fs.readFile(logPath, 'utf-8');
            return logContent;
        } catch (error) {
            return 'No logs available';
        }
    });
    
    ipcMain.handle('hide-window', () => {
        if (mainWindow) {
            mainWindow.hide();
        }
    });
}

// Create default status page
function createDefaultStatusPage() {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${config.appName} Status</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            margin: 0;
        }
        .container { max-width: 800px; margin: 0 auto; }
        .status-card {
            background: white;
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            margin-top: 20px;
        }
        h1 { color: white; text-align: center; margin-top: 50px; font-size: 2.5em; }
        .status-header { display: flex; align-items: center; margin-bottom: 30px; }
        .status-indicator {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 15px;
        }
        .status-indicator.running { background: #4CAF50; animation: pulse 2s infinite; }
        .status-indicator.stopped { background: #f44336; }
        .status-item {
            margin: 15px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        .status-label { font-weight: 600; color: #555; display: inline-block; width: 140px; }
        .status-value { color: #222; }
        .button-group { display: flex; gap: 10px; margin-top: 20px; }
        button {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            background: #667eea;
            color: white;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            flex: 1;
        }
        button:hover { background: #764ba2; transform: translateY(-2px); }
        button:disabled { background: #ccc; cursor: not-allowed; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    </style>
</head>
<body>
    <div class="container">
        <h1>${config.appName}</h1>
        <div class="status-card">
            <div class="status-header">
                <div class="status-indicator" id="statusIndicator"></div>
                <h2 style="margin: 0;">Agent Status</h2>
            </div>
            <div class="status-item">
                <span class="status-label">WebSocket Server:</span>
                <span class="status-value" id="wsStatus">Checking...</span>
            </div>
            <div class="status-item">
                <span class="status-label">Port:</span>
                <span class="status-value" id="portValue">${config.port}</span>
            </div>
            <div class="status-item">
                <span class="status-label">Connections:</span>
                <span class="status-value" id="connectionsValue">0</span>
            </div>
            <div class="button-group">
                <button onclick="refreshStatus()">🔄 Refresh</button>
                <button onclick="restartServer()">🔁 Restart</button>
                <button onclick="hideWindow()">👇 Hide</button>
            </div>
        </div>
    </div>
    <script>
        async function refreshStatus() {
            try {
                const status = await window.electron.getStatus();
                updateStatusUI(status);
            } catch (error) {
                console.error('Error refreshing status:', error);
            }
        }
        async function restartServer() {
            const button = event.target;
            button.disabled = true;
            button.textContent = 'Restarting...';
            try {
                await window.electron.restartServer();
                setTimeout(refreshStatus, 2000);
            } catch (error) {
                console.error('Error restarting:', error);
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = '🔁 Restart';
                }, 3000);
            }
        }
        function hideWindow() {
            window.electron.hideWindow();
        }
        function updateStatusUI(status) {
            const indicator = document.getElementById('statusIndicator');
            const wsStatus = document.getElementById('wsStatus');
            const connections = document.getElementById('connectionsValue');
            if (status.isRunning) {
                indicator.className = 'status-indicator running';
                wsStatus.textContent = 'Running 🟢';
                wsStatus.style.color = '#4CAF50';
            } else {
                indicator.className = 'status-indicator stopped';
                wsStatus.textContent = 'Stopped 🔴';
                wsStatus.style.color = '#f44336';
            }
            connections.textContent = status.connections || 0;
        }
        refreshStatus();
        setInterval(refreshStatus, 3000);
    </script>
</body>
</html>`;
}

// App lifecycle
app.whenReady().then(async () => {
    await createMainWindow();
    createTray();
    await startPrintServer();

    if (config.autoStart) {
        app.setLoginItemSettings({
            openAtLogin: true,
            path: app.getPath('exe')
        });
    }
});

app.on('second-instance', () => {
    showStatusWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('before-quit', async () => {
    isQuitting = true;
    if (printServer) {
        await printServer.stop();
    }
});

app.on('window-all-closed', (event) => {
    if (process.platform !== 'darwin') {
        event.preventDefault();
    }
});