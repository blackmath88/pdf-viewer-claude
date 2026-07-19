/* ------------------------------------------------------------
   app.js — wires the UI to the viewer, storage and PWA layers.
   ------------------------------------------------------------ */

import { Viewer } from './viewer.js';
import { loadPdfJs } from './pdf-loader.js';
import { prefs } from './storage.js';
import { setupPwa } from './pwa.js';

/* ---------- element handles ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  body: document.body,
  root: document.documentElement,
  // toolbar
  openBtn: $('openBtn'),
  welcomeOpenBtn: $('welcomeOpenBtn'),
  themeBtn: $('themeBtn'),
  installBtn: $('installBtn'),
  docTitleWrap: $('docTitleWrap'),
  docTitle: $('docTitle'),
  fileInput: $('fileInput'),
  // stage
  stage: $('stage'),
  welcome: $('welcome'),
  dropzone: $('dropzone'),
  loading: $('loading'),
  loadingText: $('loadingText'),
  errorState: $('errorState'),
  errorText: $('errorText'),
  errorDismiss: $('errorDismiss'),
  dragVeil: $('dragVeil'),
  canvasScroll: $('canvasScroll'),
  pageHolder: $('pageHolder'),
  pageCanvas: $('pageCanvas'),
  textLayer: $('textLayer'),
  // controls
  controls: $('controls'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  pageInput: $('pageInput'),
  pageTotal: $('pageTotal'),
  zoomOutBtn: $('zoomOutBtn'),
  zoomInBtn: $('zoomInBtn'),
  fitBtn: $('fitBtn'),
  zoomLabel: $('zoomLabel'),
  rotateBtn: $('rotateBtn'),
  fsBtn: $('fsBtn'),
  toast: $('toast'),
};

/* ---------- toast ---------- */
let toastTimer = null;
function toast(message, ms = 2200) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => { els.toast.hidden = true; }, 220);
  }, ms);
}

/* ---------- theme ---------- */
function applyTheme(theme) {
  // theme: 'light' | 'dark' | null(system)
  const resolved =
    theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  els.root.setAttribute('data-theme', resolved);
}
function initTheme() {
  applyTheme(prefs.getTheme());
  // Follow the system if the user hasn't chosen explicitly.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!prefs.getTheme()) applyTheme(null);
  });
}
function toggleTheme() {
  const current = els.root.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  prefs.setTheme(next);
  applyTheme(next);
  toast(next === 'dark' ? 'Dark theme' : 'Light theme', 1200);
}

/* ---------- viewer ---------- */
const viewer = new Viewer(
  { scroll: els.canvasScroll, holder: els.pageHolder, canvas: els.pageCanvas, textLayer: els.textLayer },
  { onState: renderState, onError: showError }
);

function renderState(s) {
  if (!s.isOpen) return;
  // Toolbar title
  els.docTitle.textContent = s.name;
  els.docTitle.title = s.name;

  // Pager
  if (document.activeElement !== els.pageInput) els.pageInput.value = String(s.page);
  els.pageTotal.textContent = String(s.count);
  els.prevBtn.disabled = s.page <= 1;
  els.nextBtn.disabled = s.page >= s.count;

  // Zoom label
  els.zoomLabel.textContent = s.zoomLabel;
  els.fitBtn.setAttribute('aria-pressed', String(s.fitWidth));

  // Persist reading position + zoom preference
  prefs.setLastPage(s.name, s.page);
  prefs.setZoom(s.fitWidth ? 'fit' : String(viewer.scale));
}

/* ---------- UI mode switches ---------- */
function showLoading(on, text = 'Opening document…') {
  els.loadingText.textContent = text;
  els.loading.hidden = !on;
}
function showError(message) {
  showLoading(false);
  els.errorText.textContent = message || 'Something went wrong.';
  els.errorState.hidden = false;
}
function dismissError() { els.errorState.hidden = true; }

function enterReadingMode() {
  els.welcome.hidden = true;
  els.canvasScroll.hidden = false;
  els.controls.hidden = false;
  els.docTitleWrap.hidden = false;
  els.body.classList.add('has-doc');
}

/* ---------- open a file ---------- */
async function openFile(file) {
  if (!file) return;
  const looksPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!looksPdf) {
    showError('That doesn’t look like a PDF file.');
    return;
  }

  dismissError();
  showLoading(true);

  try {
    const [pdfjs, data] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
    const doc = await pdfjs.getDocument({
      data,
      // Keep everything local; disable any range/stream fetching.
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
    }).promise;

    const zoomPref = prefs.getZoom();
    const fitWidth = zoomPref === 'fit';
    const scale = fitWidth ? 1 : (parseFloat(zoomPref) || 1);
    const startPage = prefs.getLastPage(file.name);

    enterReadingMode();
    showLoading(false);
    await viewer.open(doc, { name: file.name, startPage, fitWidth, scale, TextLayer: pdfjs.TextLayer });

    if (startPage > 1) toast(`Resumed at page ${startPage}`, 1600);
  } catch (err) {
    console.error(err);
    let msg = 'Could not open this PDF.';
    if (err && err.name === 'PasswordException') msg = 'This PDF is password-protected and can’t be opened.';
    else if (err && err.name === 'InvalidPDFException') msg = 'This file appears to be a damaged or invalid PDF.';
    showError(msg);
  }
}

function pickFile() { els.fileInput.click(); }

/* ---------- drag & drop ---------- */
let dragDepth = 0;
function setupDragDrop() {
  const isFileDrag = (e) =>
    e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    els.dragVeil.classList.add('is-active');
    els.dropzone?.classList.add('is-dragover');
  });
  window.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      els.dragVeil.classList.remove('is-active');
      els.dropzone?.classList.remove('is-dragover');
    }
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragDepth = 0;
    els.dragVeil.classList.remove('is-active');
    els.dropzone?.classList.remove('is-dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) openFile(file);
  });
}

/* ---------- swipe gestures (touch) ---------- */
function setupSwipe() {
  const SWIPE_MIN = 55;   // px of horizontal travel to count as a swipe
  const RATIO = 1.6;      // horizontal must dominate vertical by this factor
  const MAX_MS = 700;     // quick flick, not a slow drag/selection

  let sx = 0, sy = 0, st = 0, tracking = false;

  els.canvasScroll.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; } // ignore pinch
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = e.timeStamp; tracking = true;
  }, { passive: true });

  els.canvasScroll.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) tracking = false; // became a pinch
  }, { passive: true });

  els.canvasScroll.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    if (!viewer.isOpen) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const dt = e.timeStamp - st;

    if (dt > MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * RATIO) return;

    // Don't turn the page if the user was selecting text…
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) return;
    // …or if the page is zoomed wide enough to pan horizontally.
    if (els.canvasScroll.scrollWidth > els.canvasScroll.clientWidth + 4) return;

    if (dx < 0) viewer.next();
    else viewer.prev();
  }, { passive: true });
}

/* ---------- fullscreen ---------- */
function toggleFullscreen() {
  const target = document.documentElement;
  if (!document.fullscreenElement) {
    (target.requestFullscreen?.() || Promise.reject()).catch(() => {
      // iOS Safari has no Fullscreen API — fall back to a class-based mode.
      els.body.classList.toggle('is-fullscreen');
    });
  } else {
    document.exitFullscreen?.();
  }
}
document.addEventListener('fullscreenchange', () => {
  els.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
});

/* ---------- pager input ---------- */
function commitPageInput() {
  const n = parseInt(els.pageInput.value, 10);
  if (Number.isFinite(n)) viewer.goTo(n);
  else els.pageInput.value = String(viewer.pageNum);
}

/* ---------- keyboard shortcuts ---------- */
function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Don't hijack typing in the page input.
    if (e.target === els.pageInput) {
      if (e.key === 'Enter') { commitPageInput(); els.pageInput.blur(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.next(); break;
      case 'ArrowLeft':
      case 'PageUp':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.prev(); break;
      case 'Home':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.first(); break;
      case 'End':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.last(); break;
      case '+':
      case '=':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.zoomIn(); break;
      case '-':
      case '_':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.zoomOut(); break;
      case '0':
        if (!viewer.isOpen) return;
        e.preventDefault(); viewer.setFitWidth(); break;
      case 'r':
      case 'R':
        if (!viewer.isOpen) return;
        viewer.rotateCW(); break;
      case 'f':
      case 'F':
        if (!viewer.isOpen) return;
        toggleFullscreen(); break;
      case 't':
      case 'T':
        toggleTheme(); break;
      case 'o':
      case 'O':
        e.preventDefault(); pickFile(); break;
      default: break;
    }
  });
}

/* ---------- resize refit (debounced) ---------- */
function setupResize() {
  let t = null;
  const onResize = () => {
    clearTimeout(t);
    t = setTimeout(() => viewer.refit(), 150);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

/* ---------- wire events ---------- */
function wire() {
  els.openBtn.addEventListener('click', pickFile);
  els.welcomeOpenBtn.addEventListener('click', pickFile);
  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    openFile(file);
    e.target.value = ''; // allow re-opening the same file
  });

  els.themeBtn.addEventListener('click', toggleTheme);
  els.errorDismiss.addEventListener('click', dismissError);

  els.prevBtn.addEventListener('click', () => viewer.prev());
  els.nextBtn.addEventListener('click', () => viewer.next());
  els.pageInput.addEventListener('blur', commitPageInput);
  els.pageInput.addEventListener('focus', () => els.pageInput.select());

  els.zoomInBtn.addEventListener('click', () => viewer.zoomIn());
  els.zoomOutBtn.addEventListener('click', () => viewer.zoomOut());
  els.fitBtn.addEventListener('click', () => viewer.setFitWidth());
  els.rotateBtn.addEventListener('click', () => viewer.rotateCW());
  els.fsBtn.addEventListener('click', toggleFullscreen);

  setupDragDrop();
  setupKeyboard();
  setupResize();
  setupSwipe();

  setupPwa({
    installBtn: els.installBtn,
    onInstallable: (yes) => { els.installBtn.hidden = !yes; },
    toast,
  });
}

/* ---------- boot ---------- */
initTheme();
wire();
