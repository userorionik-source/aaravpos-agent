// print-server.js - Enhanced Version for Two Button Behaviors - OPTIMIZED SPACING
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
        this.DEMO_BARCODE = 'INV-20251118';

        // macOS-specific log location
        const homeDir = os.homedir();
        if (os.platform() === 'darwin') {
            this.logPath = path.join(homeDir, 'Library', 'Logs', 'AaravPOS', 'agent.log');
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
       ESC/POS BUFFER BUILDERS - OPTIMIZED FOR PAPER SAVING
    ============================ */

    // Simple text buffer (for print_text) - OPTIMIZED
    // Simple text buffer (for print_text) - FIXED MARGINS
    buildBuffer(text, openDrawer = false) {
        const ESC = 0x1B;
        const LF = 0x0A;
        const DRAWER_KICK = Buffer.from([ESC, 0x70, 0x00, 0x19, 0xFA]);
        // Reduced from 4 LFs to 2 LFs before cut
        const FEED_AND_CUT = Buffer.from([LF, LF, ESC, 0x69]);

        const parts = [
            Buffer.from(text, 'utf8'),
            Buffer.from([LF]),
            Buffer.from([LF]),
            Buffer.from([LF])
        ];
        
        if (openDrawer) {
            parts.push(DRAWER_KICK);
        }
        
        Buffer.from([LF])
        parts.push(FEED_AND_CUT);
        return Buffer.concat(parts);
    }

    /**
     * ✅ SCENARIO 1: Print Barcode Only (from 🧾 Print Barcode button)
     * Always prints the demo barcode: INV-20251118-035012-7AB50493
     * OPTIMIZED: Reduced excessive line feeds
     */
    buildBarcodeOnlyBuffer(barcode) {
        const ESC = 0x1B;
        const GS = 0x1D;
        const LF = 0x0A;

        const buffers = [];

        // Initialize printer
        buffers.push(Buffer.from([ESC, 0x40]));

        // Center alignment for barcode
        buffers.push(Buffer.from([ESC, 0x61, 0x01])); // Center align

        // Add title with minimal spacing
        const title = "AARAVPOS - BARCODE ONLY\n";
        buffers.push(Buffer.from(title, 'utf8'));

        // Barcode configuration
        buffers.push(Buffer.from([GS, 0x68, 80])); // Height
        buffers.push(Buffer.from([GS, 0x77, 2]));   // Width
        buffers.push(Buffer.from([GS, 0x48, 2]));   // HRI below barcode

        // Feed before barcode
        buffers.push(Buffer.from([LF]));

        // Print CODE128 barcode - FIXED: Use the actual barcode parameter
        let barcodeData = barcode || this.DEMO_BARCODE; // Use provided barcode or demo
        if (barcodeData.length % 2 !== 0) {
            barcodeData = barcodeData + ' '; // Make even
        }

        // Correct barcode command structure
        buffers.push(Buffer.from([
            GS, 0x6B,           // GS k - Print barcode
            0x49,               // m = 73 (0x49 for CODE128)
            barcodeData.length + 2  // n = number of bytes
        ]));
        buffers.push(Buffer.from(`{B${barcodeData}`, 'ascii'));

        // Feed after barcode
        buffers.push(Buffer.from([LF]));

        // Reset alignment
        buffers.push(Buffer.from([ESC, 0x61, 0x00])); // Left align

        // Add footer with minimal spacing
        const footer = "Printed: " + new Date().toLocaleString() + "\n";
        buffers.push(Buffer.from(footer, 'utf8'));

        // Feed and cut
        buffers.push(Buffer.from([LF, ESC, 0x64, 4])); // Feed 4 lines
        buffers.push(Buffer.from([GS, 0x56, 0x00])); // Full cut

        return Buffer.concat(buffers);
    }

    /**
 * ✅ SCENARIO 2: Print Combined Receipt (from 🖨️ Print Text button)
 * Prints receipt text + barcode extracted from the text
 * If only barcode present, prints just the barcode
 * FIXED: Removes extra separators when only barcode
 */
    buildCombinedReceiptBuffer(receiptText, barcode) {
        const ESC = 0x1B;
        const GS = 0x1D;
        const LF = 0x0A;

        const buffers = [];

        // Initialize printer
        buffers.push(Buffer.from([ESC, 0x40]));

        // Parse text line by line
        const textLines = receiptText.split('\n');
        let skipNextLine = false;
        let previousLineWasEmpty = false;
        let hasContentBeforeBarcode = false;
        let hasContentAfterBarcode = false;
        let barcodeFound = false;

        // First pass to check content structure
        for (let i = 0; i < textLines.length; i++) {
            const line = textLines[i].trim();
            if (line === 'BARCODE') {
                barcodeFound = true;
                // Check if there's content before barcode
                for (let j = 0; j < i; j++) {
                    if (textLines[j].trim() !== '' && textLines[j].trim() !== 'BARCODE') {
                        hasContentBeforeBarcode = true;
                        break;
                    }
                }
                // Check if there's content after barcode
                for (let j = i + 2; j < textLines.length; j++) {
                    if (textLines[j].trim() !== '') {
                        hasContentAfterBarcode = true;
                        break;
                    }
                }
                break;
            }
        }

        // Second pass to build buffer
        for (let i = 0; i < textLines.length; i++) {
            const line = textLines[i];

            // Handle empty lines - only add ONE empty line even if multiple consecutive
            if (line.trim() === '') {
                if (!previousLineWasEmpty) {
                    buffers.push(Buffer.from([LF]));
                    previousLineWasEmpty = true;
                }
                continue;
            }

            previousLineWasEmpty = false;

            // Check if this line is "BARCODE"
            if (line.trim() === 'BARCODE') {
                // Center alignment for barcode
                buffers.push(Buffer.from([ESC, 0x61, 0x01])); // Center align

                // Barcode configuration with optimized settings
                buffers.push(Buffer.from([GS, 0x68, 80]));  // Height
                buffers.push(Buffer.from([GS, 0x77, 2]));   // Width
                buffers.push(Buffer.from([GS, 0x48, 2]));   // HRI below barcode

                // Print barcode
                let barcodeData = barcode;
                if (barcode.length % 2 !== 0) {
                    barcodeData = barcode + ' ';
                }

                buffers.push(Buffer.from([
                    GS, 0x6B,
                    0x49,          // CODE128
                    barcodeData.length + 2
                ]));
                buffers.push(Buffer.from(`{B${barcodeData}`, 'ascii'));

                // Feed after barcode
                buffers.push(Buffer.from([LF]));

                // Reset alignment
                buffers.push(Buffer.from([ESC, 0x61, 0x00])); // Left align

                // Skip the next line (the barcode text value) since we just printed it as barcode
                skipNextLine = true;
                continue;
            }

            // Skip the line after BARCODE (the barcode value) since we already printed it
            if (skipNextLine) {
                skipNextLine = false;
                continue;
            }

            // Print normal text line
            buffers.push(Buffer.from(line, 'utf8'));
            buffers.push(Buffer.from([LF]));
        }

        // Only add footer if there was actual content
        let hasAnyContent = false;
        for (const line of textLines) {
            if (line.trim() !== '' && line.trim() !== 'BARCODE') {
                // Check if this line wasn't the barcode value that we skipped
                const trimmedLine = line.trim();
                if (trimmedLine !== barcode && trimmedLine !== '') {
                    hasAnyContent = true;
                    break;
                }
            }
        }

        if (hasAnyContent || barcodeFound) {
            // Add footer with minimal spacing
            buffers.push(Buffer.from([LF]));
            buffers.push(Buffer.from("AaravPOS - Receipt\n", 'utf8'));
        }

        // Single cut at the end with consistent feeding
        buffers.push(Buffer.from([LF, ESC, 0x64, 3])); // Feed 3 lines before cut
        buffers.push(Buffer.from([GS, 0x56, 0x00])); // Full cut

        return Buffer.concat(buffers);
    }

    /**
     * Extract barcode from receipt text (matching frontend logic)
     */
    extractBarcodeFromText(text) {
        const lines = text.split('\n').map(l => l.trim());
        const barcodeIndex = lines.findIndex(line => line === 'BARCODE');

        if (barcodeIndex !== -1 && lines[barcodeIndex + 1]) {
            return lines[barcodeIndex + 1].trim();
        }

        return this.DEMO_BARCODE; // Fallback to demo barcode
    }

    /* ============================
       RAW PRINTING
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
                    // macOS
                    command = `lpr -P "${printerName}" -o raw "${tempFile}"`;
                } else if (platform === 'linux') {
                    // Linux
                    command = `lp -d "${printerName}" -o raw "${tempFile}"`;
                } else if (platform === 'win32') {
                    // Windows
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
       PRINTER DISCOVERY
    ============================ */
    getPrinters() {
        return new Promise((resolve, reject) => {
            const platform = os.platform();

            if (platform === 'darwin') {
                this.getMacOSPrinters().then(resolve).catch(error => {
                    this.log(`Printer discovery error: ${error.message}`);
                    resolve([]);
                });
            } else if (platform === 'linux') {
                this.getLinuxPrinters().then(resolve).catch(error => {
                    this.log(`Printer discovery error: ${error.message}`);
                    resolve([]);
                });
            } else if (platform === 'win32') {
                this.getWindowsPrinters().then(resolve).catch(error => {
                    this.log(`Printer discovery error: ${error.message}`);
                    resolve([]);
                });
            } else {
                resolve([]);
            }
        });
    }

    getMacOSPrinters() {
        return new Promise((resolve, reject) => {
            exec('lpstat -d', (err, defaultOutput) => {
                let defaultPrinter = null;
                if (!err && defaultOutput) {
                    const match = defaultOutput.match(/system default destination:\s*(\S+)/i);
                    defaultPrinter = match ? match[1] : null;
                }

                exec('lpstat -p', (error, stdout, stderr) => {
                    if (error) {
                        this.log(`lpstat error: ${error.message}`);
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
       WEBSOCKET SERVER
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

                    // Extract token
                    const url = req.url;
                    const params = new URLSearchParams(url.substring(url.indexOf('?')));
                    const token = params.get('token');

                    if (token !== this.AUTH_TOKEN) {
                        this.log(`Invalid token from ${clientIp}`);
                        ws.close();
                        return;
                    }

                    // Send welcome message
                    ws.send(JSON.stringify({
                        type: 'connected',
                        payload: {
                            message: 'AaravPOS Print Server Connected',
                            platform: os.platform(),
                            version: '1.2.0',
                            demoBarcode: this.DEMO_BARCODE,
                            paperOptimized: true
                        }
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
                                            version: '1.2.0',
                                            hostname: os.hostname(),
                                            printers: printers,
                                            totalPrinters: printers.length,
                                            defaultPrinter: printers.find(p => p.isDefault)?.name || null,
                                            demoBarcode: this.DEMO_BARCODE,
                                            paperOptimized: true
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
                                                message: `Printed text to ${data.payload.printerName}`,
                                                barcodeUsed: null,
                                                paperSaved: true
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
                                    const TEST_RECEIPT = `
================================
    AARAVPOS TEST PRINT
================================
Date: ${new Date().toLocaleString()}
Version: 1.2.0
Platform: ${os.platform()}
Hostname: ${os.hostname()}
================================
TEST PRINT SUCCESSFUL
================================
`;


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
                                                message: 'Cash drawer command sent'
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

                                case 'print_barcode': {
                                    const payload = data.payload || {};

                                    // Validate required fields
                                    if (!payload.barcode || !payload.printerName) {
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: 'Missing barcode or printer name'
                                            }
                                        }));
                                        return;
                                    }

                                    try {
                                        let buffer;
                                        let barcodeToPrint = payload.barcode;

                                        // ✅ SCENARIO 1: Print Barcode Only (from Print Barcode button)
                                        if (!payload.receiptText) {
                                            // Always use demo barcode for this scenario
                                            barcodeToPrint = this.DEMO_BARCODE;
                                            buffer = this.buildBarcodeOnlyBuffer(barcodeToPrint);
                                            this.log(`Printing barcode only: ${barcodeToPrint}`);
                                        }
                                        // ✅ SCENARIO 2: Print Combined Receipt (from Print Text button)
                                        else {
                                            // Extract barcode from receipt text if provided
                                            const extractedBarcode = this.extractBarcodeFromText(payload.receiptText);
                                            barcodeToPrint = extractedBarcode || payload.barcode;

                                            buffer = this.buildCombinedReceiptBuffer(
                                                payload.receiptText,
                                                barcodeToPrint
                                            );
                                            this.log(`Printing combined receipt with barcode: ${barcodeToPrint}`);
                                        }

                                        await this.printRaw(payload.printerName, buffer);

                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: true,
                                                message: `Printed barcode: ${barcodeToPrint}`,
                                                barcodeUsed: barcodeToPrint,
                                                isDemoBarcode: barcodeToPrint === this.DEMO_BARCODE,
                                                paperOptimized: true
                                            }
                                        }));
                                    } catch (error) {
                                        this.log(`Barcode print error: ${error.message}`);
                                        ws.send(JSON.stringify({
                                            type: 'print_response',
                                            requestId: data.requestId,
                                            payload: {
                                                success: false,
                                                message: `Barcode failed: ${error.message}`
                                            }
                                        }));
                                    }
                                    break;
                                }

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
                    this.log(`AaravPOS Print Server v1.2.0 running on ws://127.0.0.1:${this.PORT}`);
                    this.log(`Log file: ${this.logPath}`);
                    this.log(`Platform: ${os.platform()} ${os.arch()}`);
                    this.log(`Demo barcode: ${this.DEMO_BARCODE}`);
                    this.log(`Paper usage optimized for thermal printers`);
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
            platform: os.platform(),
            version: '1.2.0',
            demoBarcode: this.DEMO_BARCODE,
            paperOptimized: true
        };
    }

    async getPrintersList() {
        return await this.getPrinters();
    }
}

module.exports = PrintServer;