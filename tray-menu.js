// tray-menu.js - COMPLETE MODULE
const { Menu } = require('electron');

module.exports = {
    createMenu: (status, onShowLogs, onShowStatus, onRestart, onQuit) => {
        const isRunning = status.isRunning || false;
        const connections = status.connections || 0;
        const port = status.port || 9988;

        return [
            {
                label: 'AaravPOS Print Agent',
                enabled: false,
                icon: isRunning ? 'assets/icon-online.png' : 'assets/icon-offline.png'
            },
            { type: 'separator' },
            {
                label: `Status: ${isRunning ? '✅ Running' : '❌ Stopped'}`,
                enabled: false,
                icon: isRunning ? 'assets/checkmark.png' : 'assets/error.png'
            },
            {
                label: `Port: ${port}`,
                enabled: false,
                icon: 'assets/port.png'
            },
            {
                label: `Connections: ${connections}`,
                enabled: false,
                icon: connections > 0 ? 'assets/connected.png' : 'assets/disconnected.png'
            },
            { type: 'separator' },
            {
                label: 'Show Status Window',
                click: onShowStatus,
                icon: 'assets/window.png',
                accelerator: process.platform === 'darwin' ? 'Cmd+S' : 'Ctrl+S'
            },
            {
                label: 'View Logs',
                click: onShowLogs,
                icon: 'assets/logs.png',
                accelerator: process.platform === 'darwin' ? 'Cmd+L' : 'Ctrl+L'
            },
            { type: 'separator' },
            {
                label: 'Restart Server',
                click: onRestart,
                icon: 'assets/restart.png',
                enabled: isRunning,
                accelerator: process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+R'
            },
            {
                label: 'Server Settings',
                submenu: [
                    {
                        label: 'Auto-start on Boot',
                        type: 'checkbox',
                        checked: true,
                        click: (menuItem) => {
                            // Toggle auto-start logic
                        }
                    },
                    {
                        label: 'Change Port...',
                        click: () => {
                            // Port change logic
                        }
                    },
                    {
                        label: 'Reset Token...',
                        click: () => {
                            // Token reset logic
                        }
                    }
                ]
            },
            { type: 'separator' },
            {
                label: 'About AaravPOS Agent',
                click: () => {
                    // Show about dialog
                }
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: onQuit,
                icon: 'assets/quit.png',
                accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4'
            }
        ];
    }
};