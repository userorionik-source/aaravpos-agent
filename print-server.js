// print-server.js - UPDATED VERSION
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const crypto = require('crypto');

class PrintServer {
    constructor() {
        this.PORT = 9978; // Changed from 9978 to avoid conflicts
        this.AUTH_TOKEN = 'supersecret';
        this.wss = null;
        this.server = null;
        this.logPath = path.join(os.tmpdir(), 'aaravpos-print-server.log');
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(logMessage.trim());

        // Append to log file
        fs.appendFileSync(this.logPath, logMessage, { flag: 'a' });
    }

    /* ============================
       ESC/POS CONSTANTS
    ============================ */
    buildBuffer(text, openDrawer = false) {
        const ESC = 0x1B;
        const LF = 0x0A;
        const DRAWER_KICK = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xFA]);
        const FEED_AND_CUT = Buffer.from([LF, LF, LF, LF, ESC, 0x69]);

        const parts = [
            Buffer.from(text, 'ascii'),
            Buffer.from([LF, LF])
        ];

        if (openDrawer) {
            parts.push(DRAWER_KICK);
        }

        parts.push(FEED_AND_CUT);
        return Buffer.concat(parts);
    }

    /* ============================
       PRINT ROUTER
    ============================ */
    printRaw(printerName, buffer) {
        return new Promise((resolve, reject) => {
            const platform = os.platform();
            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `aaravpos-${Date.now()}.raw`);

            fs.writeFile(tempFile, buffer, (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                let command;
                if (platform === 'darwin') {
                    command = `lp -d "${printerName}" -o raw "${tempFile}"`;
                } else if (platform === 'linux') {
                    command = `lp -d "${printerName}" -o raw "${tempFile}"`;
                } else if (platform === 'win32') {
                    // Escape backslashes for Windows
                    const escapedFile = tempFile.replace(/\\/g, '\\\\');
                    const escapedPrinter = printerName.replace(/\\/g, '\\\\');
                    command = `copy /b "${escapedFile}" "\\\\localhost\\${escapedPrinter}"`;
                } else {
                    reject(new Error(`Unsupported platform: ${platform}`));
                    return;
                }

                exec(command, (error, stdout, stderr) => {
                    // Clean up temp file
                    fs.unlink(tempFile, () => { });

                    if (error) {
                        this.log(`Print error: ${error.message}`);
                        reject(error);
                    } else {
                        this.log(`Printed to ${printerName}`);
                        resolve(stdout);
                    }
                });
            });
        });
    }

    /* ============================
       PRINTER DISCOVERY
    ============================ */
    getPrinters() {
        return new Promise((resolve, reject) => {
            const platform = os.platform();
            let command;

            if (platform === 'win32') {
                command = 'wmic printer get Name,Default';
            } else if (platform === 'darwin') {
                command = 'lpstat -p -d';
            } else if (platform === 'linux') {
                command = 'lpstat -p -d';
            } else {
                resolve([]);
                return;
            }

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    this.log(`Printer discovery error: ${error.message}`);
                    resolve([]);
                    return;
                }

                const printers = [];

                if (platform === 'win32') {
                    exec(
                        'wmic printer get Name,Default /FORMAT:CSV',
                        (error, stdout) => {
                            if (error) {
                                this.log(`Printer discovery error: ${error.message}`);
                                return resolve([]);
                            }

                            const lines = stdout.split('\n').slice(1);
                            const printers = [];

                            for (const line of lines) {
                                if (!line.trim()) continue;

                                // CSV format:
                                // Node,Default,Name
                                const parts = line.split(',');

                                if (parts.length < 3) continue;

                                const isDefault = parts[1].trim().toUpperCase() === 'TRUE';
                                const name = parts.slice(2).join(',').trim(); // SAFE even if name has commas

                                if (!name) continue;

                                printers.push({
                                    name,
                                    isDefault,
                                    status: 'READY',
                                    isConnected: true
                                });
                            }

                            resolve(printers);
                        }
                    );
                    return;
                } else {
                    // Parse macOS/Linux lpstat output
                    const lines = stdout.split('\n');
                    let defaultPrinter = null;

                    // Find default printer
                    exec('lpstat -d', (err, out) => {
                        if (!err && out) {
                            const match = out.match(/system default destination:\s*(\S+)/i);
                            defaultPrinter = match ? match[1] : null;
                        }

                        lines.forEach(line => {
                            if (line.startsWith('printer ')) {
                                const name = line.split(' ')[1];
                                printers.push({
                                    name: name,
                                    isDefault: name === defaultPrinter,
                                    status: line.includes('enabled') ? 'READY' : 'OFFLINE'
                                });
                            }
                        });

                        resolve(printers);
                    });
                }

                if (platform === 'win32') {
                    resolve(printers);
                }
            });
        });
    }

    /* ============================
       START/STOP SERVER
    ============================ */
    start() {
        return new Promise((resolve, reject) => {
            try {
                this.wss = new WebSocket.Server({
                    port: this.PORT,
                    host: '127.0.0.1' // Changed to localhost only for security
                });

                this.wss.on('connection', (ws, req) => {
                    this.log(`New connection from: ${req.socket.remoteAddress}`);

                    // Extract token from URL
                    const url = req.url;
                    const params = new URLSearchParams(url.substring(url.indexOf('?')));
                    const token = params.get('token');

                    if (token !== this.AUTH_TOKEN) {
                        this.log(`Invalid token from ${req.socket.remoteAddress}`);
                        ws.close();
                        return;
                    }

                    // Send welcome message
                    ws.send(JSON.stringify({
                        type: 'connected',
                        payload: { message: 'AaravPOS Print Server Connected' }
                    }));

                    ws.on('message', async (msg) => {
                        try {
                            const data = JSON.parse(msg);
                            this.log(`Received: ${data.type} (${data.requestId || 'no-id'})`);

                            switch (data.type) {
                                case 'health':
                                    const printers = await this.getPrinters();
                                    ws.send(JSON.stringify({
                                        type: 'health_response',
                                        requestId: data.requestId,
                                        payload: {
                                            ok: true,
                                            platform: os.platform(),
                                            printers: printers,
                                            totalPrinters: printers.length,
                                            defaultPrinter: printers.find(p => p.isDefault)?.name || null
                                        }
                                    }));
                                    break;

                                case 'print_text':
                                    try {
                                        const buffer = this.buildBuffer(data.payload.text, false);
                                        await this.printRaw(data.payload.printerName, buffer);
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: true,
                                                message: `Printed to ${data.payload.printerName}`
                                            }
                                        }));
                                    } catch (error) {
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: `Print failed: ${error.message}`
                                            }
                                        }));
                                    }
                                    break;

                                case 'test_print':
                                    const TEST_RECEIPT = `AARAVPOS AGENT TEST PRINT
================================
Date: ${new Date().toLocaleString()}
Agent Version: 1.0.0
Platform: ${os.platform()}
================================
This is a test from the Electron
agent running on your computer.
================================
            SUCCESS!
================================`;

                                    try {
                                        const buffer = this.buildBuffer(TEST_RECEIPT, false);
                                        await this.printRaw(data.payload.printerName, buffer);
                                        ws.send(JSON.stringify({
                                            type: 'test_print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: true,
                                                message: 'Test print sent successfully'
                                            }
                                        }));
                                    } catch (error) {
                                        ws.send(JSON.stringify({
                                            type: 'test_print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: `Test print failed: ${error.message}`
                                            }
                                        }));
                                    }
                                    break;

                                case 'open_cash_drawer':
                                    try {
                                        const buffer = this.buildBuffer('OPENING CASH DRAWER\n', true);
                                        await this.printRaw(data.payload.printerName, buffer);
                                        ws.send(JSON.stringify({
                                            type: 'cash_drawer_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: true,
                                                message: 'Cash drawer opened'
                                            }
                                        }));
                                    } catch (error) {
                                        ws.send(JSON.stringify({
                                            type: 'cash_drawer_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: `Cash drawer failed: ${error.message}`
                                            }
                                        }));
                                    }
                                    break;

                                default:
                                    ws.send(JSON.stringify({
                                        type: 'error',
                                        requestId: data.requestId,
                                        payload: { message: `Unknown command: ${data.type}` }
                                    }));
                            }
                        } catch (error) {
                            this.log(`Message processing error: ${error.message}`);
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: { message: 'Invalid request format' }
                            }));
                        }
                    });

                    ws.on('close', () => {
                        this.log('Client disconnected');
                    });

                    ws.on('error', (error) => {
                        this.log(`WebSocket error: ${error.message}`);
                    });
                });

                this.wss.on('listening', () => {
                    this.log(`🖨️ AaravPOS Print Server running on ws://127.0.0.1:${this.PORT}`);
                    this.log(`📁 Log file: ${this.logPath}`);
                    resolve();
                });

                this.wss.on('error', (error) => {
                    this.log(`Server error: ${error.message}`);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.wss) {
                this.wss.close(() => {
                    this.log('Print server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getStatus() {
        return {
            isRunning: this.wss !== null,
            port: this.PORT,
            connections: this.wss ? this.wss.clients.size : 0,
            logPath: this.logPath,
            lastError: this.lastError,
            startupTime: this.startupTime
        };
    }

    // Add this method to get printers on demand
    async getPrintersList() {
        return await this.getPrinters();
    }
}

// Export for use in main process
module.exports = PrintServer;