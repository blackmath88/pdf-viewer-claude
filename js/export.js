/* ------------------------------------------------------------
   export.js — extract a document's text for handing off to an LLM.

   Uses only PDF.js page.getTextContent() (no new dependencies).
   Text items are grouped into lines by their baseline (transform Y)
   and joined with spaces based on horizontal gaps. A light heading
   heuristic marks unusually large lines. Pages with no text layer
   (scanned images) are counted and flagged — never OCR'd.
   ------------------------------------------------------------ */

/** Group a page's text items into lines using baseline (Y) + x-gaps.
 *
 *  A space is inserted between two items on the same baseline only when the
 *  horizontal gap exceeds 0.25 × font size; contiguous glyph runs (kerning
 *  gaps of a few percent) concatenate directly. This is the whole fix for
 *  spurious intra-word spaces like "Mus eum" — a single proportional
 *  threshold, no dictionaries or language rules. Letter-spaced runs may keep
 *  their gaps, which is acceptable. `gap = x − (prevX + prevWidth)` and
 *  `fontSize = hypot(transform[0], transform[1])` (robust to rotation).
 */
function groupLines(items) {
  const lines = [];
  let cur = null;
  let lastEndX = 0;

  for (const it of items) {
    const s = it.str || '';
    if (s) {
      const t = it.transform;
      const x = t[4];
      const y = t[5];
      // Horizontal font size (basis vector length); handles rotation too.
      const fontSize = Math.hypot(t[0], t[1]) || it.height || 0;

      if (cur === null || Math.abs(y - cur.y) > Math.max(2, (fontSize || cur.size) * 0.5)) {
        cur = { text: s, size: fontSize, y };
        lines.push(cur);
      } else {
        const gap = x - lastEndX; // x − (prevX + prevWidth)
        const glued = /\s$/.test(cur.text) || /^\s/.test(s);
        const sep = !glued && gap > 0.25 * (fontSize || cur.size) ? ' ' : '';
        cur.text += sep + s;
        if (fontSize > cur.size) cur.size = fontSize;
      }
      lastEndX = x + (it.width || 0);
    }
    if (it.hasEOL) cur = null; // the next item begins a new line
  }

  // Trivial de-hyphenation: "exam-\nple" → "example".
  const merged = [];
  for (const l of lines) {
    l.text = l.text.trim();
    const prev = merged[merged.length - 1];
    if (prev && /[A-Za-z]-$/.test(prev.text) && /^[a-z]/.test(l.text)) {
      prev.text = prev.text.replace(/-$/, '') + l.text;
    } else if (l.text) {
      merged.push(l);
    }
  }
  return merged;
}

function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Extract all pages. Calls onProgress(done, total) after each page and yields
 * to the event loop so the UI stays responsive on large documents.
 * @returns {{ pages: Array, medianFont: number, emptyCount: number }}
 */
export async function extractDocument(pdf, onProgress) {
  const pages = [];
  const sizes = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const lines = groupLines(tc.items);
    for (const l of lines) sizes.push(l.size);
    const text = lines.map((l) => l.text).join('\n').trim();
    pages.push({ num: i, lines, text, empty: !text });
    onProgress?.(i, pdf.numPages);
    await new Promise((r) => setTimeout(r)); // keep the UI responsive
  }

  const medianFont = median(sizes);
  const threshold = medianFont * 1.3;
  for (const p of pages) {
    for (const l of p.lines) {
      const t = l.text.trim();
      l.heading = medianFont > 0 && l.size > threshold && t.length > 0 && t.length < 120;
    }
  }

  const emptyCount = pages.filter((p) => p.empty).length;
  return { pages, medianFont, emptyCount };
}

function scannedNote(emptyCount) {
  if (!emptyCount) return '';
  const s = emptyCount === 1 ? '' : 's';
  return `\n\n> Note: ${emptyCount} page${s} had no text layer (scanned image page${s}, not included).`;
}

/** Plain text with `--- page N ---` markers, for pasting into a chat. */
export function formatPlainText(result) {
  const body = result.pages
    .map((p) => `--- page ${p.num} ---\n${p.text}`)
    .join('\n\n');
  return body + scannedNote(result.emptyCount);
}

/** Markdown: big lines become `## headings`, page markers kept as-is. */
export function formatMarkdown(result) {
  const body = result.pages
    .map((p) => {
      const inner = p.lines.map((l) => (l.heading ? `## ${l.text}` : l.text)).join('\n\n');
      return `<!-- page ${p.num} -->\n\n${inner}`;
    })
    .join('\n\n');
  return body + scannedNote(result.emptyCount);
}
