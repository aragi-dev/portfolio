export const DOM_CELL_PX = 4;

const DOM_COVERAGE = 0.12;
const DOM_FG_DIST = 48;
const DOM_MIN_ALPHA = 128;
const DOM_BG_R = 8;
const DOM_BG_G = 10;
const DOM_BG_B = 11;
const DOM_MAX_PIXELS = 1_000_000;
const DOM_STYLE_SLICE_NODES = 25;
const DOM_QUANTIZE_SLICE_ROWS = 8;
const DOM_FONT_TIMEOUT_MS = 3000;
const DOM_FALLBACK_FONT =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

export type DomCell = {
  col: number;
  row: number;
  rgb: number;
};

export type DomRaster = {
  cells: DomCell[];
  columns: number;
  rows: number;
};

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
    }
    await yieldToBrowser();

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
    const safeStyle = styleText.replace(/<\//g, "<\\/");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:rgb(8,10,11);">` +
      `<style>${safeStyle}</style>${html}</div></foreignObject></svg>`;
    await yieldToBrowser();

    let decoded: DecodedSvg | null = null;
    try {
      decoded = await decodeSvgImage(svg, width, height);
    } catch {
      decoded = null;
    }
    if (!decoded) return null;
    await yieldToBrowser();

    let canvas: HTMLCanvasElement;
    try {
      canvas = doc.createElement("canvas");
    } catch {
      try {
        decoded.release();
      } catch {
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
      }
      return null;
    }
    try {
      decoded.release();
    } catch {
    }
    await yieldToBrowser();
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
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
        }
      }
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

function yieldToBrowser(): Promise<void> {
  try {
    const scheduler = (
      globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }
    ).scheduler;
    if (scheduler && typeof scheduler.yield === "function") {
      return scheduler.yield();
    }
  } catch {
  }
  return new Promise<void>((resolve) => {
    try {
      setTimeout(resolve, 0);
    } catch {
      resolve();
    }
  });
}

type DecodedSvg = {
  drawable: ImageBitmap | HTMLImageElement;
  release: () => void;
};

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
              }
            },
          };
        }
        try {
          bitmap?.close();
        } catch {
        }
      } catch {
      }
    }
  } catch {
  }

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
    }
    try {
      const loaded = await waitForImageLoad(img);
      return { drawable: loaded, release: () => undefined };
    } catch {
      return null;
    }
  }
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
        }
      }
      target.style.cssText = parts.join("");
    } catch {
    }
    if ((i + 1) % DOM_STYLE_SLICE_NODES === 0 && i + 1 < n) {
      await yieldToBrowser();
    }
  }
}

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
    }
  }
  let out = cssText;
  for (const [raw, href] of targets) {
    try {
      const dataUrl = await fetchFontDataUrl(href);
      if (dataUrl !== "") out = out.split(raw).join(dataUrl);
    } catch {
    }
  }
  return out;
}

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
