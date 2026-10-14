/* Video datoteke ostaju Blobovi; ne pretvaraju se u tekst unutar HTML-a. */
(function (root) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  async function checksum(blob) {
    let crc = 0xffffffff;
    const chunkSize = 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function createZip(entries, progress = () => {}) {
    if (entries.length > 65535) throw new Error('Previše datoteka za jedan paket.');
    const encoder = new TextEncoder();
    const parts = [], directory = [];
    let offset = 0, dirLength = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry.blob.size > 0xffffffff || offset + entry.blob.size + 1024 > 0xffffffff) throw new Error('Paket je veći od 4 GB. Preuzmi manje videa odjednom.');
      const name = encoder.encode(entry.name);
      if (name.length > 65535) throw new Error('Naziv datoteke je predug.');
      progress(index, entries.length, entry.name);
      const crc = await checksum(entry.blob);
      const header = new Uint8Array(30 + name.length);
      const local = new DataView(header.buffer);
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); local.setUint16(12, 33, true);
      local.setUint32(14, crc, true); local.setUint32(18, entry.blob.size, true);
      local.setUint32(22, entry.blob.size, true); local.setUint16(26, name.length, true);
      header.set(name, 30);
      parts.push(header, entry.blob);
      const central = new Uint8Array(46 + name.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 0x02014b50, true); view.setUint16(4, 20, true); view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true); view.setUint16(14, 33, true);
      view.setUint32(16, crc, true); view.setUint32(20, entry.blob.size, true);
      view.setUint32(24, entry.blob.size, true); view.setUint16(28, name.length, true);
      view.setUint32(42, offset, true); central.set(name, 46);
      directory.push(central); dirLength += central.length;
      offset += header.length + entry.blob.size;
    }
    if (offset + dirLength + 22 > 0xffffffff) throw new Error('Paket je veći od 4 GB.');
    const end = new Uint8Array(22), view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true); view.setUint32(12, dirLength, true);
    view.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
  }
  function videoExtension(file) {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return ext;
    return ({ 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv' })[file.type] || 'mp4';
  }
  function acceptsVideo(file) {
    return !!file && (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name || ''));
  }
  function openMediaStore() {
    return new Promise((resolve, reject) => {
      let request;
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('Spremište se ne može otvoriti.')); }, 5000);
      try { request = indexedDB.open('ana-krpan-portfolio-media-v2', 1); } catch (error) { clearTimeout(timer); reject(error); return; }
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files'); };
      request.onsuccess = () => { clearTimeout(timer); const db = request.result; if (expired) { db.close(); return; } db.onversionchange = () => db.close(); resolve(db); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error('Spremište je zauzeto u drugoj kartici.')); };
    });
  }
  function storeOperation(db, action, key, value) {
    return new Promise((resolve, reject) => {
      let tx, request;
      try {
        tx = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('files');
        request = action === 'put' ? store.put(value, key) : action === 'delete' ? store.delete(key) : store.get(key);
      } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('Spremanje nije dovršeno.'));
    });
  }
  const api = { createZip, checksum, acceptsVideo, videoExtension, openMediaStore, storeOperation };
  root.PortfolioFiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
