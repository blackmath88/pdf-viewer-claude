/* ------------------------------------------------------------
   pdf-loader.js — loads the Mozilla PDF.js runtime.

   PDF.js is vendored locally under /vendor/pdfjs so the reader
   is fully self-contained: no CDN, no third-party network call,
   and it works offline the moment the shell is cached. Paths are
   resolved relative to this module, so the app also works from a
   sub-path (e.g. a GitHub Pages project site).

   To use a CDN build instead, point PDFJS_BASE at it, e.g.
     const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/';
   ------------------------------------------------------------ */

const PDFJS_BASE = new URL('../vendor/pdfjs/', import.meta.url);
const PDF_MODULE = new URL('pdf.min.mjs', PDFJS_BASE);
const PDF_WORKER = new URL('pdf.worker.min.mjs', PDFJS_BASE);

let pdfjsPromise = null;

/** Lazily import PDF.js and configure its worker. Cached after first call. */
export function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDF_MODULE.href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER.href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}
