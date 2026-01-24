// print-server.js - macOS OPTIMIZED VERSION
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

class PrintServer {
    constructor() {
        this.PORT = 9978;
        this.AUTH_TOKEN = 'supersecret';
        this.wss = null;
        this.server = null;

        // macOS-specific log location
        const homeDir = os.homedir();
        if (os.platform() === 'darwin') {
            this.logPath = path.join(homeDir, 'Library', 'Logs', 'AaravPOS', 'agent.log');
            // Create log directory if it doesn't exist
            const logDir = path.dirname(this.logPath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
        } else {
            this.logPath = path.join(os.tmpdir(), 'aaravpos-print-server.log');
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(logMessage.trim());

        try {
            fs.appendFileSync(this.logPath, logMessage, { flag: 'a' });
        } catch (error) {
            console.error('Failed to write log:', error.message);
        }
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
            Buffer.from(text, 'utf8'), // Changed to utf8 for better character support
            Buffer.from([LF, LF])
        ];

        if (openDrawer) {
            parts.push(DRAWER_KICK);
        }

        parts.push(FEED_AND_CUT);
        return Buffer.concat(parts);
    }

    buildBarcodeBuffer(barcode, type = 'CODE128') {
        const ESC = 0x1B;
        const GS = 0x1D;
        const LF = 0x0A;

        const BARCODE_TYPES = {
            CODE128: 0x49
        };

        return Buffer.concat([
            Buffer.from([GS, 0x68, 80]),        // Barcode height
            Buffer.from([GS, 0x77, 2]),         // Barcode width
            Buffer.from([GS, 0x48, 2]),         // Print HRI below
            Buffer.from([
                GS, 0x6B,
                BARCODE_TYPES[type],
                barcode.length
            ]),
            Buffer.from(barcode, 'ascii'),
            Buffer.from([LF, LF, LF, ESC, 0x69]) // Feed + cut
        ]);
    }


    /* ============================
       macOS PRINT ROUTER
    ============================ */
    printRaw(printerName, buffer) {
        return new Promise((resolve, reject) => {
            const platform = os.platform();
            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `aaravpos-${Date.now()}.raw`);

            fs.writeFile(tempFile, buffer, (err) => {
                if (err) {
                    this.log(`Failed to write temp file: ${err.message}`);
                    reject(err);
                    return;
                }

                let command;

                if (platform === 'darwin') {
                    // macOS-specific command with better error handling
                    // Use lpr for raw printing on macOS
                    command = `lpr -P "${printerName}" -o raw "${tempFile}"`;

                    // Alternative for non-raw printers
                    // command = `cat "${tempFile}" | lp -d "${printerName}" -o raw -`;
                } else if (platform === 'linux') {
                    command = `lp -d "${printerName}" -o raw "${tempFile}"`;
                } else if (platform === 'win32') {
                    const escapedFile = tempFile.replace(/\\/g, '\\\\');
                    const escapedPrinter = printerName.replace(/\\/g, '\\\\');
                    command = `copy /b "${escapedFile}" "\\\\localhost\\${escapedPrinter}"`;
                } else {
                    fs.unlinkSync(tempFile);
                    reject(new Error(`Unsupported platform: ${platform}`));
                    return;
                }

                this.log(`Executing print command: ${command}`);

                exec(command, { timeout: 10000 }, (error, stdout, stderr) => {
                    // Clean up temp file
                    try {
                        fs.unlinkSync(tempFile);
                    } catch (cleanupError) {
                        this.log(`Warning: Failed to cleanup temp file: ${cleanupError.message}`);
                    }

                    if (error) {
                        this.log(`Print error: ${error.message}`);
                        if (stderr) this.log(`stderr: ${stderr}`);
                        reject(error);
                    } else {
                        this.log(`Successfully printed to ${printerName}`);
                        if (stdout) this.log(`stdout: ${stdout}`);
                        resolve(stdout);
                    }
                });
            });
        });
    }

    /* ============================
       macOS PRINTER DISCOVERY
    ============================ */
    getPrinters() {
        return new Promise((resolve, reject) => {
            const platform = os.platform();

            if (platform === 'darwin') {
                // macOS printer discovery
                this.getMacOSPrinters()
                    .then(resolve)
                    .catch(error => {
                        this.log(`Printer discovery error: ${error.message}`);
                        resolve([]);
                    });
            } else if (platform === 'linux') {
                this.getLinuxPrinters()
                    .then(resolve)
                    .catch(error => {
                        this.log(`Printer discovery error: ${error.message}`);
                        resolve([]);
                    });
            } else if (platform === 'win32') {
                this.getWindowsPrinters()
                    .then(resolve)
                    .catch(error => {
                        this.log(`Printer discovery error: ${error.message}`);
                        resolve([]);
                    });
            } else {
                resolve([]);
            }
        });
    }

    async executeCommand(command, args, requestId) {
        try {
            // Validate command exists
            if (!this.commandHandlers[command]) {
                throw new Error(`Unknown command: ${command}`);
            }

            // Log execution attempt
            this.log(`⚡ Executing command: ${command} (${requestId})`);
            if (args.printerName) {
                this.log(`   Printer: ${args.printerName}`);
            }

            // Execute command via registry
            const result = await this.commandHandlers[command](args);

            // Log success
            this.log(`✅ Command ${command} executed successfully`);
            return {
                success: true,
                message: result.message || `Command ${command} executed`,
                requestId
            };

        } catch (error) {
            // Log failure
            this.log(`❌ Command ${command} failed: ${error.message}`);
            return {
                success: false,
                message: error.message,
                requestId
            };
        }
    }

    getMacOSPrinters() {
        return new Promise((resolve, reject) => {
            // First get the default printer
            exec('lpstat -d', (err, defaultOutput) => {
                let defaultPrinter = null;
                if (!err && defaultOutput) {
                    const match = defaultOutput.match(/system default destination:\s*(\S+)/i);
                    defaultPrinter = match ? match[1] : null;
                }

                // Then get all printers with their status
                exec('lpstat -p', (error, stdout, stderr) => {
                    if (error) {
                        this.log(`lpstat error: ${error.message}`);
                        return reject(error);
                    }

                    const printers = [];
                    const lines = stdout.split('\n');

                    lines.forEach(line => {
                        if (line.startsWith('printer ')) {
                            // Example line: "printer HP_LaserJet is idle.  enabled since ..."
                            const parts = line.split(' ');
                            const name = parts[1];

                            // Determine status
                            let status = 'OFFLINE';
                            if (line.includes('idle') || line.includes('enabled')) {
                                status = 'READY';
                            } else if (line.includes('disabled')) {
                                status = 'OFFLINE';
                            } else if (line.includes('printing')) {
                                status = 'PRINTING';
                            }

                            printers.push({
                                name: name,
                                isDefault: name === defaultPrinter,
                                status: status,
                                isConnected: status !== 'OFFLINE'
                            });
                        }
                    });

                    this.log(`Found ${printers.length} printer(s) on macOS`);
                    resolve(printers);
                });
            });
        });
    }

    getLinuxPrinters() {
        return new Promise((resolve, reject) => {
            exec('lpstat -d', (err, defaultOutput) => {
                let defaultPrinter = null;
                if (!err && defaultOutput) {
                    const match = defaultOutput.match(/system default destination:\s*(\S+)/i);
                    defaultPrinter = match ? match[1] : null;
                }

                exec('lpstat -p', (error, stdout, stderr) => {
                    if (error) {
                        return reject(error);
                    }

                    const printers = [];
                    const lines = stdout.split('\n');

                    lines.forEach(line => {
                        if (line.startsWith('printer ')) {
                            const parts = line.split(' ');
                            const name = parts[1];

                            let status = 'OFFLINE';
                            if (line.includes('idle') || line.includes('enabled')) {
                                status = 'READY';
                            }

                            printers.push({
                                name: name,
                                isDefault: name === defaultPrinter,
                                status: status,
                                isConnected: status !== 'OFFLINE'
                            });
                        }
                    });

                    resolve(printers);
                });
            });
        });
    }

    getWindowsPrinters() {
        return new Promise((resolve) => {
            const command =
                'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select Name,Default | ConvertTo-Json -Compress"';

            exec(command, { windowsHide: true, timeout: 8000 }, (error, stdout, stderr) => {
                if (error || !stdout) {
                    this.log(`PowerShell printer discovery failed: ${error?.message || stderr || 'no output'}`);
                    return resolve([]);
                }

                try {
                    const data = JSON.parse(stdout.trim());
                    const printers = Array.isArray(data) ? data : [data];

                    resolve(printers.map(p => ({
                        name: p.Name,
                        isDefault: !!p.Default,
                        status: 'READY',
                        isConnected: true
                    })));
                } catch (e) {
                    this.log(`PowerShell JSON parse error: ${e.message}`);
                    resolve([]);
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
                    host: '127.0.0.1'
                });

                this.wss.on('connection', (ws, req) => {
                    const clientIp = req.socket.remoteAddress;
                    this.log(`New connection from: ${clientIp}`);

                    // Extract token from URL
                    const url = req.url;
                    const params = new URLSearchParams(url.substring(url.indexOf('?')));
                    const token = params.get('token');

                    if (token !== this.AUTH_TOKEN) {
                        this.log(`❌ Invalid token from ${clientIp}`);
                        ws.close();
                        return;
                    }

                    // Send welcome message
                    ws.send(JSON.stringify({
                        type: 'connected',
                        payload: {
                            message: 'AaravPOS Print Server Connected',
                            platform: os.platform(),
                            version: '1.0.0',
                            supportedCommands: Object.keys(this.commandHandlers)
                        }
                    }));

                    ws.on('message', async (msg) => {
                        try {
                            let data;

                            try {
                                data = JSON.parse(msg);
                            } catch (e) {
                                console.error('❌ Invalid JSON received:', msg);
                                return;
                            }

                            if (!data || typeof data !== 'object') {
                                console.error('❌ Invalid WS payload:', data);
                                return;
                            }

                            const { type, payload = {} } = data;
                            this.log(`📨 Received: ${data.type} (${data.requestId || 'no-id'})`);

                            switch (data.type) {
                                case 'health':
                                    const printers = await this.getPrinters();
                                    ws.send(JSON.stringify({
                                        type: 'health_response',
                                        requestId: data.requestId,
                                        payload: {
                                            ok: true,
                                            platform: os.platform(),
                                            version: '1.0.0',
                                            hostname: os.hostname(),
                                            printers: printers,
                                            totalPrinters: printers.length,
                                            defaultPrinter: printers.find(p => p.isDefault)?.name || null,
                                            supportedCommands: Object.keys(this.commandHandlers)
                                        }
                                    }));
                                    break;

                                case 'execute':  // ✅ UNIFIED EXECUTION INTERFACE
                                    if (!data.payload || !data.payload.command) {
                                        ws.send(JSON.stringify({
                                            type: 'execute_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: 'Missing command in payload'
                                            }
                                        }));
                                        return;
                                    }

                                    // Execute command via unified engine
                                    const result = await this.executeCommand(
                                        data.payload.command,
                                        data.payload.args || {},
                                        data.requestId
                                    );

                                    // Send unified response
                                    ws.send(JSON.stringify({
                                        type: 'execute_response',
                                        requestId: data.requestId,
                                        payload: result
                                    }));
                                    break;

                                // ✅ Legacy support for backward compatibility (can be removed later)
                                case 'print_text':
                                    const legacyResult1 = await this.executeCommand(
                                        'PRINT_TEXT',
                                        {
                                            printerName: data.payload.printerName,
                                            text: data.payload.text
                                        },
                                        data.requestId
                                    );
                                    ws.send(JSON.stringify({
                                        type: 'print_response',
                                        requestId: data.requestId,
                                        payload: legacyResult1
                                    }));
                                    break;

                                case 'test_print':
                                    const legacyResult2 = await this.executeCommand(
                                        'TEST_PRINT',
                                        { printerName: data.payload.printerName },
                                        data.requestId
                                    );
                                    ws.send(JSON.stringify({
                                        type: 'test_print_response',
                                        requestId: data.requestId,
                                        payload: legacyResult2
                                    }));
                                    break;

                                case 'open_cash_drawer':
                                    const legacyResult3 = await this.executeCommand(
                                        'OPEN_CASH_DRAWER',
                                        { printerName: data.payload.printerName },
                                        data.requestId
                                    );
                                    ws.send(JSON.stringify({
                                        type: 'cash_drawer_response',
                                        requestId: data.requestId,
                                        payload: legacyResult3
                                    }));
                                    break;
                                case 'print_barcode': {
                                    const payload = data.payload || {};

                                    if (!payload.barcode || !payload.printerName) {
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: '❌ Missing barcode or printer name'
                                            }
                                        }));
                                        return;
                                    }

                                    const buffer = this.buildBarcodeBuffer(
                                        payload.barcode,
                                        payload.format || 'CODE128'
                                    );

                                    await this.printRaw(payload.printerName, buffer);

                                    ws.send(JSON.stringify({
                                        type: 'print_response',
                                        requestId: data.requestId,
                                        payload: {
                                            success: true,
                                            message: `✅ Barcode printed (${payload.barcode})`
                                        }
                                    }));
                                    break;
                                }

                                    try {
                                        const buffer = this.buildBarcodeBuffer(
                                            data.payload.barcode,
                                            data.payload.format
                                        );
                                        await this.printRaw(data.payload.printerName, buffer);
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: true,
                                                message: `✅ Barcode printed (${data.payload.barcode})`
                                            }
                                        }));
                                    } catch (error) {
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: `❌ Barcode failed: ${error.message}`
                                            }
                                        }));
                                    }
                                    break;

                                default:
                                    ws.send(JSON.stringify({
                                        type: 'error',
                                        requestId: data.requestId,
                                        payload: { message: `❌ Unknown command type: ${data.type}` }
                                    }));
                            }
                        } catch (error) {
                            this.log(`❌ Message processing error: ${error.message}`);
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: { message: '❌ Invalid request format' }
                            }));
                        }
                    });

                    ws.on('close', () => {
                        this.log('🔌 Client disconnected');
                    });

                    ws.on('error', (error) => {
                        this.log(`❌ WebSocket error: ${error.message}`);
                    });
                });

                this.wss.on('listening', () => {
                    this.log(`🖨️  AaravPOS Print Server running on ws://127.0.0.1:${this.PORT}`);
                    this.log(`📝 Log file: ${this.logPath}`);
                    this.log(`💻 Platform: ${os.platform()} ${os.arch()}`);
                    this.log(`⚡ Supported commands: ${Object.keys(this.commandHandlers).join(', ')}`);
                    resolve();
                });

                this.wss.on('error', (error) => {
                    this.log(`❌ Server error: ${error.message}`);
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
                    this.log('🛑 Print server stopped');
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
            platform: os.platform(),
            version: '1.0.0'
        };
    }

    async getPrintersList() {
        return await this.getPrinters();
    }
}

module.exports = PrintServer;