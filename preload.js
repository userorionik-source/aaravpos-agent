const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("printerAPI", {
    print: (filePath) => ipcRenderer.invoke("print:create", filePath),
    list: () => ipcRenderer.invoke("print:list"),
    pause: () => ipcRenderer.invoke("print:pause"),
    resume: () => ipcRenderer.invoke("print:resume"),
    cancel: (jobId) => ipcRenderer.invoke("print:cancel", jobId)
});
