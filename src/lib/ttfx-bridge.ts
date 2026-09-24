// ttfx -> canvas bridge: adapts ttfx terminal-cell effects to our
// pixel-lattice canvas.
//
// ttfx (github.com/omacom/ttfx) is a terminal engine: it takes text,
// runs an effect over a grid of character cells, and hands back a symbol
// plus a color per cell each frame. We feed it one FULL BLOCK per lit
// zone cell and repaint the returned cells as paint primitives (whole
// blocks, block-element fragments, thin lines, weighted marks) that the
// caller draws onto its own lattice.
//
// Effect names are BARE effect names only (e.g. "crumble", "pour").
// The engine rejects anything else ("pour --pour-direction up" throws
// `unknown effect`), so directionality is the caller's job, not ours.
//
// NOTE ON PADDING: buildInputText takes the UNPADDED zone size
// (columns/rows of the caller's lattice zone) and pads it internally
// with TTFX_PAD_ROWS blank rows top/bottom and TTFX_PAD_COLS blank
// columns left/right, because sparks need room to fly. The padded
// dimensions are columns + 2 * TTFX_PAD_COLS by rows + 2 * TTFX_PAD_ROWS;
// startRun must receive those PADDED dims (compute them with the exported
// pad constants), since the session grid has to match the input text.

/** Blank rows added above and below the zone text (room for sparks). */
export const TTFX_PAD_ROWS = 4;
/** Blank columns added left and right of the zone text. */
export const TTFX_PAD_COLS = 6;

/** How a decoded cell paints onto the lattice. */
export type PaintKind = "block" | "part" | "line" | "mark";

/** Axis-aligned rectangle in cell units (0..1 within the cell). */
export type Rect = { x: number; y: number; w: number; h: number };

export type PaintPrim = {
  /** Zone-grid coords (input space), offset-corrected. */
  col: number;
  row: number;
  kind: PaintKind;
  /** 0xRRGGBB from the cell's fg color. */
  rgb: number;
  /** Kind "part": U+2580..U+259F decomposition into cell-unit rects. */
  parts?: Rect[];
  /** Kind "line": which way the stroke runs. */
  line?: "up" | "down" | "bar" | "dash";
  /** Kind "mark": 0..1 ink weight of the glyph. */
  weight?: number;
  /** Kind "mark": vertical anchoring of the glyph's ink. */
  anchor?: "high" | "low" | "mid";
};

/** Loose handle for the vendored glue; typed minimally from ttfx.d.ts. */
export type TtfxModule = {
  Session: new (...args: any[]) => any;
  effect_catalog: () => string;
};

/** Minimal structural view of a ttfx Session (mirrors ttfx.d.ts). */
type SessionHandle = {
  step: () => boolean;
  fill: (
    symbols: Uint32Array,
    fg: Uint32Array,
    bg: Uint32Array,
    flags: Uint8Array,
  ) => void;
  width: () => number;
  height: () => number;
  free: () => void;
  done: () => boolean;
};

export type SessionRun = {
  /** Pump with owed-time pacing; true while alive (incl. settle tail). */
  advance: (nowMs: number) => boolean;
  /** Decoded cells for the current frame (hidden/empty skipped). */
  prims: () => PaintPrim[];
  free: () => void;
};

const GLUE_URL = "/ttfx/0.3.2/ttfx.js";
const WASM_URL = "/ttfx/effects/all.wasm";

/** Settled tail after step() finishes, so the caller can blend out. */
const SETTLE_MS = 220;
/** Upper bound for probe sessions (they must always terminate). */
const PROBE_STEP_GUARD = 100_000;
/** Background-tab guard: never catch up more than this many steps at once. */
const CATCH_UP_STEPS = 40;
/** flags bit 32 = hidden cell (skip it). */
const FLAG_HIDDEN = 32;
/** U+2588 FULL BLOCK: what every lit cell goes in as. */
const FULL_BLOCK = 0x2588;

let cachedLoad: Promise<TtfxModule | null> | null = null;

type GlueModule = {
  default: (init: { module_or_path: string }) => Promise<unknown>;
  Session: new (...args: any[]) => any;
  effect_catalog: () => string;
};

/**
 * Load the vendored ttfx glue and instantiate the wasm bundle.
 * Resolves null on ANY failure (no document, failed fetch, bad wasm);
 * the caller falls back to the resting scene and never throws.
 */
export function loadTtfx(): Promise<TtfxModule | null> {
  if (!cachedLoad) {
    cachedLoad = (async (): Promise<TtfxModule | null> => {
      try {
        if (typeof document === "undefined") return null;
        const glueUrl = new URL(GLUE_URL, document.baseURI).href;
        const wasmUrl = new URL(WASM_URL, document.baseURI).href;
        const mod = (await import(
          /* @vite-ignore */ glueUrl
        )) as unknown as GlueModule;
        if (!mod || typeof mod.default !== "function") return null;
        await mod.default({ module_or_path: wasmUrl });
        if (typeof mod.effect_catalog !== "function") return null;
        if (typeof mod.Session !== "function") return null;
        const ttfx: TtfxModule = {
          Session: mod.Session,
          effect_catalog: mod.effect_catalog,
        };
        return ttfx;
      } catch {
        return null;
      }
    })();
  }
  return cachedLoad;
}

/**
 * Build ttfx input text for a zone: one FULL BLOCK (U+2588) per lit cell,
 * spaces elsewhere, padded with TTFX_PAD_ROWS blank rows top/bottom and
 * TTFX_PAD_COLS blank columns left/right (sparks need room), joined
 * with "\n". Takes the UNPADDED zone size; the padded grid is
 * (columns + 2 * TTFX_PAD_COLS) x (rows + 2 * TTFX_PAD_ROWS).
 */
export function buildInputText(
  cells: Array<{ col: number; row: number }>,
  columns: number,
  rows: number,
): string {
  const lit = new Set<number>();
  for (const cell of cells) {
    if (
      cell.col < 0 ||
      cell.col >= columns ||
      cell.row < 0 ||
      cell.row >= rows
    ) {
      continue;
    }
    lit.add(cell.row * columns + cell.col);
  }
  const paddedColumns = columns + TTFX_PAD_COLS * 2;
  const blank = " ".repeat(paddedColumns);
  const lines: string[] = [];
  for (let r = 0; r < TTFX_PAD_ROWS; r++) lines.push(blank);
  for (let r = 0; r < rows; r++) {
    let line = " ".repeat(TTFX_PAD_COLS);
    for (let c = 0; c < columns; c++) {
      line += lit.has(r * columns + c) ? "█" : " ";
    }
    line += " ".repeat(TTFX_PAD_COLS);
    lines.push(line);
  }
  for (let r = 0; r < TTFX_PAD_ROWS; r++) lines.push(blank);
  return lines.join("\n");
}

/**
 * Calibration model: ttfx re-centers its output grid by the input
 * CONTENT bounding box (not the grid dims), so two inputs with
 * identical dims but different content land at different offsets
 * (measured spread: 33 rows between top-only and bottom-only content
 * on the same 133x46 grid). Offsets are therefore always derived from
 * the run's OWN content, never shared across contents.
 *
 * Fast path (crumble-type effects): the effect holds its characters at
 * their home cells for the first ~100+ steps, so the first frame whose
 * visible FULL BLOCK count reaches HOME_FRACTION of the input block
 * count IS the home layout, already carrying the content's own offset.
 * The delta between the first visible block in reading order on both
 * sides is the offset (the old probe's first-block convention, narrowed
 * to visible cells to match what prims() actually paints). Those steps
 * are part of the arc: calibration continues the run from the home
 * frame, never restarts it, and the offset is known before startRun
 * returns, so prims() is aligned from the very first frame.
 *
 * Fallback (effects that never show a home layout, e.g. "pour" streams
 * its cells in a few at a time and never reaches HOME_FRACTION within
 * SELF_CALIBRATE_STEPS): one throwaway probe session run to completion,
 * read with the same first-visible-block delta. It is cached by hash of
 * (input content, effect, columns, rows) so it is never content-stale.
 * For crumble-type effects this path never runs (step 1 is already home).
 */

/** Visible-block fraction that identifies a "home layout" frame. */
const HOME_FRACTION = 0.6;
/** Fast-path give-up: steps before falling back to a completion probe. */
const SELF_CALIBRATE_STEPS = 250;

/** FNV-1a hex over (input content, effect, columns, rows). */
function hashProbeKey(
  input: string,
  effect: string,
  columns: number,
  rows: number,
): string {
  let h = 0x811c9dc5;
  const feed = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  feed(input);
  feed("\0" + effect + "\0" + columns + "x" + rows);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Fallback-only completion probe, cached by content hash (never stale).
 * Runs a throwaway session of the same input + effect to completion and
 * returns the first-visible-block delta against the input. Only reached
 * by effects with no home layout (e.g. "pour"); crumble-type effects
 * always calibrate from their own first frames above.
 */
const probeCache = new Map<string, { dx: number; dy: number }>();

function probeOffsetToCompletion(
  ttfx: TtfxModule,
  input: string,
  effect: string,
  columns: number,
  rows: number,
  stepsPerSecond: number,
): { dx: number; dy: number } {
  const key = hashProbeKey(input, effect, columns, rows);
  const known = probeCache.get(key);
  if (known) return known;

  const found = { dx: 0, dy: 0 };
  const probe = new ttfx.Session(
    input,
    effect,
    columns,
    rows,
    0,
    stepsPerSecond,
    null,
    null,
  ) as SessionHandle;
  try {
    for (let guard = 0; guard < PROBE_STEP_GUARD && probe.step(); guard++) {
      /* run to the end */
    }
    const w = probe.width();
    const h = probe.height();
    const n = w * h;
    const symbols = new Uint32Array(n);
    const flags = new Uint8Array(n);
    probe.fill(symbols, new Uint32Array(n), new Uint32Array(n), flags);
    const at = firstVisibleBlock(symbols, flags, w, h);
    const census = censusInputBlocks(input);
    if (at.index >= 0 && census.firstCol >= 0) {
      found.dx = at.col - census.firstCol;
      found.dy = at.row - census.firstRow;
    }
  } finally {
    probe.free();
  }
  probeCache.set(key, found);
  return found;
}

/** Count input FULL BLOCKs plus the first one in reading order. */
function censusInputBlocks(input: string): {
  count: number;
  firstCol: number;
  firstRow: number;
} {
  let count = 0;
  let firstCol = -1;
  let firstRow = -1;
  const lines = input.split("\n");
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r];
    for (let c = 0; c < line.length; c++) {
      if (line.codePointAt(c) === FULL_BLOCK) {
        count++;
        if (firstCol < 0) {
          firstCol = c;
          firstRow = r;
        }
      }
    }
  }
  return { count, firstCol, firstRow };
}

/** First visible (non-hidden) FULL BLOCK in reading order + its count. */
function firstVisibleBlock(
  symbols: Uint32Array,
  flags: Uint8Array,
  w: number,
  h: number,
): { count: number; index: number; col: number; row: number } {
  let count = 0;
  let index = -1;
  const n = Math.min(symbols.length, Math.max(0, w * h));
  for (let i = 0; i < n; i++) {
    if (symbols[i] === FULL_BLOCK && !(flags[i] & FLAG_HIDDEN)) {
      count++;
      if (index < 0) index = i;
    }
  }
  return {
    count,
    index,
    col: index >= 0 ? index % Math.max(1, w) : -1,
    row: index >= 0 ? Math.floor(index / Math.max(1, w)) : -1,
  };
}

/**
 * Unicode Block Elements (U+2580..U+259F) as cell-unit rects. Halves and
 * quarter quadrants are exact; eighth steps have no half-cell exact form,
 * so their coverage is rounded to the nearest half (7/8 fills the cell).
 * Combos of three quadrants decompose into a half plus one quadrant, so
 * no glyph needs more than 3 rects. Shaded blocks become the classic
 * dither: one, two or three of the four quarter-cells.
 */
function blockParts(symbol: number): Rect[] | null {
  const H = 0.5;
  switch (symbol) {
    // Halves.
    case 0x2580:
      return [{ x: 0, y: 0, w: 1, h: H }]; // upper half
    case 0x2584:
      return [{ x: 0, y: H, w: 1, h: H }]; // lower half
    case 0x258c:
      return [{ x: 0, y: 0, w: H, h: 1 }]; // left half
    case 0x2590:
      return [{ x: H, y: 0, w: H, h: 1 }]; // right half
    // Lower eighths, rounded to the nearest half.
    case 0x2581: // lower 1/8
    case 0x2582: // lower 2/8
    case 0x2583: // lower 3/8
      return [{ x: 0, y: H, w: 1, h: H }];
    case 0x2585: // lower 5/8
    case 0x2586: // lower 6/8
      return [{ x: 0, y: H, w: 1, h: H }];
    case 0x2587: // lower 7/8
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    // Left eighths, rounded to the nearest half.
    case 0x258f: // left 1/8
    case 0x258e: // left 2/8
    case 0x258d: // left 3/8
      return [{ x: 0, y: 0, w: H, h: 1 }];
    case 0x258b: // left 5/8
    case 0x258a: // left 6/8
      return [{ x: 0, y: 0, w: H, h: 1 }];
    case 0x2589: // left 7/8
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    // Single eighths, rounded to the nearest half.
    case 0x2594: // upper 1/8
      return [{ x: 0, y: 0, w: 1, h: H }];
    case 0x2595: // right 1/8
      return [{ x: H, y: 0, w: H, h: 1 }];
    // Single quadrants.
    case 0x2596:
      return [{ x: 0, y: H, w: H, h: H }]; // lower left
    case 0x2597:
      return [{ x: H, y: H, w: H, h: H }]; // lower right
    case 0x2598:
      return [{ x: 0, y: 0, w: H, h: H }]; // upper left
    case 0x259d:
      return [{ x: H, y: 0, w: H, h: H }]; // upper right
    // Diagonal quadrant pairs.
    case 0x259a:
      return [
        { x: 0, y: 0, w: H, h: H },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x259e:
      return [
        { x: H, y: 0, w: H, h: H },
        { x: 0, y: H, w: H, h: H },
      ];
    // Three-quadrant combos: a half plus the odd quadrant out.
    case 0x2599: // all but upper right
      return [
        { x: 0, y: 0, w: H, h: 1 },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x259b: // all but lower right
      return [
        { x: 0, y: 0, w: 1, h: H },
        { x: 0, y: H, w: H, h: H },
      ];
    case 0x259c: // all but lower left
      return [
        { x: 0, y: 0, w: 1, h: H },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x259f: // all but upper left
      return [
        { x: 0, y: H, w: 1, h: H },
        { x: H, y: 0, w: H, h: H },
      ];
    // Shades as dither over the four quarter-cells.
    case 0x2591: // light shade
      return [{ x: 0, y: 0, w: H, h: H }];
    case 0x2592: // medium shade
      return [
        { x: 0, y: 0, w: H, h: H },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x2593: // dark shade
      return [
        { x: 0, y: 0, w: H, h: H },
        { x: H, y: H, w: H, h: H },
        { x: H, y: 0, w: H, h: H },
      ];
    default:
      return null;
  }
}

/** Line strokes: slashes run diagonal, bars and dashes run straight. */
function lineOf(symbol: number): PaintPrim["line"] | null {
  switch (symbol) {
    case 0x2f: // /
    case 0x2571:
      return "up";
    case 0x5c: // backslash
    case 0x2572:
      return "down";
    case 0x7c: // |
    case 0x2502:
    case 0x2503:
      return "bar";
    case 0x2d: // -
    case 0x2500:
    case 0x2501:
    case 0x5f: // _
      return "dash";
    default:
      return null;
  }
}

/** How much of a cell a glyph's ink covers, judged by eye. */
function weightOf(symbol: number): number {
  const ch = String.fromCodePoint(symbol);
  if (ch === "." || ch === "," || ch === "`") return 0.12;
  if (ch === ":" || ch === ";" || ch === "^" || ch === "~" || ch === '"') {
    return 0.2;
  }
  if ("*+=<>()[]{}!?il1".includes(ch)) return 0.35;
  if ("#@%&$MW".includes(ch)) return 0.7;
  return 0.5;
}

/** Where a glyph's ink sits vertically: low dots, high ticks, else mid. */
function anchorOf(symbol: number): "high" | "low" | "mid" {
  const ch = String.fromCodePoint(symbol);
  if (ch === "." || ch === "," || ch === "_") return "low";
  if (ch === "'" || ch === "`" || ch === '"' || ch === "^") return "high";
  return "mid";
}

/** Decode one cell symbol into its paint shape (without position/color). */
function describe(symbol: number): {
  kind: PaintKind;
  parts?: Rect[];
  line?: "up" | "down" | "bar" | "dash";
  weight?: number;
  anchor?: "high" | "low" | "mid";
} {
  if (symbol === FULL_BLOCK) return { kind: "block" };
  const parts = symbol >= 0x2580 && symbol <= 0x259f ? blockParts(symbol) : null;
  if (parts) return { kind: "part", parts };
  const line = lineOf(symbol);
  if (line) return { kind: "line", line };
  return { kind: "mark", weight: weightOf(symbol), anchor: anchorOf(symbol) };
}

/**
 * Decode one raw engine frame into paint primitives. `symbols`/`fg`/`flags`
 * are the fill() buffers for a w*h frame; `offset` is the content's own
 * home-frame delta (see the CALIBRATION MODEL above). Hidden and empty
 * cells are skipped. Shared by startRun().prims() and bakeStrip() so both
 * paint exactly what the engine returned.
 */
function decodePrims(
  symbols: Uint32Array,
  fg: Uint32Array,
  flags: Uint8Array,
  w: number,
  h: number,
  offset: { dx: number; dy: number },
): PaintPrim[] {
  const out: PaintPrim[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const symbol = symbols[i];
      if (symbol === 32 || symbol === 0 || flags[i] & FLAG_HIDDEN) {
        continue;
      }
      const shaped = describe(symbol);
      out.push({
        col: c - TTFX_PAD_COLS - offset.dx,
        row: r - TTFX_PAD_ROWS - offset.dy,
        kind: shaped.kind,
        rgb: fg[i] & 0xffffff,
        ...(shaped.parts ? { parts: shaped.parts } : {}),
        ...(shaped.line ? { line: shaped.line } : {}),
        ...(shaped.weight !== undefined ? { weight: shaped.weight } : {}),
        ...(shaped.anchor ? { anchor: shaped.anchor } : {}),
      });
    }
  }
  return out;
}

/**
 * One baked disintegration strip for a single element: every frame of the
 * "fall into dust" segment, decoded once and indexed by scroll progress.
 * frames[0] is the home layout (synthesized exactly from the input cells,
 * never painted: index 0 always paints the live rest state); frames[1..]
 * are the engine's own falling frames up to and including the dispersed
 * frame. The vacuum/reform tail past the cut is dropped: scrubbing back
 * IS the return path, so the strip must never contain auto-rearm motion.
 */
export type BakedStrip = {
  /** frames[0] = home layout; index = frame idx. */
  frames: PaintPrim[][];
  /** frames.length - 1 (the dust-fall cut). */
  maxFrame: number;
  /** Unpadded element grid. */
  columns: number;
  rows: number;
};

/**
 * Deterministic bake seed. Variety between elements comes from their
 * different input content (different bitmaps run different arcs); the
 * seed stays fixed so a strip is identical across loads and scrolls.
 */
const BAKE_SEED = 0;

/** Options for one element's disintegration bake (bakeStrip's shape). */
export type BakeOptions = {
  cells: Array<{ col: number; row: number }>;
  columns: number;
  rows: number;
  effect: string;
  stepsPerSecond: number;
  palette: string | null;
};

/** One raw engine frame snapshot (undecoded: the offset is unknown yet). */
type RawFrame = {
  w: number;
  h: number;
  symbols: Uint32Array;
  fg: Uint32Array;
  flags: Uint8Array;
};

/**
 * Incremental-bake chunk sizes. Each BakeJob.step() call advances ONE
 * phase only, so a single call costs at most one stepping chunk (caller
 * sized via maxSteps), one decode chunk, one collect chunk, one
 * distance chunk, or one means chunk. On the measured inputs an engine
 * step costs ~0.07ms (ARAGI) to ~0.16ms (DOM scale) and a decode chunk
 * ~16 frames, so every call lands in the low single-digit milliseconds
 * and a caller slice of 6-10ms comfortably holds several calls.
 */
const BAKE_DECODE_FRAMES_PER_STEP = 8;
const BAKE_COLLECT_FRAMES_PER_STEP = 8;
const BAKE_METRIC_COORDS_PER_STEP = 128;
const BAKE_MEAN_FRAMES_PER_STEP = 64;
/** Engine steps per step() call when bakeStrip drains synchronously. */
const BAKE_SYNC_DRAIN_STEPS = 64;

/** Bake lifecycle: stepping runs the engine; the rest refine to the cut. */
type BakePhase =
  | "stepping"
  | "prepare"
  | "decoding"
  | "collect"
  | "distances"
  | "means"
  | "ready"
  | "failed";

/**
 * Incremental bake job: the same bake bakeStrip performs, sliced across
 * frames. step() advances one bounded chunk and returns true while work
 * remains; finish() assembles the strip once the job reports done (null
 * before that, or on any failure). free() aborts: it releases the engine
 * session so a half-baked job never leaks wasm memory.
 *
 * Determinism: every phase replays bakeStrip's logic in the same order
 * (stepping snapshots, home search, offset, decode, home verification,
 * dispersion means, first-global-maximum cut, synthesized frames[0]), so
 * the finished strip is byte-identical to the synchronous bake. The job
 * reads no clock: scheduling (how many steps per frame) is the caller's
 * decision and never leaks into the strip.
 */
export type BakeJob = {
  step: (maxSteps: number) => boolean;
  finish: () => BakedStrip | null;
  free: () => void;
};

/**
 * Start one element's disintegration bake without blocking: validates
 * and constructs the engine session synchronously (cheap: one Session),
 * then the caller pumps step() in slice budgets until it reports done.
 * Returns null on the same invalid inputs bakeStrip rejects (bad dims,
 * empty cells, empty effect, bad rate, empty census, Session throw), so
 * the caller keeps the element whole exactly as before.
 */
export function beginBake(
  ttfx: TtfxModule,
  opts: BakeOptions,
): BakeJob | null {
  try {
    const { cells, columns, rows, effect, stepsPerSecond, palette } = opts;
    if (!Number.isInteger(columns) || columns <= 0) return null;
    if (!Number.isInteger(rows) || rows <= 0) return null;
    if (!cells || cells.length === 0) return null;
    if (typeof effect !== "string" || effect.length === 0) return null;
    if (!Number.isFinite(stepsPerSecond) || stepsPerSecond <= 0) {
      return null;
    }
    const input = buildInputText(cells, columns, rows);
    const census = censusInputBlocks(input);
    if (census.count === 0 || census.firstCol < 0) return null;
    const paddedColumns = columns + TTFX_PAD_COLS * 2;
    const paddedRows = rows + TTFX_PAD_ROWS * 2;

    let session: SessionHandle | null = null;
    try {
      session = new ttfx.Session(
        input,
        effect,
        paddedColumns,
        paddedRows,
        BAKE_SEED,
        stepsPerSecond,
        palette,
        null,
      ) as SessionHandle;
    } catch {
      return null;
    }

    let phase: BakePhase = "stepping";
    let raw: RawFrame[] = [];
    let guard = 0;
    let steppingDone = false;
    let home = -1;
    let offset = { dx: 0, dy: 0 };
    let decoded: PaintPrim[][] = [];
    let decodeCursor = 0;
    // Dispersion memo: same per-coordinate cache as the synchronous
    // bake (key row * 65536 + col). The collect phase gathers every
    // distinct prim coord up front and the distances phase evaluates
    // them in slices, instead of filling lazily inside the means —
    // same values, only the scheduling differs.
    const memo = new Map<number, number>();
    const seenCoords = new Set<number>();
    let pending: Array<{ col: number; row: number }> = [];
    let collectCursor = 0;
    let distCursor = 0;
    let metric: number[] = [];
    let meanCursor = 0;
    let cut = -1;
    let cached: BakedStrip | null = null;
    let cachedDone = false;

    // Idempotent session release (engine memory is freed as soon as
    // stepping ends, exactly where the synchronous bake frees it).
    const freeSession = (): void => {
      if (session === null) return;
      const live = session;
      session = null;
      try {
        live.free();
      } catch {
        /* already dead */
      }
    };

    // Settle a failure: release the session, report done with no strip.
    const fail = (): boolean => {
      freeSession();
      phase = "failed";
      return false;
    };

    // Mean Manhattan distance of one frame's visible prims from their
    // nearest input cell (pad dust included, coords as-is). Distances
    // come from the memo; every prim coord was collected up front, so
    // the lookup always hits and the mean matches the synchronous bake.
    const frameMean = (prims: PaintPrim[]): number => {
      if (prims.length === 0) return 0;
      let sum = 0;
      for (const prim of prims) {
        const known = memo.get(prim.row * 65536 + prim.col);
        sum += known !== undefined ? known : 0;
      }
      return sum / prims.length;
    };

    const job: BakeJob = {
      step(maxSteps: number): boolean {
        try {
          if (phase === "ready" || phase === "failed") return false;

          // Engine stepping + frame collection, bounded by maxSteps.
          // Same snapshots as the synchronous bake (step, then
          // width/height, then fill, pushed in order), only sliced.
          if (phase === "stepping") {
            const budget = Number.isFinite(maxSteps)
              ? Math.max(1, Math.floor(maxSteps))
              : 1;
            for (let k = 0; k < budget; k++) {
              if (steppingDone || guard >= PROBE_STEP_GUARD) break;
              const live = session;
              if (live === null) {
                steppingDone = true;
                break;
              }
              guard++;
              let stillAlive = false;
              try {
                stillAlive = live.step();
              } catch {
                steppingDone = true;
                break;
              }
              let w = 0;
              let h = 0;
              try {
                w = live.width();
                h = live.height();
              } catch {
                steppingDone = true;
                break;
              }
              const n = w * h;
              if (n <= 0) {
                if (!stillAlive) {
                  steppingDone = true;
                  break;
                }
                continue;
              }
              const symbols = new Uint32Array(n);
              const fg = new Uint32Array(n);
              const flags = new Uint8Array(n);
              try {
                live.fill(symbols, fg, new Uint32Array(n), flags);
              } catch {
                steppingDone = true;
                break;
              }
              raw.push({ w, h, symbols, fg, flags });
              if (!stillAlive) steppingDone = true;
            }
            if (steppingDone || guard >= PROBE_STEP_GUARD) {
              freeSession();
              phase = "prepare";
            }
            return true;
          }

          // Home search + content offset (synchronous: one scan that
          // exits at the first qualifying frame, same as before).
          if (phase === "prepare") {
            if (raw.length === 0) return fail();
            const need = Math.ceil(census.count * HOME_FRACTION);
            home = -1;
            for (let i = 0; i < raw.length; i++) {
              const at = firstVisibleBlock(
                raw[i].symbols,
                raw[i].flags,
                raw[i].w,
                raw[i].h,
              );
              if (at.count >= need) {
                home = i;
                break;
              }
            }
            if (home < 0) return fail();
            const homeAt = firstVisibleBlock(
              raw[home].symbols,
              raw[home].flags,
              raw[home].w,
              raw[home].h,
            );
            if (homeAt.index < 0) return fail();
            offset = {
              dx: homeAt.col - census.firstCol,
              dy: homeAt.row - census.firstRow,
            };
            decoded = [];
            decodeCursor = 0;
            phase = "decoding";
            return true;
          }

          // Decode home..end with the home frame's own offset, in
          // frame slices. Afterwards the engine home frame must carry
          // exactly the input block set (same verification as the
          // synchronous bake); then the raw snapshots are released.
          if (phase === "decoding") {
            const total = raw.length - home;
            let n = 0;
            while (n < BAKE_DECODE_FRAMES_PER_STEP && decodeCursor < total) {
              const frame = raw[home + decodeCursor];
              decoded.push(
                decodePrims(
                  frame.symbols,
                  frame.fg,
                  frame.flags,
                  frame.w,
                  frame.h,
                  offset,
                ),
              );
              decodeCursor++;
              n++;
            }
            if (decodeCursor < total) return true;
            const want = new Set<number>();
            for (const cell of cells) {
              if (cell.col < 0 || cell.col >= columns) continue;
              if (cell.row < 0 || cell.row >= rows) continue;
              want.add(cell.row * columns + cell.col);
            }
            if (want.size === 0) return fail();
            const got = new Set<number>();
            for (const prim of decoded[0]) {
              if (prim.kind !== "block") continue;
              got.add(prim.row * columns + prim.col);
            }
            if (got.size !== want.size) return fail();
            for (const key of want) {
              if (!got.has(key)) return fail();
            }
            raw = [];
            pending = [];
            collectCursor = 0;
            phase = "collect";
            return true;
          }

          // Collect every distinct prim coord (frame slices) so the
          // distance evaluation below can run in bounded slices too.
          if (phase === "collect") {
            let n = 0;
            while (
              n < BAKE_COLLECT_FRAMES_PER_STEP &&
              collectCursor < decoded.length
            ) {
              const prims = decoded[collectCursor];
              for (const prim of prims) {
                const key = prim.row * 65536 + prim.col;
                if (!seenCoords.has(key)) {
                  seenCoords.add(key);
                  pending.push({ col: prim.col, row: prim.row });
                }
              }
              collectCursor++;
              n++;
            }
            if (collectCursor < decoded.length) return true;
            distCursor = 0;
            phase = "distances";
            return true;
          }

          // Nearest-input Manhattan scan per distinct coord, in coord
          // slices (same scan the synchronous bake memoizes lazily).
          if (phase === "distances") {
            let n = 0;
            while (
              n < BAKE_METRIC_COORDS_PER_STEP && distCursor < pending.length
            ) {
              const coord = pending[distCursor];
              let best = Number.POSITIVE_INFINITY;
              for (const cell of cells) {
                if (cell.col < 0 || cell.col >= columns) continue;
                if (cell.row < 0 || cell.row >= rows) continue;
                const d =
                  Math.abs(coord.col - cell.col) +
                  Math.abs(coord.row - cell.row);
                if (d < best) best = d;
                if (best === 0) break;
              }
              if (!Number.isFinite(best)) best = 0;
              memo.set(coord.row * 65536 + coord.col, best);
              distCursor++;
              n++;
            }
            if (distCursor < pending.length) return true;
            metric = new Array(decoded.length);
            meanCursor = 0;
            phase = "means";
            return true;
          }

          // Per-frame means (frame slices), then the cut: the FIRST
          // frame attaining the global maximum (same rule as before).
          if (phase === "means") {
            let n = 0;
            while (
              n < BAKE_MEAN_FRAMES_PER_STEP && meanCursor < decoded.length
            ) {
              metric[meanCursor] = frameMean(decoded[meanCursor]);
              meanCursor++;
              n++;
            }
            if (meanCursor < decoded.length) return true;
            let found = 0;
            for (let i = 1; i < metric.length; i++) {
              if (metric[i] > metric[found]) found = i;
            }
            if (found <= 0 || metric[found] <= 0) return fail();
            cut = found;
            phase = "ready";
            return false;
          }

          return fail();
        } catch {
          return fail();
        }
      },

      finish(): BakedStrip | null {
        try {
          if (cachedDone) return cached;
          if (phase !== "ready") return null;
          // frames[0]: the home layout exactly (one block prim per
          // input cell), same synthesis as the synchronous bake.
          const seen = new Set<number>();
          const homePrims: PaintPrim[] = [];
          for (const cell of cells) {
            if (cell.col < 0 || cell.col >= columns) continue;
            if (cell.row < 0 || cell.row >= rows) continue;
            const key = cell.row * columns + cell.col;
            if (seen.has(key)) continue;
            seen.add(key);
            homePrims.push({
              col: cell.col,
              row: cell.row,
              kind: "block",
              rgb: 0xffffff,
            });
          }
          const frames: PaintPrim[][] = [homePrims];
          for (let i = 1; i <= cut; i++) frames.push(decoded[i]);
          cached = { frames, maxFrame: cut, columns, rows };
          cachedDone = true;
          return cached;
        } catch {
          return null;
        }
      },

      free(): void {
        freeSession();
        if (!cachedDone) phase = "failed";
      },
    };

    return job;
  } catch {
    return null;
  }
}

/**
 * Bake one element's disintegration strip: build the padded input, run
 * the effect to completion ONCE, and keep only the "fall into dust"
 * segment (home -> dispersed frame). Returns null on ANY failure
 * (unknown effect, empty input, no home layout, no dispersion, engine
 * error, misaligned home): the caller keeps the element whole.
 *
 * Home: the first frame whose visible FULL BLOCK count reaches
 * HOME_FRACTION of the input block count (same convention as the
 * self-calibration). Earlier frames are engine junk (step 0 is blank).
 *
 * Cut: the DISPERSED frame, i.e. the boundary between the falling-dust
 * phase and the auto-rearm (crumble: Falling -> Vacuuming -> Resetting).
 * Dispersion metric = mean Manhattan distance of the frame's visible
 * prims from their nearest input cell (pad dust included, coords as-is).
 * The cut is the FIRST frame attaining the global maximum of that metric
 * over the arc. Rationale: gravity acts before the vacuum, so the
 * falling lobe always arrives first; the pad-symmetric bounds cap every
 * lobe at the same ceiling, so the first attainer is the fall/vacuum
 * boundary, never a later vacuum fling. Validated on a real crumble
 * strip (30x8 solid block: 381 steps, home 0, cut 216; ARAGI 57x19:
 * 522 steps, home 0, cut 270): ASCII dumps around each cut show the grid
 * emptying into a bottom dust pile before the cut and material streaming
 * back up right after it.
 *
 * frames[0] is synthesized from the input cells (one block prim per
 * cell) so it equals the home layout exactly by construction; the bake
 * additionally requires the engine's own home frame to carry exactly the
 * input block set (no missing, no extra), otherwise the offset the whole
 * strip relies on is untrustworthy and the bake fails.
 */
export function bakeStrip(
  ttfx: TtfxModule,
  opts: BakeOptions,
): BakedStrip | null {
  // Synchronous facade over the incremental job: drain it with large
  // stepping chunks, then assemble. Same inputs, same phases, same
  // strip — the equivalence probe compares both paths for
  // byte-identical output.
  try {
    const job = beginBake(ttfx, opts);
    if (!job) return null;
    while (job.step(BAKE_SYNC_DRAIN_STEPS)) {
      /* drain to completion */
    }
    const out = job.finish();
    try {
      job.free();
    } catch {
      /* already settled */
    }
    return out;
  } catch {
    return null;
  }
}
/**
 * Start an effect run over padded input text. `columns`/`rows` are the
 * PADDED dims matching the input text (see buildInputText). Returns null
 * on any failure (unknown effect, bad dims, engine error). The run
 * self-calibrates from its OWN early frames (see CALIBRATION MODEL
 * above): after construction it steps to the first "home layout" frame
 * and derives the content offset from it, then continues the arc from
 * there — those steps are part of the effect, and prims() is aligned
 * from the first frame. No throwaway probe runs for crumble-type
 * effects; the content-hashed completion fallback covers effects with
 * no home layout. Retention contract: prims() returns a fresh array per
 * call, so the caller keeps the end-of-arc frame by copying prims()
 * before free() (no SessionRun extension needed for the v2 crossfade).
 */
export function startRun(
  ttfx: TtfxModule,
  opts: {
    input: string;
    effect: string;
    columns: number;
    rows: number;
    seed: number;
    stepsPerSecond: number;
    palette: string | null;
  },
): SessionRun | null {
  let session: SessionHandle;
  try {
    session = new ttfx.Session(
      opts.input,
      opts.effect,
      opts.columns,
      opts.rows,
      opts.seed,
      opts.stepsPerSecond,
      opts.palette,
      null,
    ) as SessionHandle;
  } catch {
    return null;
  }

  let offset = { dx: 0, dy: 0 };
  let alive = false;

  // Frame buffers, resized on every read: the frame may grow as sparks fly.
  let w = 0;
  let h = 0;
  let symbols = new Uint32Array(0);
  let fg = new Uint32Array(0);
  let flags = new Uint8Array(0);
  const read = (): void => {
    w = session.width();
    h = session.height();
    const n = w * h;
    if (symbols.length < n || fg.length < n || flags.length < n) {
      symbols = new Uint32Array(n);
      fg = new Uint32Array(n);
      flags = new Uint8Array(n);
    }
    session.fill(symbols, fg, new Uint32Array(n), flags);
  };

  try {
    const census = censusInputBlocks(opts.input);
    if (census.count === 0) {
      // Nothing to align: a single step so prims() has content.
      alive = session.step();
      read();
    } else {
      // Self-calibration: step the LIVE session to its home frame and
      // keep going from there. One step+fill for crumble-type effects
      // (step 1 is already home); the completion fallback below only
      // runs for effects that never settle home (e.g. "pour").
      const need = Math.ceil(census.count * HOME_FRACTION);
      let home = false;
      for (let i = 0; i < SELF_CALIBRATE_STEPS; i++) {
        alive = session.step();
        read();
        const at = firstVisibleBlock(symbols, flags, w, h);
        if (at.count >= need && at.index >= 0 && census.firstCol >= 0) {
          offset = {
            dx: at.col - census.firstCol,
            dy: at.row - census.firstRow,
          };
          home = true;
          break;
        }
        if (!alive) break;
      }
      if (!home) {
        offset = probeOffsetToCompletion(
          ttfx,
          opts.input,
          opts.effect,
          opts.columns,
          opts.rows,
          opts.stepsPerSecond,
        );
      }
    }
  } catch {
    try {
      session.free();
    } catch {
      /* already dead */
    }
    return null;
  }

  const stepMs = 1000 / opts.stepsPerSecond;
  let last = -1;
  let owed = 0;
  let doneAt = -1;
  let freed = false;

  return {
    advance(nowMs: number): boolean {
      if (freed) return false;
      if (last < 0) last = nowMs;
      if (alive) {
        // Steps owed since the last frame, capped so a background tab
        // coming back does not burn through the whole effect at once.
        owed = Math.min(owed + (nowMs - last), stepMs * CATCH_UP_STEPS);
        last = nowMs;
        let moved = false;
        try {
          while (owed >= stepMs && alive) {
            owed -= stepMs;
            alive = session.step();
            moved = true;
          }
          if (moved) read();
        } catch {
          alive = false;
          moved = false;
        }
        if (alive) return true;
        doneAt = nowMs;
      }
      if (doneAt < 0) doneAt = nowMs;
      // Settle tail: report alive a little longer so the caller can
      // blend the finished frame out instead of cutting to rest.
      return nowMs - doneAt < SETTLE_MS;
    },
    prims(): PaintPrim[] {
      if (freed) return [];
      return decodePrims(symbols, fg, flags, w, h, offset);
    },
    free(): void {
      if (freed) return;
      freed = true;
      alive = false;
      try {
        session.free();
      } catch {
        /* already dead */
      }
    },
  };
}

/**
 * Pick the nearest of `bands` (theme gray hexes, with or without "#")
 * for an 0xRRGGBB color, by luma (0.299r + 0.587g + 0.114b).
 */
export function inkForRgb(rgb: number, bands: readonly string[]): string {
  const lumaOf = (v: number): number => {
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const parseBand = (band: string): number => {
    const hex = band.startsWith("#") ? band.slice(1) : band;
    const v = parseInt(hex, 16);
    return Number.isNaN(v) ? 0 : v & 0xffffff;
  };
  const target = lumaOf(rgb & 0xffffff);
  let best = bands[0];
  let bestGap = Number.POSITIVE_INFINITY;
  for (const band of bands) {
    const gap = Math.abs(lumaOf(parseBand(band)) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = band;
    }
  }
  return best;
}
