(function (root) {
  const MAX_PHOTO_BYTES = 220 * 1024;
  function acceptsPhoto(file) {
    return !!file && ((file.type || '').startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name || ''));
  }
  async function decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file, { resizeWidth: 1400, resizeQuality: 'high' });
        return { image: bitmap, release: () => bitmap.close() };
      } catch (_) {}
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Fotografiju nije moguće otvoriti. Pokušaj JPG ili PNG kopiju.')); image.src = url; });
      return { image, release: () => { image.src = ''; URL.revokeObjectURL(url); } };
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  function encode(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Fotografija se nije mogla pripremiti za spremanje.')), 'image/jpeg', quality));
  }
  async function preparePhoto(file) {
    if (!acceptsPhoto(file)) throw new Error('Odaberi fotografiju, primjerice JPG ili PNG.');
    const decoded = await decode(file);
    const canvas = document.createElement('canvas');
    try {
      const width = decoded.image.width || decoded.image.naturalWidth;
      const height = decoded.image.height || decoded.image.naturalHeight;
      if (!width || !height) throw new Error('Fotografija nema ispravne dimenzije.');
      let edge = 1600;
      for (let attempt = 0; attempt < 12; attempt++) {
        const scale = Math.min(1, edge / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Preglednik ne podržava pripremu fotografija.');
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.86, 0.7, 0.55]) {
          const blob = await encode(canvas, quality);
          if (blob.size <= MAX_PHOTO_BYTES) return blob;
        }
        edge = Math.max(100, Math.floor(edge * 0.75));
      }
      throw new Error('Fotografiju nije moguće pripremiti. Pokušaj drugu JPG kopiju.');
    } finally { decoded.release(); canvas.width = 1; canvas.height = 1; }
  }
  function asDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Fotografija se nije mogla učitati.'));
      reader.readAsDataURL(blob);
    });
  }
  const api = { preparePhoto, asDataURL, acceptsPhoto, MAX_PHOTO_BYTES };
  root.PortfolioPhotos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
