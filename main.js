const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const printer = require("./printerAgent");

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.js")
        }
    });

    win.loadFile(path.join(__dirname, "index.html"));
}

/* IPC bindings */

ipcMain.handle("print:create", (_, filePath) =>
    printer.printFile(filePath)
);

ipcMain.handle("print:list", () =>
    printer.getQueue()
);

ipcMain.handle("print:pause", () =>
    printer.pauseQueue()
);

ipcMain.handle("print:resume", () =>
    printer.resumeQueue()
);

ipcMain.handle("print:cancel", (_, jobId) =>
    printer.cancelJob(jobId)
);

app.whenReady().then(createWindow);
