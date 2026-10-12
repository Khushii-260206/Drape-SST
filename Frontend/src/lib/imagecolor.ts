import { labDistance, nearestColorLab, rgbToLab, type Lab } from "./colorsample";

/*
 * Local dominant-colour extraction: reads the garment's colours from a small copy of the photo with no network and
 * no AI, in a few milliseconds. The photo is shrunk, the backdrop (found from the photo's border) is set aside, the
 * rest is weighted towards the centre, and the remaining pixels are grouped in CIE Lab and named from the palette.
 * Pure functions on raw pixels, so they run in Node tests; `sampleBlobColors` is the thin browser wrapper.
 *
 * It is a suggestion, not a verdict: a model that can see the whole picture is better at "which thing in this photo
 * is the garment", which is why recognise.ts lets the AI correct it when it has looked.
 */

export type Dominant = {
  /** Palette ids, the main colour first; at most two. */
  colors: string[];
  /** Share (0..1) of the garment pixels that each returned colour covers. */
  shares: number[];
  /** True when the backdrop was clearly separable; false means the whole frame was averaged and is less reliable. */
  separated: boolean;
};

const BUCKET = 8; // Lab units per bucket
const BORDER = 0.07; // outer ring, as a share of each side, that is read as "backdrop"
const BACKDROP_RADIUS = 14; // Lab distance from the backdrop colour that still counts as backdrop
const SECOND_MIN_SHARE = 0.22; // a second colour must cover this much of the garment
const SECOND_MIN_DISTANCE = 18; // ...and look clearly different from the first

function meanLab(items: Lab[]): Lab {
  const n = items.length || 1;
  return { l: items.reduce((a, x) => a + x.l, 0) / n, a: items.reduce((a, x) => a + x.a, 0) / n, b: items.reduce((a, x) => a + x.b, 0) / n };
}

/** `data` is RGBA, row by row, `width` × `height` pixels. */
export function dominantColors(data: Uint8ClampedArray, width: number, height: number): Dominant {
  if (width * height === 0 || data.length < width * height * 4) return { colors: [], shares: [], separated: false };
  const backdrop = findBackdrop(data, width, height);
  const result = histogram(data, width, height, backdrop);
  // Nothing left once the backdrop was removed (a blank frame, or a subject the same colour as the wall): use the whole frame.
  return result ?? histogram(data, width, height, null) ?? { colors: [], shares: [], separated: false };
}

const labAt = (data: Uint8ClampedArray, i: number): Lab => rgbToLab({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] });
const opaque = (data: Uint8ClampedArray, i: number) => data[i * 4 + 3] >= 32;

/** The typical colour around the edge of the photo, trusted only when most of the edge really is one colour. */
function findBackdrop(data: Uint8ClampedArray, width: number, height: number): Lab | null {
  const bx = Math.max(1, Math.round(width * BORDER));
  const by = Math.max(1, Math.round(height * BORDER));
  const edge: Lab[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((x < bx || x >= width - bx || y < by || y >= height - by) && opaque(data, i)) edge.push(labAt(data, i));
    }
  }
  if (edge.length === 0) return null;
  const mean = meanLab(edge);
  const near = edge.filter((e) => labDistance(e, mean) < BACKDROP_RADIUS).length / edge.length;
  return near >= 0.6 ? mean : null;
}

/** Weighted colour histogram of the non-backdrop pixels, named from the palette. Null when no pixels qualify. */
function histogram(data: Uint8ClampedArray, width: number, height: number, backdrop: Lab | null): Dominant | null {
  const buckets = new Map<string, { sum: Lab; w: number }>();
  let total = 0;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const sigma2 = 2 * 0.38 * 0.38;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque(data, i)) continue;
      const lab = labAt(data, i);
      if (backdrop && labDistance(lab, backdrop) < BACKDROP_RADIUS) continue;
      const dx = (x - cx) / width;
      const dy = (y - cy) / height;
      const w = Math.exp(-(dx * dx + dy * dy) / sigma2); // the garment is usually in the middle of the frame
      const key = `${Math.round(lab.l / BUCKET)}|${Math.round(lab.a / BUCKET)}|${Math.round(lab.b / BUCKET)}`;
      const g = buckets.get(key) ?? { sum: { l: 0, a: 0, b: 0 }, w: 0 };
      g.sum = { l: g.sum.l + lab.l * w, a: g.sum.a + lab.a * w, b: g.sum.b + lab.b * w };
      g.w += w;
      buckets.set(key, g);
      total += w;
    }
  }
  if (total === 0 || (backdrop && total < 0.01 * width * height)) return null;

  // Name each bucket; buckets that land on the same palette colour add up.
  const named = new Map<string, { w: number; lab: Lab }>();
  for (const g of buckets.values()) {
    const lab = { l: g.sum.l / g.w, a: g.sum.a / g.w, b: g.sum.b / g.w };
    const { id } = nearestColorLab(lab);
    const prev = named.get(id);
    named.set(id, { w: (prev?.w ?? 0) + g.w, lab: prev && prev.w >= g.w ? prev.lab : lab });
  }
  const ranked = [...named].sort((a, b) => b[1].w - a[1].w);
  const [mainId, main] = ranked[0];
  const out: Dominant = { colors: [mainId], shares: [main.w / total], separated: backdrop !== null };
  for (const [id, v] of ranked.slice(1)) {
    if (v.w / total >= SECOND_MIN_SHARE && labDistance(v.lab, main.lab) >= SECOND_MIN_DISTANCE) {
      out.colors.push(id);
      out.shares.push(v.w / total);
      break;
    }
  }
  return out;
}

const SAMPLE_SIDE = 96;

/** Shrinks the photo to ~96px and reads its colours. Runs in the browser; takes a few milliseconds. */
export async function sampleBlobColors(photo: Blob): Promise<Dominant> {
  const bitmap = await createImageBitmap(photo);
  try {
    const scale = Math.min(1, SAMPLE_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return dominantColors(ctx.getImageData(0, 0, w, h).data, w, h);
  } finally {
    bitmap.close();
  }
}
