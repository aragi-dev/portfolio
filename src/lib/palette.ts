// Palette — single source of truth for the Solitude field grays in
// TypeScript land. CSS keeps its own literal copies (tokens.css,
// hero-pixel.css gradients) because stylesheets cannot import TS;
// keep the hexes in sync when the palette changes.
export const FIELD_BG = "#080a0b";
export const FIELD_DIM = "#2a2e30";
export const FIELD_MID = "#4e5457";
export const FIELD_LIT = "#798186";
export const FIELD_HOVER = "#a1a7aa";
export const FIELD_CREST = "#cccfd1";

/** Wordmark band cuts as row fractions (lightest band first). */
export const BAND_CUTS: readonly [number, number, number, number] = [
  0.263, 0.368, 0.579, 0.737,
];

/** Resting ink for a row fraction — the canvas twin of the CSS gradient. */
export function bandForFraction(frac: number): string {
  if (frac < BAND_CUTS[0]) return FIELD_CREST;
  if (frac < BAND_CUTS[1]) return FIELD_HOVER;
  if (frac < BAND_CUTS[2]) return FIELD_LIT;
  if (frac < BAND_CUTS[3]) return FIELD_MID;
  return FIELD_DIM;
}

/** Resting ink bands for baked-strip prim colors, darkest first. */
export const SCRUB_BANDS: readonly string[] = [
  FIELD_DIM,
  FIELD_MID,
  FIELD_LIT,
  FIELD_HOVER,
  FIELD_CREST,
];

/** The 5-band grayscale behind every pixel mask (wordmarks, glyphs). */
export const WORDMARK_GRADIENT =
  `linear-gradient(to bottom, ${FIELD_CREST} 0%, ${FIELD_CREST} 26.3%, ` +
  `${FIELD_HOVER} 26.3%, ${FIELD_HOVER} 36.8%, ${FIELD_LIT} 36.8%, ${FIELD_LIT} 57.9%, ` +
  `${FIELD_MID} 57.9%, ${FIELD_MID} 73.7%, ${FIELD_DIM} 73.7%, ${FIELD_DIM} 100%)`;
