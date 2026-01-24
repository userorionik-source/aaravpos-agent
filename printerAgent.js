const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class PrinterAgent {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.printerName = process.env.PRINTER_NAME || 'SGT88';
        this.isPaused = false;
        this.log('Printer agent initialized');
    }

    log(message, isError = false) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('log:message', {
                timestamp,
                message,
                isError
            });
        }
    }

    async executeCommand(command) {
        try {
            this.log(`Executing: ${command}`);
            const { stdout, stderr } = await execAsync(command);
            if (stderr) {
                this.log(`Command stderr: ${stderr}`, true);
            }
            return stdout;
        } catch (error) {
            this.log(`Command failed: ${error.message}`, true);
            throw error;
        }
    }

    async printFile(filePath) {
        if (this.isPaused) {
            throw new Error('Cannot print: printer is paused');
        }

        if (!filePath) {
            throw new Error('No file path provided');
        }

        try {
            const command = `lp -d ${this.printerName} -o raw "${filePath}"`;
            const output = await this.executeCommand(command);
            this.log(`Print job created: ${output.trim()}`);
            return { success: true, message: output.trim() };
        } catch (error) {
            this.log(`Print failed: ${error.message}`, true);
            throw error;
        }
    }

    async getQueue() {
        try {
            const command = `lpstat -o ${this.printerName}`;
            const output = await this.executeCommand(command);

            if (!output.trim()) {
                return [];
            }

            const jobs = [];
            const lines = output.trim().split('\n');

            for (const line of lines) {
                const parts = line.split(/\s+/);
                if (parts.length >= 6) {
                    const jobId = parts[0].split('-')[1];
                    const jobName = parts.slice(5).join(' ');
                    const status = this.isPaused ? 'Paused' : 'Queued';

                    jobs.push({
                        jobId,
                        jobName,
                        status
                    });
                }
            }

            return jobs;
        } catch (error) {
            this.log(`Failed to get queue: ${error.message}`, true);
            return [];
        }
    }

    async pauseQueue() {
        try {
            const command = `cupsdisable ${this.printerName}`;
            await this.executeCommand(command);
            this.isPaused = true;
            this.log('Printer paused');
            return { success: true };
        } catch (error) {
            this.log(`Failed to pause printer: ${error.message}`, true);
            throw error;
        }
    }

    async resumeQueue() {
        try {
            const command = `cupsenable ${this.printerName}`;
            await this.executeCommand(command);
            this.isPaused = false;
            this.log('Printer resumed');
            return { success: true };
        } catch (error) {
            this.log(`Failed to resume printer: ${error.message}`, true);
            throw error;
        }
    }

    async cancelJob(jobId) {
        try {
            const command = `cancel ${jobId}`;
            await this.executeCommand(command);
            this.log(`Job ${jobId} cancelled`);
            return { success: true };
        } catch (error) {
            this.log(`Failed to cancel job ${jobId}: ${error.message}`, true);
            throw error;
        }
    }

    async clearQueue() {
        try {
            const command = `cancel -a ${this.printerName}`;
            await this.executeCommand(command);
            this.log('Queue cleared');
            return { success: true };
        } catch (error) {
            this.log(`Failed to clear queue: ${error.message}`, true);
            throw error;
        }
    }

    async getPrinterState() {
        try {
            const command = `lpstat -p ${this.printerName}`;
            const output = await this.executeCommand(command);
            const isDisabled = output.includes('disabled');
            this.isPaused = isDisabled;
            return {
                isPaused: this.isPaused,
                printerName: this.printerName
            };
        } catch (error) {
            this.log(`Failed to get printer state: ${error.message}`, true);
            return {
                isPaused: this.isPaused,
                printerName: this.printerName,
                error: error.message
            };
        }
    }
}

module.exports = PrinterAgent;
