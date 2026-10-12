import { COLORS } from "./catalog";

/*
 * Turning a tapped pixel into the app's nearest named colour (the eyedropper). Matching happens in CIE
 * Lab space, where distance roughly follows how different two colours look (plain RGB distance calls dark
 * navy "black" far too eagerly). Pure functions, no DOM, so they run in Node tests. Working out what colour
 * a whole garment is — ignoring the bedspread behind it — is left to a vision model (see aicolor.ts).
 */

export type Rgb = { r: number; g: number; b: number };
export type Lab = { l: number; a: number; b: number };

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbToHex = ({ r, g, b }: Rgb) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export const labDistance = (p: Lab, q: Lab) => Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);

// Photos are never lit like a swatch, so match against the plain named colours: not the "pattern" option, and not the
// metallics, because a sheen can't be read from pixels (gold, silver and bronze are chosen by hand or by the AI).
const PALETTE = COLORS.filter((c) => c.group !== "pattern" && c.group !== "metallic").map((c) => ({ id: c.id, lab: rgbToLab(hexToRgb(c.hex)) }));

/** The named colour that looks closest to this pixel. */
export function nearestColor(rgb: Rgb): { id: string; distance: number } {
  return nearestColorLab(rgbToLab(rgb));
}

export function nearestColorLab(lab: Lab): { id: string; distance: number } {
  let best = PALETTE[0];
  let bestDist = Infinity;
  for (const p of PALETTE) {
    const d = labDistance(lab, p.lab);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return { id: best.id, distance: bestDist };
}

/** Average colour of a square of pixels around (x, y) — steadier than a single noisy pixel. */
export function sampleAround(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, radius = 4): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let yy = Math.max(0, cy - radius); yy <= Math.min(height - 1, cy + radius); yy++) {
    for (let xx = Math.max(0, cx - radius); xx <= Math.min(width - 1, cx + radius); xx++) {
      const i = (yy * width + xx) * 4;
      if (data[i + 3] < 32) continue; // transparent
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: r / n, g: g / n, b: b / n };
}
