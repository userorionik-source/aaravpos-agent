const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function createWindow() {
    const win = new BrowserWindow({
        width: 500,
        height: 300,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('index.html');
}

/* ───────────────── ESC/POS BARCODE ───────────────── */

function escposBarcode(data) {
    const barcodeData = `{B${data}`; // CODE128 Subset B

    return Buffer.concat([
        Buffer.from([0x1B, 0x40]),             // Initialize printer
        Buffer.from([0x1D, 0x68, 0x50]),       // GS h 80
        Buffer.from([0x1D, 0x77, 0x02]),       // GS w 2
        Buffer.from([0x1D, 0x6B, 0x49, barcodeData.length]),
        Buffer.from(barcodeData, 'ascii'),
        Buffer.from([0x0A, 0x0A]),
        Buffer.from(data + '\n', 'ascii'),
        Buffer.from([0x1D, 0x56, 0x42, 0x00])  // Full cut
    ]);
}


/* ───────────────── PRINT HANDLER ───────────────── */

ipcMain.handle('print-barcode', async (_, { printerName, barcode }) => {
    const tempFile = '/tmp/barcode.raw';
    const payload = escposBarcode(barcode);

    fs.writeFileSync(tempFile, payload);

    return new Promise((resolve, reject) => {
        exec(`lp -d "${printerName}" -o raw "${tempFile}"`, err => {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
});

app.whenReady().then(createWindow);
