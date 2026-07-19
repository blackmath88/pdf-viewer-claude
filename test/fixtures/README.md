# Text-export regression fixture

`spacing.pdf` is a tiny, hand-authored single-page PDF (Helvetica, no embedded
fonts) built to exercise the space-insertion logic in [`js/export.js`](../../js/export.js).

Its words are laid out as **separate text items** (alternating font resources
force PDF.js to keep them apart) with deliberately measured horizontal gaps:

- **Intra-word gaps ≈ 0.07 × font size** — these must **not** become spaces.
  The words are split mid-glyph-run: `Mus`+`eum`, `bo`+`oking`, `res`+`ervation`.
- **Inter-word gaps ≈ 0.42 × font size** — these **must** stay spaces.

### Ground truth

Line 1: `The Museum booking reservation was confirmed`
Line 2: `Please keep real spaces between words intact`

### The artifact this guards against

A naive or mis-scaled space threshold splits the contiguous runs into
`Mus eum`, `bo oking`, `res ervation`. The correct behavior — a space only when
`gap > 0.25 × fontSize` (with `fontSize = hypot(transform[0], transform[1])`) —
keeps those words whole while preserving every real inter-word space.

Run [`../export-check.html`](../export-check.html) from a local server to check.
