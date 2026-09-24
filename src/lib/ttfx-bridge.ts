export const TTFX_PAD_ROWS = 4;
export const TTFX_PAD_COLS = 6;

export type PaintKind = "block" | "part" | "line" | "mark";

export type Rect = { x: number; y: number; w: number; h: number };

export type PaintPrim = {
  col: number;
  row: number;
  kind: PaintKind;
  rgb: number;
  parts?: Rect[];
  line?: "up" | "down" | "bar" | "dash";
  weight?: number;
  anchor?: "high" | "low" | "mid";
};

export type TtfxModule = {
  Session: new (...args: any[]) => any;
  effect_catalog: () => string;
};

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
  advance: (nowMs: number) => boolean;
  prims: () => PaintPrim[];
  free: () => void;
};

const GLUE_URL = "/ttfx/0.3.2/ttfx.js";
const WASM_URL = "/ttfx/effects/all.wasm";

const SETTLE_MS = 220;
const PROBE_STEP_GUARD = 100_000;
const CATCH_UP_STEPS = 40;
const FLAG_HIDDEN = 32;
const FULL_BLOCK = 0x2588;

let cachedLoad: Promise<TtfxModule | null> | null = null;

type GlueModule = {
  default: (init: { module_or_path: string }) => Promise<unknown>;
  Session: new (...args: any[]) => any;
  effect_catalog: () => string;
};

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

const HOME_FRACTION = 0.6;
const SELF_CALIBRATE_STEPS = 250;

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

function blockParts(symbol: number): Rect[] | null {
  const H = 0.5;
  switch (symbol) {
    case 0x2580:
      return [{ x: 0, y: 0, w: 1, h: H }];
    case 0x2584:
      return [{ x: 0, y: H, w: 1, h: H }];
    case 0x258c:
      return [{ x: 0, y: 0, w: H, h: 1 }];
    case 0x2590:
      return [{ x: H, y: 0, w: H, h: 1 }];
    case 0x2581:
    case 0x2582:
    case 0x2583:
      return [{ x: 0, y: H, w: 1, h: H }];
    case 0x2585:
    case 0x2586:
      return [{ x: 0, y: H, w: 1, h: H }];
    case 0x2587:
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 0x258f:
    case 0x258e:
    case 0x258d:
      return [{ x: 0, y: 0, w: H, h: 1 }];
    case 0x258b:
    case 0x258a:
      return [{ x: 0, y: 0, w: H, h: 1 }];
    case 0x2589:
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 0x2594:
      return [{ x: 0, y: 0, w: 1, h: H }];
    case 0x2595:
      return [{ x: H, y: 0, w: H, h: 1 }];
    case 0x2596:
      return [{ x: 0, y: H, w: H, h: H }];
    case 0x2597:
      return [{ x: H, y: H, w: H, h: H }];
    case 0x2598:
      return [{ x: 0, y: 0, w: H, h: H }];
    case 0x259d:
      return [{ x: H, y: 0, w: H, h: H }];
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
    case 0x2599:
      return [
        { x: 0, y: 0, w: H, h: 1 },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x259b:
      return [
        { x: 0, y: 0, w: 1, h: H },
        { x: 0, y: H, w: H, h: H },
      ];
    case 0x259c:
      return [
        { x: 0, y: 0, w: 1, h: H },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x259f:
      return [
        { x: 0, y: H, w: 1, h: H },
        { x: H, y: 0, w: H, h: H },
      ];
    case 0x2591:
      return [{ x: 0, y: 0, w: H, h: H }];
    case 0x2592:
      return [
        { x: 0, y: 0, w: H, h: H },
        { x: H, y: H, w: H, h: H },
      ];
    case 0x2593:
      return [
        { x: 0, y: 0, w: H, h: H },
        { x: H, y: H, w: H, h: H },
        { x: H, y: 0, w: H, h: H },
      ];
    default:
      return null;
  }
}

function lineOf(symbol: number): PaintPrim["line"] | null {
  switch (symbol) {
    case 0x2f:
    case 0x2571:
      return "up";
    case 0x5c:
    case 0x2572:
      return "down";
    case 0x7c:
    case 0x2502:
    case 0x2503:
      return "bar";
    case 0x2d:
    case 0x2500:
    case 0x2501:
    case 0x5f:
      return "dash";
    default:
      return null;
  }
}

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

function anchorOf(symbol: number): "high" | "low" | "mid" {
  const ch = String.fromCodePoint(symbol);
  if (ch === "." || ch === "," || ch === "_") return "low";
  if (ch === "'" || ch === "`" || ch === '"' || ch === "^") return "high";
  return "mid";
}

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

export type BakedStrip = {
  frames: PaintPrim[][];
  maxFrame: number;
  columns: number;
  rows: number;
};

const BAKE_SEED = 0;

export type BakeOptions = {
  cells: Array<{ col: number; row: number }>;
  columns: number;
  rows: number;
  effect: string;
  stepsPerSecond: number;
  palette: string | null;
};

type RawFrame = {
  w: number;
  h: number;
  symbols: Uint32Array;
  fg: Uint32Array;
  flags: Uint8Array;
};

const BAKE_DECODE_FRAMES_PER_STEP = 8;
const BAKE_COLLECT_FRAMES_PER_STEP = 8;
const BAKE_METRIC_COORDS_PER_STEP = 128;
const BAKE_MEAN_FRAMES_PER_STEP = 64;
const BAKE_SYNC_DRAIN_STEPS = 64;

type BakePhase =
  | "stepping"
  | "prepare"
  | "decoding"
  | "collect"
  | "distances"
  | "means"
  | "ready"
  | "failed";

export type BakeJob = {
  step: (maxSteps: number) => boolean;
  finish: () => BakedStrip | null;
  free: () => void;
};

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

    const freeSession = (): void => {
      if (session === null) return;
      const live = session;
      session = null;
      try {
        live.free();
      } catch {
      }
    };

    const fail = (): boolean => {
      freeSession();
      phase = "failed";
      return false;
    };

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

export function bakeStrip(
  ttfx: TtfxModule,
  opts: BakeOptions,
): BakedStrip | null {
  try {
    const job = beginBake(ttfx, opts);
    if (!job) return null;
    while (job.step(BAKE_SYNC_DRAIN_STEPS)) {
    }
    const out = job.finish();
    try {
      job.free();
    } catch {
    }
    return out;
  } catch {
    return null;
  }
}
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
      alive = session.step();
      read();
    } else {
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
      }
    },
  };
}

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
