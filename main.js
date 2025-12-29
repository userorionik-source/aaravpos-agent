// main.js - UPDATED WITH FULL OPTIONAL FILE INTEGRATION
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const PrintServer = require('./print-server.js');
const TrayMenu = require('./tray-menu.js'); // Using the tray-menu module

// Configuration
const config = {
    appName: 'AaravPOS Agent',
    appId: 'com.aaravpos.agent',
    port: 9988,
    autoStart: true,
    showStatusWindowOnStart: false
};

let mainWindow = null;
let tray = null;
let printServer = null;
let isQuitting = false;
let statusWindow = null;

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

// Create main window (hidden)
async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: config.showStatusWindowOnStart,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: getIconPath(),
        title: config.appName
    });

    // Load status page if it exists, otherwise create default
    const statusPagePath = path.join(__dirname, 'status.html');
    if (fsSync.existsSync(statusPagePath)) {
        await mainWindow.loadFile(statusPagePath);
    } else {
        // Create default status page
        const defaultStatusHtml = createDefaultStatusPage();
        mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(defaultStatusHtml)}`);
    }

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // IPC handlers for status window communication
    setupIpcHandlers();
}

// Create system tray with menu
function createTray() {
    const icon = nativeImage.createFromPath(getIconPath());
    tray = new Tray(icon);

    // Initial menu
    updateTrayMenu();

    // Update tray menu every 5 seconds
    setInterval(updateTrayMenu, 5000);

    // Double click on tray shows status window (Windows)
    if (process.platform === 'win32') {
        tray.on('double-click', () => {
            showStatusWindow();
        });
    }

    // Single click shows menu (macOS/Linux)
    if (process.platform === 'darwin' || process.platform === 'linux') {
        tray.on('click', () => {
            tray.popUpContextMenu();
        });
    }

    tray.setToolTip(config.appName);
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

    // Update tray icon based on status
    updateTrayIcon(status.isRunning);
}

// Update tray icon color based on status
function updateTrayIcon(isRunning) {
    try {
        const iconPath = getIconPath();
        const icon = nativeImage.createFromPath(iconPath);

        // On Windows/macOS, we can add a badge or change icon
        if (process.platform === 'darwin') {
            // macOS: Update tooltip with status
            tray.setTitle(isRunning ? '●' : '○');
        }

        tray.setImage(icon);
    } catch (error) {
        console.error('Error updating tray icon:', error);
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
        // Create a new log file if it doesn't exist
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

        // Write startup log
        const startupLog = `${new Date().toISOString()} - ${config.appName} started on port ${config.port}\n`;
        const logPath = path.join(logsDir, 'aaravpos-agent.log');
        await fs.writeFile(logPath, startupLog, { flag: 'a' });

    } catch (error) {
        console.error('Failed to start print server:', error);

        // Show error dialog
        if (mainWindow && mainWindow.isVisible()) {
            dialog.showErrorBox(
                'Server Error',
                `Failed to start print server on port ${config.port}.\n\nError: ${error.message}`
            );
        }

        // Try again after 10 seconds
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
}

// Get platform-specific icon path
function getIconPath() {
    const iconDir = path.join(__dirname, 'assets');

    if (process.platform === 'win32') {
        return path.join(iconDir, 'icon.ico');
    } else if (process.platform === 'darwin') {
        return path.join(iconDir, 'icon.icns');
    } else {
        return path.join(iconDir, 'icon.png');
    }
}

// Create default status page if status.html doesn't exist
function createDefaultStatusPage() {
    return `
<!DOCTYPE html>
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
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        .status-card {
            background: white;
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            margin-top: 20px;
        }
        h1 {
            color: white;
            text-align: center;
            margin-top: 50px;
            font-size: 2.5em;
        }
        .status-header {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
        }
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
        .status-label {
            font-weight: 600;
            color: #555;
            display: inline-block;
            width: 140px;
        }
        .status-value {
            color: #222;
        }
        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
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
        button:hover {
            background: #764ba2;
            transform: translateY(-2px);
        }
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .log-display {
            background: #1a1a1a;
            color: #00ff00;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            height: 200px;
            overflow-y: auto;
            margin-top: 20px;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
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
            
            <div class="status-item">
                <span class="status-label">Token:</span>
                <span class="status-value">supersecret</span>
            </div>
            
            <div class="button-group">
                <button onclick="refreshStatus()">🔄 Refresh</button>
                <button onclick="restartServer()">🔄 Restart</button>
                <button onclick="viewLogs()">📋 View Logs</button>
                <button onclick="hideWindow()">👇 Hide</button>
            </div>
            
            <div id="logDisplay" class="log-display" style="display: none;">
                <div id="logContent"></div>
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
                const result = await window.electron.restartServer();
                if (result.success) {
                    setTimeout(refreshStatus, 2000);
                }
            } catch (error) {
                console.error('Error restarting:', error);
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = '🔄 Restart';
                }, 3000);
            }
        }

        async function viewLogs() {
            const logDisplay = document.getElementById('logDisplay');
            const logContent = document.getElementById('logContent');
            
            if (logDisplay.style.display === 'none') {
                try {
                    const logs = await window.electron.getLogs();
                    logContent.textContent = logs;
                    logDisplay.style.display = 'block';
                    logDisplay.scrollTop = logDisplay.scrollHeight;
                } catch (error) {
                    logContent.textContent = 'Error loading logs';
                    logDisplay.style.display = 'block';
                }
            } else {
                logDisplay.style.display = 'none';
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

        // Initial load and auto-refresh every 3 seconds
        refreshStatus();
        setInterval(refreshStatus, 3000);
    </script>
</body>
</html>
  `;
}

// App lifecycle
app.whenReady().then(async () => {
    await createMainWindow();
    createTray();
    await startPrintServer();

    // Auto-start on login
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

// Prevent app from quitting when window is closed
app.on('window-all-closed', (event) => {
    if (process.platform !== 'darwin') {
        event.preventDefault();
    }
});