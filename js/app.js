/* ------------------------------------------------------------
   app.js — wires the UI to the viewer, storage and PWA layers.
   ------------------------------------------------------------ */

import { Viewer } from './viewer.js';
import { loadPdfJs } from './pdf-loader.js';
import { prefs } from './storage.js';
import { setupPwa } from './pwa.js';
import * as recents from './recents.js';
import { extractDocument, formatPlainText, formatMarkdown } from './export.js';

/* ---------- element handles ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  body: document.body,
  root: document.documentElement,
  // toolbar
  openBtn: $('openBtn'),
  welcomeOpenBtn: $('welcomeOpenBtn'),
  installBtn: $('installBtn'),
  shareBtn: $('shareBtn'),
  docTitleWrap: $('docTitleWrap'),
  docTitle: $('docTitle'),
  fileInput: $('fileInput'),
  // share sheet
  shareSheet: $('shareSheet'),
  shareBackdrop: $('shareBackdrop'),
  sharePdfBtn: $('sharePdfBtn'),
  shareImgBtn: $('shareImgBtn'),
  copyTextBtn: $('copyTextBtn'),
  downloadMdBtn: $('downloadMdBtn'),
  shareCancel: $('shareCancel'),
  // stage
  stage: $('stage'),
  welcome: $('welcome'),
  dropzone: $('dropzone'),
  strip: $('strip'),
  recents: $('recents'),
  recentsList: $('recentsList'),
  recentsClear: $('recentsClear'),
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
  saveProgress(s.page);
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
  els.shareBtn.hidden = false;
  els.body.classList.add('has-doc');
}

/* ---------- current document ---------- */
// The original File/Blob currently open — kept so we can share it verbatim
// (never re-serialized from PDF.js).
let currentFile = null;
let currentName = 'document.pdf';

/* ---------- open a file ---------- */
async function openFile(file, opts = {}) {
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
    const startPage = opts.startPage != null ? opts.startPage : prefs.getLastPage(file.name);

    currentFile = file;
    currentName = file.name || 'document.pdf';

    enterReadingMode();
    showLoading(false);
    await viewer.open(doc, { name: currentName, startPage, fitWidth, scale, TextLayer: pdfjs.TextLayer });

    saveToRecents(file, doc.numPages, viewer.pageNum, opts.recentId);
    if (viewer.pageNum > 1) toast(`Resumed at page ${viewer.pageNum}`, 1600);
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

/* ---------- pinch-to-zoom & double-tap (Pointer Events) ---------- */
function setupPinch() {
  const scroll = els.canvasScroll;
  const holder = els.pageHolder;
  const pointers = new Map(); // pointerId -> { x, y }

  let pinching = false;
  let startDist = 1;
  let startScale = 1;
  let gesture = 1;
  let midX = 0, midY = 0;      // gesture midpoint in client coords

  // Double-tap tracking
  let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
  let downX = 0, downY = 0, downTime = 0, moved = false;

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Re-render at an absolute scale, keeping the given client point anchored.
  async function applyScaleAnchored(newScale, clientX, clientY) {
    const rect = scroll.getBoundingClientRect();
    const vx = clientX - rect.left;
    const vy = clientY - rect.top;
    const cx = scroll.scrollLeft + vx;
    const cy = scroll.scrollTop + vy;
    const from = viewer.scale;
    await viewer.setScale(newScale);
    const f = viewer.scale / from;
    scroll.scrollLeft = cx * f - vx;
    scroll.scrollTop = cy * f - vy;
  }

  function startPinch() {
    if (!viewer.isOpen) return;
    const [a, b] = [...pointers.values()];
    pinching = true;
    startDist = Math.max(1, distance(a, b));
    startScale = viewer.scale;
    gesture = 1;
    midX = (a.x + b.x) / 2;
    midY = (a.y + b.y) / 2;
    const rect = holder.getBoundingClientRect();
    holder.style.transformOrigin = `${midX - rect.left}px ${midY - rect.top}px`;
    document.body.classList.add('is-pinching');
  }

  async function endPinch() {
    pinching = false;
    document.body.classList.remove('is-pinching');
    const g = gesture;
    holder.style.transform = '';
    holder.style.transformOrigin = '';
    if (Math.abs(g - 1) < 0.02) return; // too small to matter
    await applyScaleAnchored(startScale * g, midX, midY);
  }

  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // pinch/tap are touch/pen only
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downX = e.clientX; downY = e.clientY; downTime = e.timeStamp; moved = false;
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  scroll.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) moved = true;
    } else if (pinching && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      let g = distance(a, b) / startDist;
      const minG = viewer.minScale / startScale;
      const maxG = viewer.maxScale / startScale;
      gesture = Math.min(maxG, Math.max(minG, g));
      holder.style.transform = `scale(${gesture})`;
    }
  });

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    const wasPinching = pinching;
    pointers.delete(e.pointerId);
    if (wasPinching && pointers.size < 2) { endPinch(); return; }
    if (wasPinching) return;

    // Single-pointer tap → double-tap detection
    if (e.pointerType === 'mouse') return;
    const quick = e.timeStamp - downTime < 300;
    if (!quick || moved) return;
    const now = e.timeStamp;
    const near = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40;
    if (now - lastTapTime < 300 && near) {
      lastTapTime = 0;
      handleDoubleTap(e.clientX, e.clientY);
    } else {
      lastTapTime = now; lastTapX = e.clientX; lastTapY = e.clientY;
    }
  }
  scroll.addEventListener('pointerup', onPointerEnd);
  scroll.addEventListener('pointercancel', (e) => {
    const wasPinching = pinching;
    pointers.delete(e.pointerId);
    if (wasPinching && pointers.size < 2) endPinch();
  });

  function handleDoubleTap(x, y) {
    if (!viewer.isOpen) return;
    window.getSelection()?.removeAllRanges();
    if (viewer.fitWidth) {
      applyScaleAnchored(viewer.scale * 2, x, y);   // fit → 2× at the tap point
    } else {
      viewer.setFitWidth();                          // zoomed → back to fit width
    }
  }
}

/* ---------- share ---------- */
function canShareFiles(files) {
  return !!(navigator.canShare && navigator.canShare({ files }));
}

/** Fallback when Web Share (with files) is unavailable: download instead. */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function openShareSheet() {
  if (!viewer.isOpen) return;
  els.shareSheet.hidden = false;
  requestAnimationFrame(() => els.shareSheet.classList.add('is-open'));
}
function closeShareSheet() {
  els.shareSheet.classList.remove('is-open');
  setTimeout(() => { els.shareSheet.hidden = true; }, 260);
}

async function sharePdf() {
  closeShareSheet();
  if (!currentFile) return;
  // Ensure a proper File with a name for the share sheet.
  const file =
    currentFile instanceof File
      ? currentFile
      : new File([currentFile], currentName, { type: 'application/pdf' });

  if (canShareFiles([file])) {
    try {
      await navigator.share({ files: [file], title: currentName });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Couldn’t open the share sheet');
    }
  } else {
    downloadBlob(file, currentName);
    toast('Sharing isn’t supported here — downloaded instead');
  }
}

function baseName(name) {
  return (name || 'document').replace(/\.pdf$/i, '');
}

async function sharePageImage() {
  closeShareSheet();
  if (!viewer.isOpen) return;
  const canvas = viewer.canvas;
  const fileName = `${baseName(currentName)}-p${viewer.pageNum}.png`;

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { toast('Couldn’t capture the page'); return; }

  const imgFile = new File([blob], fileName, { type: 'image/png' });
  if (canShareFiles([imgFile])) {
    try {
      await navigator.share({ files: [imgFile], title: fileName });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('Couldn’t open the share sheet');
    }
  } else {
    downloadBlob(imgFile, fileName);
    toast('Sharing isn’t supported here — image downloaded');
  }
}

/* ---------- LLM handoff: export text ---------- */
async function withExtractedText(run) {
  const pdf = viewer.pdf;
  if (!pdf) return;
  showLoading(true, 'Extracting text… 0%');
  try {
    const result = await extractDocument(pdf, (done, total) => {
      showLoading(true, `Extracting text… ${Math.round((done / total) * 100)}%`);
    });
    showLoading(false);
    await run(result);
  } catch (err) {
    console.error(err);
    showLoading(false);
    toast('Could not extract text from this PDF');
  }
}

function scannedSuffix(n) {
  return n ? ` · ${n} scanned page${n > 1 ? 's' : ''} skipped` : '';
}

function copyAllText() {
  closeShareSheet();
  return withExtractedText(async (result) => {
    const text = formatPlainText(result);
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${text.length.toLocaleString()} characters${scannedSuffix(result.emptyCount)}`);
    } catch {
      // Clipboard blocked (no permission / lost gesture) — download instead.
      downloadBlob(new Blob([text], { type: 'text/plain' }), `${baseName(currentName)}.txt`);
      toast(`Clipboard unavailable — downloaded .txt instead${scannedSuffix(result.emptyCount)}`);
    }
  });
}

function downloadMarkdown() {
  closeShareSheet();
  return withExtractedText(async (result) => {
    const md = formatMarkdown(result);
    downloadBlob(new Blob([md], { type: 'text/markdown' }), `${baseName(currentName)}.md`);
    toast(`Downloaded ${baseName(currentName)}.md${scannedSuffix(result.emptyCount)}`);
  });
}

function setupShare() {
  els.shareBtn.addEventListener('click', openShareSheet);
  els.shareBackdrop.addEventListener('click', closeShareSheet);
  els.shareCancel.addEventListener('click', closeShareSheet);
  els.sharePdfBtn.addEventListener('click', sharePdf);
  els.shareImgBtn.addEventListener('click', sharePageImage);
  els.copyTextBtn.addEventListener('click', copyAllText);
  els.downloadMdBtn.addEventListener('click', downloadMarkdown);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.shareSheet.hidden) closeShareSheet();
  });
}

/* ---------- OS integration: file handlers & share target ---------- */
const SHARE_CACHE = 'pocketpdf-share';
const SHARE_KEY = './__shared-pdf';

// PDFs opened via the OS "Open with…" list arrive through the launch queue.
function setupFileHandling() {
  if ('launchQueue' in window && 'setConsumer' in window.launchQueue) {
    window.launchQueue.setConsumer(async (launchParams) => {
      const handles = launchParams && launchParams.files;
      if (!handles || !handles.length) return;
      try {
        const file = await handles[0].getFile();
        openFile(file);
      } catch (err) {
        console.error(err);
      }
    });
  }
}

// A PDF shared *into* the app is stashed in a cache by the service worker;
// pick it up on load, open it, and tidy the URL.
async function consumeSharedFile() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (res) {
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-filename') || 'shared.pdf');
      await cache.delete(SHARE_KEY);
      openFile(new File([blob], name, { type: blob.type || 'application/pdf' }));
    }
  } catch {
    /* nothing shared, or cache unavailable */
  }
  if (location.search) {
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

/* ---------- recents (IndexedDB) ---------- */
let currentRecentId = null;
let progressTimer = null;

function recentId(file) {
  return `${file.name || 'document.pdf'}|${file.size || 0}|${file.lastModified || 0}`;
}

async function saveToRecents(file, pageCount, lastPage, forcedId) {
  // Never persist very large files — just open them.
  if (!file || file.size > recents.MAX_FILE_BYTES) { currentRecentId = null; return; }
  // Reuse the existing id when reopening a recent so we update, not duplicate.
  currentRecentId = forcedId || recentId(file);
  try {
    await recents.put({
      id: currentRecentId,
      name: file.name || 'document.pdf',
      size: file.size,
      pageCount,
      lastPage,
      blob: file,
    });
    refreshRecents();
  } catch { /* storage unavailable */ }
}

function saveProgress(page) {
  if (!currentRecentId) return;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => recents.updatePage(currentRecentId, page).catch(() => {}), 600);
}

function relativeTime(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w} wk${w > 1 ? 's' : ''} ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

const FILE_ICON =
  '<svg class="recent__icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M14 2v6h6"/></svg>';
const X_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

async function refreshRecents() {
  let entries = [];
  try { entries = await recents.list(); } catch { entries = []; }
  els.recentsList.replaceChildren();
  if (!entries.length) {
    els.recents.hidden = true;
    els.strip.hidden = true;
    return;
  }
  els.recents.hidden = false;
  els.strip.hidden = false;

  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'recent';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent__open';
    const pages = e.pageCount ? `${e.pageCount} page${e.pageCount > 1 ? 's' : ''}` : '';
    open.innerHTML =
      `${FILE_ICON}<span class="recent__meta">` +
      `<span class="recent__name"></span>` +
      `<span class="recent__sub"></span></span>`;
    open.querySelector('.recent__name').textContent = e.name;
    open.querySelector('.recent__sub').textContent =
      [pages, relativeTime(e.updatedAt)].filter(Boolean).join(' · ');
    open.addEventListener('click', () => reopenRecent(e));

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'recent__remove';
    rm.setAttribute('aria-label', `Remove ${e.name}`);
    rm.title = 'Remove';
    rm.innerHTML = X_ICON;
    rm.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await recents.remove(e.id);
      refreshRecents();
    });

    // Long-press also removes (mobile affordance).
    let lpTimer = null;
    open.addEventListener('touchstart', () => {
      lpTimer = setTimeout(async () => { await recents.remove(e.id); refreshRecents(); }, 600);
    }, { passive: true });
    const cancelLp = () => clearTimeout(lpTimer);
    open.addEventListener('touchend', cancelLp);
    open.addEventListener('touchmove', cancelLp);

    li.append(open, rm);
    els.recentsList.append(li);
  }
}

async function reopenRecent(entry) {
  const blob = await recents.getBlob(entry.id);
  if (!blob) { await recents.remove(entry.id); refreshRecents(); toast('That file is no longer available'); return; }
  const file = new File([blob], entry.name, { type: 'application/pdf' });
  openFile(file, { startPage: entry.lastPage || 1, recentId: entry.id });
}

function setupRecents() {
  els.recentsClear.addEventListener('click', async () => {
    await recents.clear();
    refreshRecents();
  });
  refreshRecents();
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
  setupPinch();
  setupShare();

  setupPwa({
    installBtn: els.installBtn,
    onInstallable: (yes) => { els.installBtn.hidden = !yes; },
    toast,
  });
}

/* ---------- boot ---------- */
wire();
setupRecents();
setupFileHandling();
consumeSharedFile();
