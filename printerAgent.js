const { exec } = require("child_process");

const PRINTER_NAME = "SGT88";

/**
 * Execute system command
 */
function execCmd(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) reject(stderr || err.message);
            else resolve(stdout.trim());
        });
    });
}

/* ───────────── CREATE ───────────── */

/**
 * Send RAW file to receipt printer
 */
async function printFile(filePath) {
    return execCmd(`lp -d "${PRINTER_NAME}" -o raw "${filePath}"`);
}

/* ───────────── READ ───────────── */

/**
 * Get real print queue from CUPS
 */
async function getQueue() {
    const output = await execCmd(`lpstat -o "${PRINTER_NAME}"`);
    if (!output) return [];

    return output.split("\n").map(line => {
        const parts = line.split(/\s+/);
        const jobFull = parts[0]; // printer-123
        return {
            jobId: jobFull.split("-")[1],
            jobName: jobFull,
            status: "Queued"
        };
    });
}

/* ───────────── UPDATE ───────────── */

/**
 * Pause entire printer queue
 */
async function pauseQueue() {
    return execCmd(`cupsdisable "${PRINTER_NAME}"`);
}

/**
 * Resume printer queue
 */
async function resumeQueue() {
    return execCmd(`cupsenable "${PRINTER_NAME}"`);
}

/* ───────────── DELETE ───────────── */

/**
 * Cancel specific print job
 */
async function cancelJob(jobId) {
    return execCmd(`cancel ${jobId}`);
}

module.exports = {
    printFile,
    getQueue,
    pauseQueue,
    resumeQueue,
    cancelJob
};
