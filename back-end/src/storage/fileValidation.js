function validPdf(buffer) {
  return buffer.length >= 8
    && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    && buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF'));
}

function validDocx(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  const text = buffer.toString('latin1');
  return text.includes('[Content_Types].xml') && text.includes('word/');
}

function validLogo(buffer, mimeType) {
  if (mimeType === 'image/png') {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    return buffer.length >= 45
      && buffer.subarray(0, 8).equals(signature)
      && buffer.subarray(12, 16).toString('ascii') === 'IHDR'
      && buffer.subarray(-12).equals(iend);
  }
  return mimeType === 'image/jpeg' && buffer.length >= 4
    && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

module.exports = { validPdf, validDocx, validLogo };
