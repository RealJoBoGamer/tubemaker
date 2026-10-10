/* PNG / PDF / SVG export and thumbnails. */
(function () {
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  // Fonts must be embedded in the SVG, or the browser renders the image with a fallback font.
  let fontCSSPromise = null;
  const FONTS = [['London Tube', 'assets/fonts/london-tube.ttf', 'truetype'], ['Railway', 'assets/fonts/railway.woff', 'woff']];
  function fontCSS() {
    if (!fontCSSPromise) {
      fontCSSPromise = Promise.all(FONTS.map(([name, url, fmt]) => fetch(url)
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error('font'))))
        .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
        .then(data => `@font-face{font-family:'${name}';src:url(${data}) format('${fmt}');}`)
        .catch(() => ''))).then(parts => parts.join(''));
    }
    return fontCSSPromise;
  }

  async function svgToCanvas(doc, pixelWidth) {
    const scale = pixelWidth / doc.width;
    const svg = window.TubeRender.renderSVG(doc, { scale, fontCSS: await fontCSS() });
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(doc.width * scale);
        canvas.height = Math.round(doc.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = doc.settings.background || '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the map image.')); };
      img.src = url;
    });
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function safeName(doc) {
    return (doc.title || 'tube-map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'tube-map';
  }

  async function exportPNG(doc, scale = 2) {
    const canvas = await svgToCanvas(doc, doc.width * scale);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    download(blob, safeName(doc) + '.png');
  }

  async function exportSVG(doc) {
    const svg = window.TubeRender.renderSVG(doc, { scale: 1, fontCSS: await fontCSS() });
    download(new Blob([svg], { type: 'image/svg+xml' }), safeName(doc) + '.svg');
  }

  function exportJSON(doc) {
    download(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }), safeName(doc) + '.tubemap.json');
  }

  let jspdfPromise = null;
  function loadJsPDF() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!jspdfPromise) {
      jspdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = JSPDF_URL;
        s.onload = () => resolve(window.jspdf);
        s.onerror = () => { jspdfPromise = null; reject(new Error('Could not load the PDF library (check your internet connection).')); };
        document.head.appendChild(s);
      });
    }
    return jspdfPromise;
  }

  // ISO paper sizes in mm (landscape)
  const PAPER = { a4: [297, 210], a3: [420, 297], a2: [594, 420], a1: [841, 594], a0: [1189, 841] };

  async function exportPDF(doc, paper = 'a3') {
    const { jsPDF } = await loadJsPDF();
    const [pw, ph] = PAPER[paper] || PAPER.a3;
    // ~200 dpi raster keeps files reasonable while staying crisp in print
    const pxWidth = Math.min(9000, Math.round(pw / 25.4 * 200));
    const canvas = await svgToCanvas(doc, pxWidth);
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [pw, ph], compress: true });
    const margin = 8;
    const availW = pw - margin * 2, availH = ph - margin * 2;
    const ratio = Math.min(availW / doc.width, availH / doc.height);
    const w = doc.width * ratio, h = doc.height * ratio;
    pdf.setProperties({ title: doc.title || 'Tube map', creator: 'TubeMaker' });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST');
    pdf.save(safeName(doc) + '.pdf');
  }

  async function thumbnail(doc, width = 1200) {
    // crop to what is actually drawn so small maps don't become tiny thumbnails
    const copy = JSON.parse(JSON.stringify(doc));
    const b = window.TubeDoc.contentBounds(copy);
    if (b && (b.x1 - b.x0 < doc.width * 0.8 || b.y1 - b.y0 < doc.height * 0.8)) window.TubeDoc.fitToContent(copy, 40);
    const canvas = await svgToCanvas(copy, width);
    return canvas.toDataURL('image/png');
  }

  window.TubeExport = { fontCSS, exportPNG, exportPDF, exportSVG, exportJSON, thumbnail, download, PAPER };
})();
