// dom-raster: rasterize a live DOM element into a coarse cell grid for
// strip-baking ONLY. The raster is dust geometry: it feeds bakeStrip so
// the overlay canvas can paint falling dust in the same cell language as
// the wordmarks. It NEVER paints the rest state: while a row is whole
// (scrub index 0) the overlay paints nothing and the live DOM shows
// crisp and fully interactive.
//
// Pipeline: clone the element with its effective (computed) styles,
// serialize the clone into the same SVG <foreignObject> bytes as before,
// decode them asynchronously (createImageBitmap off-thread when
// supported, else Image.decode() awaited, else the load gate), draw the
// decoded image into an offscreen canvas at 1:1 CSS px, then quantize
// the pixels to DOM_CELL_PX cells. Stages are separated by macrotask
// yields so no task holds the whole decode. Every step is best-effort:
// ANY failure resolves null, and the caller keeps the element whole
// forever (it simply never disintegrates).

/**
 * Raster cell size in CSS px. Dust geometry, not the resting look:
 * 4px resolves small mono glyph strokes into a few cells each while
 * staying finer than the wordmark cells (~10px), so DOM dust reads as
 * the same speckle language at a text-appropriate scale.
 */
export const DOM_CELL_PX = 4;

/** Minimum fraction of foreground pixels for a cell to count as lit. */
const DOM_COVERAGE = 0.12;
/** Minimum summed channel distance from the page background to ink. */
const DOM_FG_DIST = 48;
/** Minimum alpha to count a pixel at all (below = transparent=empty). */
const DOM_MIN_ALPHA = 128;
/** Page background the overlay erases with (matches FIELD_BG). */
const DOM_BG_R = 8;
const DOM_BG_G = 10;
const DOM_BG_B = 11;
/** Raster size guard: refuse absurd areas before allocating a canvas. */
const DOM_MAX_PIXELS = 1_000_000;
/** Yield between raster stages so no single task holds the whole decode. */
/** Style-copy slice: nodes per chunk before yielding (keeps each chunk ~1ms). */
const DOM_STYLE_SLICE_NODES = 25;
/** Quantize slice: grid rows per chunk before yielding. */
const DOM_QUANTIZE_SLICE_ROWS = 8;
/** Font fetch timeout so a hanging font host cannot stall the bake. */
const DOM_FONT_TIMEOUT_MS = 3000;
/** Fallback mono stack when font inlining fails (dust may shift). */
const DOM_FALLBACK_FONT =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/** One lit raster cell: grid position plus the average ink color. */
export type DomCell = {
  col: number;
  row: number;
  /** 0xRRGGBB average of the cell's foreground pixels. */
  rgb: number;
};

/** Raster result: lit cells over a columns x rows grid. */
export type DomRaster = {
  cells: DomCell[];
  columns: number;
  rows: number;
};

/**
 * Rasterize an element to dust-geometry cells. Resolves null on ANY
 * failure (zero rect, oversize area, clone/serialize error, image load
 * error, tainted canvas on getImageData): the element stays whole.
 * The per-cell rgb records the source ink for sanity checks; the dust
 * the painter draws is inked from the baked strip prims (prim rgb
 * snapped through the resting bands), because prims move away from
 * their source cells as they fall and only the prim color travels.
 *
 * Scheduling (init-only): the pipeline is staged so no synchronous span
 * does the whole decode. Stages: (1) cheap guards + measure, then yield;
 * (2) clone, then yield; (3) computed-style copy in node slices, then
 * yield; (4) best-effort font inlining (already async), then yield;
 * (5) serialize to the same SVG bytes as before, then yield; (6) async
 * decode via createImageBitmap(Blob) when supported (parallel decode)
 * else Image with decode() awaited, else the classic load gate, then
 * yield; (7) fill + drawImage, then yield; (8) getImageData, then yield;
 * (9) quantization in row slices. Every yield is a macrotask (or
 * scheduler.yield), so each stage lands in its own short task and the
 * paint loop can interleave. The SVG bytes, the draw size and the
 * quantization math are unchanged, so the resolved cells are
 * byte-identical to the old pipeline: purely a scheduling change.
 */
export async function rasterizeCells(
  el: Element,
  cellPx: number = DOM_CELL_PX,
): Promise<DomRaster | null> {
  try {
    if (!Number.isFinite(cellPx) || cellPx < 2) return null;
    let width = 0;
    let height = 0;
    try {
      const rect = el.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    } catch {
      return null;
    }
    if (!(width >= cellPx) || !(height >= cellPx)) return null;
    if (width * height > DOM_MAX_PIXELS) return null;
    const doc = el.ownerDocument;
    if (!doc) return null;

    // Leave the caller's task at once: only cheap guards + measure ran
    // above, so a paint-loop kick never blocks on clone/style/decode.
    await yieldToBrowser();

    let clone: Element;
    try {
      clone = el.cloneNode(true) as Element;
    } catch {
      return null;
    }
    await yieldToBrowser();

    try {
      await copyTreeStyles(el, clone);
    } catch {
      return null;
    }
    // Rest-state snapshot: the raster is dust geometry of the resting
    // look, never of a transient state. An entrance animation (delayed
    // fade, rise) would otherwise snapshot mid-flight — e.g. opacity 0
    // during its delay — rasterizing empty and leaving the element whole
    // forever. Neutralize motion on the whole clone subtree AFTER the
    // computed copy above (which overwrites inline styles and would
    // otherwise freeze mid-flight opacity/transform into the snapshot):
    // animations and transitions never belong to the resting look, and
    // opacity/transform are forced to their rest identity so a delayed
    // fade or rise on the root or any descendant cannot empty the raster.
    try {
      const root = clone as HTMLElement;
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      for (const node of nodes) {
        const target = node as HTMLElement;
        if (!target.style) continue;
        target.style.setProperty("animation", "none", "important");
        target.style.setProperty("transition", "none", "important");
        target.style.setProperty("opacity", "1", "important");
        target.style.setProperty("transform", "none", "important");
      }
    } catch {
      /* best-effort: a mid-flight snapshot still resolves, maybe empty */
    }
    await yieldToBrowser();

    // Fonts are best-effort: inline fetched @font-face files as data
    // URLs so SVG metrics match the live layout. On ANY failure the
    // collection resolves "" and the SVG falls back to the generic
    // mono stack (dust geometry may shift slightly: acceptable, this
    // raster never paints the rest state).
    let fontCss = "";
    try {
      fontCss = await collectFontCss(doc);
    } catch {
      fontCss = "";
    }
    await yieldToBrowser();
    const styleText = fontCss !== "" ? fontCss : `*{font-family:${DOM_FALLBACK_FONT} !important;}`;

    let html = "";
    try {
      const holder = doc.createElement("div");
      holder.appendChild(clone);
      html = holder.innerHTML;
    } catch {
      return null;
    }
    // Escape a literal </style> hiding inside font css so it cannot
    // close the wrapper style element early.
    const safeStyle = styleText.replace(/<\//g, "<\\/");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:rgb(8,10,11);">` +
      `<style>${safeStyle}</style>${html}</div></foreignObject></svg>`;
    // Serialization done; yield before the browser decode so the encode
    // + string build never share a task with rasterization.
    await yieldToBrowser();

    let decoded: DecodedSvg | null = null;
    try {
      decoded = await decodeSvgImage(svg, width, height);
    } catch {
      decoded = null;
    }
    if (!decoded) return null;
    // Decode resolved off-thread (bitmap) or via an awaited decode, so
    // the pixels are ready; yield once more so draw lands on its own.
    await yieldToBrowser();

    let canvas: HTMLCanvasElement;
    try {
      canvas = doc.createElement("canvas");
    } catch {
      try {
        decoded.release();
      } catch {
        /* best-effort release */
      }
      return null;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      try {
        decoded.release();
      } catch {
        /* best-effort release */
      }
      return null;
    }
    try {
      ctx.fillStyle = "rgb(8, 10, 11)";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(decoded.drawable, 0, 0, width, height);
    } catch {
      try {
        decoded.release();
      } catch {
        /* best-effort release */
      }
      return null;
    }
    // The pixels are on the canvas now; release the decoded image
    // before the readback so its memory never outlives the draw.
    try {
      decoded.release();
    } catch {
      /* best-effort release */
    }
    await yieldToBrowser();
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      // Tainted canvas (foreignObject trips some browsers): whole forever.
      return null;
    }
    await yieldToBrowser();
    try {
      return await quantizeCellsSliced(data, width, height, cellPx);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Quantize raw RGBA pixels to lit cells. A cell is lit when at least
 * DOM_COVERAGE of its opaque pixels sit DOM_FG_DIST away from the page
 * background; its ink is the average color of those foreground pixels.
 * Pure (no DOM): exported so the pipeline is probeable without a browser.
 */
export function quantizeCells(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cellPx: number,
): DomRaster {
  const empty: DomRaster = { cells: [], columns: 0, rows: 0 };
  if (!(width > 0) || !(height > 0)) return empty;
  if (data.length < width * height * 4) return empty;
  const cell = Math.max(2, Math.floor(cellPx));
  if (!(cell > 0)) return empty;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: DomCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = col * cell;
      const y0 = row * cell;
      const x1 = Math.min(width, x0 + cell);
      const y1 = Math.min(height, y0 + cell);
      let opaque = 0;
      let fg = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3] < DOM_MIN_ALPHA) continue;
          opaque++;
          const dist =
            Math.abs(data[i] - DOM_BG_R) +
            Math.abs(data[i + 1] - DOM_BG_G) +
            Math.abs(data[i + 2] - DOM_BG_B);
          if (dist < DOM_FG_DIST) continue;
          fg++;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
        }
      }
      if (opaque === 0) continue;
      if (fg / opaque < DOM_COVERAGE) continue;
      const n = Math.max(1, fg);
      const rgb =
        ((Math.round(sr / n) & 0xff) << 16) |
        ((Math.round(sg / n) & 0xff) << 8) |
        (Math.round(sb / n) & 0xff);
      cells.push({ col, row, rgb });
    }
  }
  return { cells, columns, rows };
}

/**
 * Collect the document's @font-face rules with remote url() targets
 * inlined as data URLs, so the SVG raster measures text with the real
 * glyphs. Never throws: cross-origin stylesheets (cssRules access
 * throws), unparsable rules and failed/slow font fetches are skipped,
 * resolving "" (the caller falls back to the generic mono stack).
 * Exported so the graceful-degradation path is probeable.
 */
export async function collectFontCss(doc: Document): Promise<string> {
  try {
    const out: string[] = [];
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i] as CSSStyleSheet | undefined;
      if (!sheet) continue;
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        // Cross-origin stylesheet (e.g. a font CDN link): skip it.
        continue;
      }
      if (!rules) continue;
      for (let r = 0; r < rules.length; r++) {
        let text = "";
        try {
          text = rules[r].cssText;
        } catch {
          continue;
        }
        if (!text) continue;
        const head = text.trimStart().slice(0, 10).toLowerCase();
        if (head !== "@font-face") continue;
        try {
          const inlined = await inlineFontUrls(text, doc.baseURI);
          if (inlined !== "") out.push(inlined);
        } catch {
          // One bad rule never kills the collection.
        }
      }
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

/**
 * Yield to the browser event loop so the next raster stage lands in its
 * own short task. Prefers scheduler.yield() when available (an explicit
 * cooperative yield); otherwise a setTimeout(0) macrotask. A microtask
 * await alone would NOT split a long task: microtasks drain inside the
 * same task, so only a macrotask (or scheduler yield) breaks it. Never
 * throws; import-safe (no DOM needed).
 */
function yieldToBrowser(): Promise<void> {
  try {
    const scheduler = (
      globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }
    ).scheduler;
    if (scheduler && typeof scheduler.yield === "function") {
      return scheduler.yield();
    }
  } catch {
    /* fall through to the timer */
  }
  return new Promise<void>((resolve) => {
    try {
      setTimeout(resolve, 0);
    } catch {
      resolve();
    }
  });
}

/** Decoded SVG ready for drawImage, with its release hook. */
type DecodedSvg = {
  drawable: ImageBitmap | HTMLImageElement;
  release: () => void;
};

/**
 * Decode the serialized SVG without a synchronous whole-image stall.
 * Path 1 (preferred): createImageBitmap(new Blob([svg])) — the browser
 * decodes in parallel and the await yields, so no task holds the decode.
 * Supported in Chromium/Firefox for SVG blobs with explicit width/height
 * (which ours always carries); Safari rejects SVG blobs, which falls
 * through. Path 2: HTMLImageElement with decode() awaited (async decode
 * + a yield between serialize and draw). Path 3: the classic load gate
 * (same bytes as the old pipeline). The 1:1 size check keeps every path
 * byte-identical: a bitmap whose intrinsic size mismatches is discarded
 * instead of drawn scaled (scaling would shift dust). Never throws:
 * null means "keep the element whole", like every raster failure.
 */
async function decodeSvgImage(
  svg: string,
  width: number,
  height: number,
): Promise<DecodedSvg | null> {
  try {
    const factory = (
      globalThis as unknown as { createImageBitmap?: unknown }
    ).createImageBitmap;
    if (typeof factory === "function") {
      try {
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const bitmap = await (
          factory as (blob: Blob) => Promise<ImageBitmap>
        ).call(globalThis, blob);
        if (bitmap && bitmap.width === width && bitmap.height === height) {
          return {
            drawable: bitmap,
            release: () => {
              try {
                bitmap.close();
              } catch {
                /* best-effort release */
              }
            },
          };
        }
        try {
          bitmap?.close();
        } catch {
          /* best-effort release */
        }
        // Size mismatch: fall through to the Image path (never scale).
      } catch {
        // Unsupported blob type or decode failure: fall through.
      }
    }
  } catch {
    /* fall through to the Image path */
  }

  // Image path (byte-identical serialization: the same data URL as before).
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  let img: HTMLImageElement;
  try {
    img = new Image();
  } catch {
    return null;
  }
  try {
    img.decoding = "async";
  } catch {
    /* decoding hint is best-effort */
  }
  const decoder = (
    img as HTMLImageElement & { decode?: () => Promise<void> }
  ).decode;
  if (typeof decoder === "function") {
    try {
      img.src = url;
    } catch {
      return null;
    }
    try {
      await decoder.call(img);
      if (img.naturalWidth > 0 && img.complete) {
        return { drawable: img, release: () => undefined };
      }
    } catch {
      /* decode rejects on load failure: the gate below reports it */
    }
    try {
      const loaded = await waitForImageLoad(img);
      return { drawable: loaded, release: () => undefined };
    } catch {
      return null;
    }
  }
  // No decode(): attach the load gate BEFORE setting src so a cached
  // data URL cannot resolve between the two steps; then load.
  let pending: Promise<HTMLImageElement>;
  try {
    pending = waitForImageLoad(img);
  } catch {
    return null;
  }
  try {
    img.src = url;
  } catch {
    return null;
  }
  try {
    const loaded = await pending;
    return { drawable: loaded, release: () => undefined };
  } catch {
    return null;
  }
}

/** Classic image load gate (fallback when decode() is missing). Never throws. */
function waitForImageLoad(img: HTMLImageElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    try {
      if (img.complete && img.naturalWidth > 0) {
        resolve(img);
        return;
      }
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("dom-raster: image load failed"));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Copy the effective (computed) styles of the original tree onto the
 * detached clone, node by node in document order. Locking computed px
 * values keeps the raster layout faithful without the live cascade.
 * Best-effort per node: never throws out. Sliced: yields every
 * DOM_STYLE_SLICE_NODES nodes so a large tree never blocks one task;
 * the per-node math is unchanged, so the clone is identical to the old
 * synchronous copy.
 */
async function copyTreeStyles(orig: Element, clone: Element): Promise<void> {
  const view = orig.ownerDocument.defaultView;
  if (!view) return;
  let origs: Element[];
  let clones: Element[];
  try {
    origs = [orig, ...Array.from(orig.querySelectorAll("*"))];
    clones = [clone, ...Array.from(clone.querySelectorAll("*"))];
  } catch {
    return;
  }
  const n = Math.min(origs.length, clones.length);
  for (let i = 0; i < n; i++) {
    try {
      const cs = view.getComputedStyle(origs[i]);
      const target = clones[i] as HTMLElement;
      if (!target.style) continue;
      const parts: string[] = [];
      for (let p = 0; p < cs.length; p++) {
        const prop: string | undefined = cs[p];
        if (!prop) continue;
        try {
          const val = cs.getPropertyValue(prop);
          if (val !== "") parts.push(`${prop}:${val};`);
        } catch {
          // One bad property never kills the node.
        }
      }
      target.style.cssText = parts.join("");
    } catch {
      // One bad node never kills the tree.
    }
    if ((i + 1) % DOM_STYLE_SLICE_NODES === 0 && i + 1 < n) {
      await yieldToBrowser();
    }
  }
}

/**
 * Sliced quantization: the exact math of quantizeCells, chunked by grid
 * rows with a yield every DOM_QUANTIZE_SLICE_ROWS rows. The thresholds
 * (DOM_COVERAGE, DOM_FG_DIST, DOM_MIN_ALPHA, background) read the same
 * constants, so output is byte-identical to quantizeCells on the same
 * pixels. quantizeCells stays the exported pure reference for probes.
 * Exported so the sliced pipeline is probeable without a browser.
 */
export async function quantizeCellsSliced(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cellPx: number,
): Promise<DomRaster> {
  const empty: DomRaster = { cells: [], columns: 0, rows: 0 };
  if (!(width > 0) || !(height > 0)) return empty;
  if (data.length < width * height * 4) return empty;
  const cell = Math.max(2, Math.floor(cellPx));
  if (!(cell > 0)) return empty;
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: DomCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const x0 = col * cell;
      const y0 = row * cell;
      const x1 = Math.min(width, x0 + cell);
      const y1 = Math.min(height, y0 + cell);
      let opaque = 0;
      let fg = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          if (data[i + 3] < DOM_MIN_ALPHA) continue;
          opaque++;
          const dist =
            Math.abs(data[i] - DOM_BG_R) +
            Math.abs(data[i + 1] - DOM_BG_G) +
            Math.abs(data[i + 2] - DOM_BG_B);
          if (dist < DOM_FG_DIST) continue;
          fg++;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
        }
      }
      if (opaque === 0) continue;
      if (fg / opaque < DOM_COVERAGE) continue;
      const count = Math.max(1, fg);
      const rgb =
        ((Math.round(sr / count) & 0xff) << 16) |
        ((Math.round(sg / count) & 0xff) << 8) |
        (Math.round(sb / count) & 0xff);
      cells.push({ col, row, rgb });
    }
    if ((row + 1) % DOM_QUANTIZE_SLICE_ROWS === 0 && row + 1 < rows) {
      await yieldToBrowser();
    }
  }
  return { cells, columns, rows };
}

/** Inline every remote url() in a @font-face block as a data URL. */
async function inlineFontUrls(cssText: string, base: string): Promise<string> {
  const re = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"']+))\s*\)/g;
  const targets = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    const raw: string | undefined = m[1] ?? m[2] ?? m[3];
    if (!raw || raw.startsWith("data:")) continue;
    try {
      targets.set(raw, new URL(raw, base).href);
    } catch {
      // Unresolvable URL: leave it; the SVG image context ignores it.
    }
  }
  let out = cssText;
  for (const [raw, href] of targets) {
    try {
      const dataUrl = await fetchFontDataUrl(href);
      if (dataUrl !== "") out = out.split(raw).join(dataUrl);
    } catch {
      // Failed/slow font: keep the remote URL (the SVG image context
      // cannot load it, so the fallback stack applies: acceptable).
    }
  }
  return out;
}

/** Fetch a font file with a timeout and encode it as a data URL. */
function fetchFontDataUrl(href: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error("dom-raster: font fetch timed out"));
      }
    }, DOM_FONT_TIMEOUT_MS);
    fetch(href)
      .then((res) => {
        if (!res.ok) throw new Error(`dom-raster: font ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(typeof reader.result === "string" ? reader.result : "");
        };
        reader.onerror = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(new Error("dom-raster: font read failed"));
        };
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}
