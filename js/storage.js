/* ------------------------------------------------------------
   storage.js — lightweight preferences in localStorage.
   Nothing here touches document contents; only theme, zoom
   preference, and the last page seen per filename are kept.
   ------------------------------------------------------------ */

const NS = 'pocketpdf';
const KEY_THEME = `${NS}:theme`;
const KEY_ZOOM = `${NS}:zoom`;
const KEY_PAGE = (name) => `${NS}:page:${name}`;

/** Safe read — returns fallback if storage is blocked (private mode, etc). */
function read(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable — preferences simply won't persist */
  }
}

export const prefs = {
  // Theme: 'light' | 'dark' | null (follow system)
  getTheme() {
    const t = read(KEY_THEME);
    return t === 'light' || t === 'dark' ? t : null;
  },
  setTheme(theme) {
    write(KEY_THEME, theme);
  },

  // Zoom preference: 'fit' or a numeric scale string
  getZoom() {
    return read(KEY_ZOOM, 'fit');
  },
  setZoom(zoom) {
    write(KEY_ZOOM, zoom);
  },

  // Last page per filename
  getLastPage(name) {
    if (!name) return 1;
    const n = parseInt(read(KEY_PAGE(name), '1'), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  },
  setLastPage(name, page) {
    if (!name) return;
    write(KEY_PAGE(name), page);
  },
};
