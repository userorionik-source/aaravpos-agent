// cat << 'EOF' > electron / printerAgent.js
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const execAsync = promisify(exec);

class PrinterAgent {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.printerName = process.env.PRINTER_NAME || 'SGT88';
        this.isPaused = false;
        this.testJobCounter = 0;
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

    createTestReceiptContent(jobNumber) {
        // ESC/POS commands for a simple test receipt
        const esc = '\x1B';
        const reset = `${esc}@`;
        const center = `${esc}a1`;
        const left = `${esc}a0`;
        const boldOn = `${esc}E1`;
        const boldOff = `${esc}E0`;
        const doubleHeight = `${esc}d1`;
        const normalHeight = `${esc}d0`;
        const cut = `${esc}i`;

        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

        return `${reset}
${center}${boldOn}${doubleHeight}TEST RECEIPT #${jobNumber}${normalHeight}${boldOff}
${left}
${boldOn}STORE:${boldOff} Test Electronics
${boldOn}ADDRESS:${boldOff} 123 Test St, Testville
${boldOn}PHONE:${boldOff} (555) 123-4567
${boldOn}DATE:${boldOff} ${timestamp}
${boldOn}CASHIER:${boldOff} TEST_USER
${boldOn}TERMINAL:${boldOff} 01
${boldOn}--------------------------------${boldOff}
${boldOn}ITEM                     QTY  AMT${boldOff}
Test Product 1               1   $19.99
Test Product 2               2   $29.98
Test Accessory               1   $9.99
${boldOn}--------------------------------${boldOff}
${boldOn}SUBTOTAL:${boldOff}               $59.96
${boldOn}TAX (8.25%):${boldOff}            $4.95
${boldOn}TOTAL:${boldOff}                  $64.91
${boldOn}CASH:${boldOff}                   $70.00
${boldOn}CHANGE:${boldOff}                 $5.09
${boldOn}================================${boldOff}
${center}THANK YOU FOR SHOPPING!
${center}PLEASE COME AGAIN!
${center}REF: ${Math.random().toString(36).substr(2, 10).toUpperCase()}
${center}${now.getTime()}
${cut}
`;
    }

    async generateTestJobs(count) {
        if (this.isPaused) {
            throw new Error('Cannot generate test jobs: printer is paused');
        }

        if (count < 1 || count > 50) {
            throw new Error('Job count must be between 1 and 50');
        }

        const results = [];
        const tempDir = os.tmpdir();

        this.log(`Starting generation of ${count} test job${count !== 1 ? 's' : ''}...`, false);

        for (let i = 1; i <= count; i++) {
            try {
                this.testJobCounter++;
                const jobNumber = this.testJobCounter;

                // Create a temporary file with ESC/POS content
                const tempFilePath = path.join(tempDir, `test_receipt_${jobNumber}_${Date.now()}.txt`);
                const receiptContent = this.createTestReceiptContent(jobNumber);

                fs.writeFileSync(tempFilePath, receiptContent, 'utf8');

                // Print the file
                const command = `lp -d ${this.printerName} -o raw "${tempFilePath}"`;
                const output = await this.executeCommand(command);

                results.push({
                    jobNumber,
                    success: true,
                    message: output.trim(),
                    filePath: tempFilePath
                });

                this.log(`Test job ${jobNumber}/${count} created successfully`);

                // Clean up temp file after a delay
                setTimeout(() => {
                    try {
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                    } catch (cleanupError) {
                        this.log(`Failed to clean up temp file ${tempFilePath}: ${cleanupError.message}`, true);
                    }
                }, 5000);

                // Small delay between jobs to simulate real usage
                if (i < count) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (error) {
                this.log(`Failed to generate test job ${i}: ${error.message}`, true);
                results.push({
                    jobNumber: i,
                    success: false,
                    error: error.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        this.log(`Test job generation completed: ${successCount} successful, ${failCount} failed`);

        return {
            success: successCount > 0,
            message: `Generated ${successCount} test job${successCount !== 1 ? 's' : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}`,
            details: results
        };
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
// EOF