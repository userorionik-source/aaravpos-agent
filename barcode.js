module.exports.buildBarcodeESCPos = function (data, format) {
    const cmds = [];

    cmds.push(Buffer.from([0x1B, 0x40])); // init
    cmds.push(Buffer.from([0x1D, 0x48, 0x02])); // HRI below
    cmds.push(Buffer.from([0x1D, 0x77, 0x02])); // width
    cmds.push(Buffer.from([0x1D, 0x68, 0x60])); // height

    let barcodeData = data;
    let type = 0x49; // CODE128 default

    if (format === 'CODE128') {
        barcodeData = `{B${data}`; // 🔥 REQUIRED
    }

    cmds.push(Buffer.from([
        0x1D, 0x6B,
        type,
        barcodeData.length
    ]));

    cmds.push(Buffer.from(barcodeData, 'ascii'));
    cmds.push(Buffer.from([0x0A, 0x0A]));
    cmds.push(Buffer.from([0x1D, 0x56, 0x00])); // cut

    return Buffer.concat(cmds);
};
