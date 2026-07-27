/**
 * PDF → plan image using Mozilla PDF.js (CDN).
 * Renders one page at a time to a PNG data URL for the takeoff canvas.
 */
(function () {
  // Prefer local vendor copy (offline desktop app); fall back to CDN
  const LOCAL = 'vendor/pdfjs';
  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
  let loadPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          await loadScript(`${LOCAL}/pdf.min.js`);
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${LOCAL}/pdf.worker.min.js`;
        } catch (e) {
          await loadScript(`${CDN}/pdf.min.js`);
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`;
        }
        if (!window.pdfjsLib) throw new Error('pdfjsLib not available');
        return window.pdfjsLib;
      })();
    }
    return loadPromise;
  }

  async function openPdf(source) {
    const pdfjsLib = await ensurePdfJs();
    let data;
    if (source instanceof ArrayBuffer) {
      data = { data: new Uint8Array(source) };
    } else if (source instanceof Uint8Array) {
      data = { data: source };
    } else if (typeof source === 'string') {
      data = { url: source };
    } else if (source instanceof Blob || source instanceof File) {
      const buf = await source.arrayBuffer();
      data = { data: new Uint8Array(buf) };
    } else {
      throw new Error('Unsupported PDF source');
    }
    return pdfjsLib.getDocument(data).promise;
  }

  async function renderPageToDataUrl(pdf, pageNumber, scale = 2.0) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
      pageNumber,
      pageCount: pdf.numPages,
    };
  }

  async function pickAndRender(pdf, preferredPage = 1) {
    let pageNum = preferredPage;
    if (pdf.numPages > 1) {
      const input = window.prompt(
        `This PDF has ${pdf.numPages} pages.\nEnter page number to load (1–${pdf.numPages}):`,
        String(Math.min(preferredPage, pdf.numPages))
      );
      if (input == null) return null;
      pageNum = parseInt(input, 10);
      if (!pageNum || pageNum < 1 || pageNum > pdf.numPages) {
        throw new Error(`Invalid page number (use 1–${pdf.numPages})`);
      }
    }
    return renderPageToDataUrl(pdf, pageNum, 2.5);
  }

  async function fromFile(file, preferredPage = 1) {
    const pdf = await openPdf(file);
    return pickAndRender(pdf, preferredPage);
  }

  async function fromArrayBuffer(buffer, preferredPage = 1) {
    const pdf = await openPdf(buffer);
    return pickAndRender(pdf, preferredPage);
  }

  async function fromUrl(url, preferredPage = 1) {
    const pdf = await openPdf(url);
    return pickAndRender(pdf, preferredPage);
  }

  async function renderAllPages(source, maxPages = 40, scale = 2.0) {
    const pdf = await openPdf(source);
    const n = Math.min(pdf.numPages, maxPages);
    const pages = [];
    for (let i = 1; i <= n; i++) {
      pages.push(await renderPageToDataUrl(pdf, i, scale));
    }
    return { pageCount: pdf.numPages, pages, truncated: pdf.numPages > maxPages };
  }

  window.PTPdf = {
    ensurePdfJs,
    openPdf,
    renderPageToDataUrl,
    pickAndRender,
    fromFile,
    fromArrayBuffer,
    fromUrl,
    renderAllPages,
  };
})();
