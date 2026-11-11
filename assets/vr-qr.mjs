/* Optional local QR rendering. No URL or location is sent to a QR service. */
const vendorURL = new URL('./qr-generator-1.4.4.js', import.meta.url);
const integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
let encoderTask;

function loadEncoder() {
  if (encoderTask) return encoderTask;
  encoderTask = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = vendorURL.href;
    script.integrity = integrity;
    script.crossOrigin = 'anonymous';
    script.referrerPolicy = 'no-referrer';
    script.async = true;
    const finish = error => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      if (error) reject(new Error('Local QR generator unavailable'));
      else resolve(window.qrcode);
    };
    const timer = setTimeout(() => finish(true), 10000);
    script.onload = () => finish(typeof window.qrcode !== 'function');
    script.onerror = () => finish(true);
    document.head.append(script);
  }).catch(error => { encoderTask = null; throw error; });
  return encoderTask;
}

export async function createQRCanvas(url) {
  // URL serialization percent-encodes non-ASCII input; bound QR CPU/memory.
  if (typeof url !== 'string' || url.length > 1024 || !/^[\x20-\x7e]+$/.test(url)) {
    throw new Error('Share link cannot be encoded');
  }
  const encode = await loadEncoder(), qr = encode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  const count = qr.getModuleCount(), quiet = 4, scale = 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (count + quiet * 2) * scale;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'QR code for the selected location and forecast');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('QR drawing unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) {
    if (qr.isDark(row, column)) context.fillRect((column + quiet) * scale, (row + quiet) * scale, scale, scale);
  }
  return canvas;
}
