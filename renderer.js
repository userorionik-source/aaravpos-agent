document.getElementById('printBtn').addEventListener('click', async () => {
    const printerName = document.getElementById('printer').value;
    const barcode = document.getElementById('barcode').value;

    try {
        await window.printer.printBarcode(printerName, barcode);
        alert('Barcode printed');
    } catch (err) {
        alert('Print failed');
        console.error(err);
    }
});
