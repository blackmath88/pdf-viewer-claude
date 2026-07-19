/* ------------------------------------------------------------
   viewer.js — single-page PDF rendering engine.

   Holds the in-memory document, current page, rotation and
   zoom state, and paints one page at a time onto a canvas with
   device-pixel-ratio awareness for crisp text.
   ------------------------------------------------------------ */

const ZOOM_STEP = 1.2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const FIT_PADDING = 32; // horizontal breathing room inside the scroll area (px)

export class Viewer {
  /**
   * @param {object} els  { scroll, holder, canvas }
   * @param {object} hooks { onState(state), onError(message) }
   */
  constructor(els, hooks = {}) {
    this.scroll = els.scroll;
    this.holder = els.holder;
    this.canvas = els.canvas;
    this.textLayerEl = els.textLayer || null;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.hooks = hooks;

    this.pdf = null;
    this.name = '';
    this.pageNum = 1;
    this.pageCount = 0;
    this.rotation = 0;         // 0 | 90 | 180 | 270
    this.fitWidth = true;      // when true, scale is derived from viewport width
    this.scale = 1;            // effective scale used for the last render
    this.TextLayer = null;     // PDF.js TextLayer class (enables text selection)
    this._renderTask = null;
    this._textLayer = null;
    this._pageCache = new Map();
    this._renderToken = 0;
  }

  get isOpen() { return !!this.pdf; }

  /** Load a already-parsed PDF document. */
  async open(pdf, { name = '', startPage = 1, fitWidth = true, scale = 1, TextLayer = null } = {}) {
    this._destroyDoc();
    this.pdf = pdf;
    this.name = name;
    this.pageCount = pdf.numPages;
    this.pageNum = Math.min(Math.max(1, startPage), this.pageCount);
    this.rotation = 0;
    this.fitWidth = fitWidth;
    this.scale = scale;
    if (TextLayer) this.TextLayer = TextLayer;
    await this.render();
    this._emit();
  }

  close() {
    this._destroyDoc();
    this._clearCanvas();
    this._emit();
  }

  _destroyDoc() {
    this._cancelRender();
    this._pageCache.clear();
    if (this.pdf) {
      try { this.pdf.destroy(); } catch { /* ignore */ }
    }
    this.pdf = null;
    this.name = '';
    this.pageCount = 0;
    this.pageNum = 1;
  }

  async _getPage(n) {
    if (this._pageCache.has(n)) return this._pageCache.get(n);
    const p = await this.pdf.getPage(n);
    this._pageCache.set(n, p);
    return p;
  }

  _cancelRender() {
    if (this._renderTask) {
      try { this._renderTask.cancel(); } catch { /* ignore */ }
      this._renderTask = null;
    }
    this._cancelTextLayer();
  }

  _cancelTextLayer() {
    if (this._textLayer) {
      try { this._textLayer.cancel(); } catch { /* ignore */ }
      this._textLayer = null;
    }
  }

  /** Compute the scale to fit the page width into the scroll area. */
  _fitScale(page) {
    const base = page.getViewport({ scale: 1, rotation: this.rotation });
    const avail = Math.max(120, this.scroll.clientWidth - FIT_PADDING);
    return avail / base.width;
  }

  /** Render the current page. Cancels any in-flight render first. */
  async render(resetScroll = true) {
    if (!this.pdf) return;
    const token = ++this._renderToken;
    this._cancelRender();

    let page;
    try {
      page = await this._getPage(this.pageNum);
    } catch (err) {
      if (token === this._renderToken) this.hooks.onError?.('Could not read that page.');
      return;
    }
    if (token !== this._renderToken) return; // superseded

    const scale = this.fitWidth ? this._fitScale(page) : this.scale;
    this.scale = scale;

    const viewport = page.getViewport({ scale, rotation: this.rotation });
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    // Drop the previous page's selectable text immediately so stale, wrongly
    // positioned spans never flash over the new page.
    this._clearTextLayer();

    this.canvas.width = Math.floor(viewport.width * dpr);
    this.canvas.height = Math.floor(viewport.height * dpr);
    this.canvas.style.width = `${Math.floor(viewport.width)}px`;
    this.canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderContext = {
      canvasContext: this.ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      background: '#ffffff',
    };

    try {
      this._renderTask = page.render(renderContext);
      await this._renderTask.promise;
      this._renderTask = null;
    } catch (err) {
      if (err && err.name === 'RenderingCancelledException') return; // expected on rapid changes
      if (token === this._renderToken) this.hooks.onError?.('Could not render that page.');
      return;
    }

    if (token === this._renderToken) {
      // Reset scroll to top for a fresh reading position on page changes;
      // zoom/pinch keep their anchor and set the scroll themselves.
      if (resetScroll) this.scroll.scrollTop = 0;
      // Overlay a selectable text layer so users can select & copy text.
      this._renderTextLayer(page, viewport, token);
    }
  }

  /** Build the transparent, selectable text overlay for the current page. */
  async _renderTextLayer(page, viewport, token) {
    const el = this.textLayerEl;
    if (!el || !this.TextLayer) return;

    this._cancelTextLayer();
    el.replaceChildren();
    el.style.setProperty('--scale-factor', String(viewport.scale));

    let layer;
    try {
      layer = new this.TextLayer({
        textContentSource: page.streamTextContent(),
        container: el,
        viewport,
      });
      this._textLayer = layer;
      await layer.render();
    } catch (err) {
      // Cancellation is expected on rapid page changes; any other failure
      // just means this page isn't selectable — never fatal to reading.
      return;
    }
    if (token !== this._renderToken) this._clearTextLayer();
  }

  _clearTextLayer() {
    this._cancelTextLayer();
    if (this.textLayerEl) this.textLayerEl.replaceChildren();
  }

  _clearCanvas() {
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas.style.width = '';
    this.canvas.style.height = '';
    this._clearTextLayer();
  }

  /* ---- navigation ---- */
  async goTo(n) {
    if (!this.pdf) return;
    const target = Math.min(Math.max(1, Math.round(n)), this.pageCount);
    if (target === this.pageNum) { this._emit(); return; }
    this.pageNum = target;
    await this.render();
    this._emit();
  }
  next() { return this.goTo(this.pageNum + 1); }
  prev() { return this.goTo(this.pageNum - 1); }
  first() { return this.goTo(1); }
  last() { return this.goTo(this.pageCount); }

  /* ---- zoom ---- */
  async setFitWidth() {
    this.fitWidth = true;
    await this.render();
    this._emit();
  }
  async zoomIn() { return this._zoomBy(ZOOM_STEP); }
  async zoomOut() { return this._zoomBy(1 / ZOOM_STEP); }

  // Scale limits, exposed so gesture code can clamp a live pinch.
  get minScale() { return MIN_SCALE; }
  get maxScale() { return MAX_SCALE; }

  /** Set an absolute scale (used by pinch-zoom and double-tap). Preserves
   *  scroll so the caller can anchor to the gesture midpoint. */
  async setScale(scale) {
    if (!this.pdf) return;
    this.fitWidth = false;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    await this.render(false);
    this._emit();
  }

  async _zoomBy(factor) {
    if (!this.pdf) return;
    // If currently fit-to-width, anchor the manual scale to the present scale.
    const from = this.scale;
    this.fitWidth = false;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, from * factor));
    await this.render();
    this._emit();
  }

  /* ---- rotate ---- */
  async rotateCW() {
    if (!this.pdf) return;
    this.rotation = (this.rotation + 90) % 360;
    await this.render();
    this._emit();
  }

  /** Re-render (used on container resize when fit-to-width is active). */
  async refit() {
    if (this.pdf && this.fitWidth) await this.render();
  }

  /** Percentage label for the zoom control. */
  zoomLabel() {
    if (this.fitWidth) return 'Fit';
    return `${Math.round(this.scale * 100)}%`;
  }

  _emit() {
    this.hooks.onState?.({
      isOpen: this.isOpen,
      name: this.name,
      page: this.pageNum,
      count: this.pageCount,
      zoomLabel: this.zoomLabel(),
      fitWidth: this.fitWidth,
    });
  }
}
