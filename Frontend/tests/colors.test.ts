// Palette and local colour extraction. Pure functions on synthetic pixels: no browser, no network, no AI.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { COLORS, COLOR_GROUPS, colorHex, colorLabel, isKnownColor, itemTitle } from "../src/lib/catalog";
import { nearestColor } from "../src/lib/colorsample";
import { dominantColors } from "../src/lib/imagecolor";

type Rgb = [number, number, number];
const hex = (id: string): Rgb => {
  const n = parseInt(colorHex(id).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A w×h picture: `bg` everywhere, then `paint(x, y)` may return a colour for a pixel (the "garment"). */
function picture(w: number, h: number, bg: Rgb, paint: (x: number, y: number) => Rgb | null = () => null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? bg;
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return data;
}
const centre = (w: number, h: number) => (x: number, y: number) => x > w * 0.25 && x < w * 0.75 && y > h * 0.2 && y < h * 0.85;

describe("palette", () => {
  test("is much larger than before and every id is unique, kebab-case and grouped", () => {
    assert.ok(COLORS.length >= 50, `only ${COLORS.length} colours`);
    const ids = COLORS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^[a-z]+(-[a-z]+)*$/.test(id)));
    const groups = new Set(COLOR_GROUPS.map((g) => g.id));
    assert.ok(COLORS.every((c) => groups.has(c.group)), "every colour belongs to a listed group");
    assert.ok(COLORS.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
    assert.equal(new Set(COLORS.map((c) => c.hex)).size, COLORS.length, "no two colours share a swatch");
  });

  test("every colour that existed before still exists with the same id (saved pieces and filters keep working)", () => {
    const legacy = ["black", "white", "grey", "charcoal", "navy", "blue", "light-blue", "denim", "teal", "green", "olive", "mint", "yellow", "mustard",
      "orange", "rust", "red", "maroon", "pink", "blush", "purple", "lavender", "brown", "tan", "beige", "cream", "khaki", "gold", "silver", "multicolor"];
    for (const id of legacy) assert.ok(isKnownColor(id), id);
  });

  test("covers the requested families", () => {
    for (const id of ["off-white", "light-grey", "taupe", "camel", "burgundy", "olive", "sage", "indigo", "rose", "plum", "rose-gold", "bronze", "terracotta", "forest"])
      assert.ok(isKnownColor(id), id);
  });

  test("unknown ids fall back to something readable instead of crashing", () => {
    assert.equal(isKnownColor("nonexistent"), false);
    assert.equal(colorLabel("nonexistent"), "nonexistent");
    assert.equal(itemTitle({ type: "tshirt", colors: ["burgundy", "off-white"] }), "Burgundy + Off-white T-shirt");
  });

  test("every swatch is readable on its own: a label exists and labels are unique", () => {
    assert.equal(new Set(COLORS.map((c) => c.label)).size, COLORS.length);
  });

  test("pixel matching names exact swatches correctly and never invents a metallic", () => {
    for (const c of COLORS.filter((c) => c.group !== "metallic" && c.group !== "pattern")) {
      const [r, g, b] = hex(c.id);
      assert.equal(nearestColor({ r, g, b }).id, c.id, c.id);
    }
    const [r, g, b] = hex("gold");
    assert.notEqual(nearestColor({ r, g, b }).id, "gold");
  });
});

describe("dominantColors (local, no AI)", () => {
  const W = 96;
  const H = 96;
  const inCentre = centre(W, H);

  test("a navy tee on a white backdrop reads as navy, one colour", () => {
    const d = dominantColors(picture(W, H, [250, 250, 250], (x, y) => (inCentre(x, y) ? hex("navy") : null)), W, H);
    assert.deepEqual(d.colors, ["navy"]);
    assert.equal(d.separated, true);
  });

  test("a white tee on a brown floor is white, not brown", () => {
    const d = dominantColors(picture(W, H, hex("brown"), (x, y) => (inCentre(x, y) ? [246, 246, 244] : null)), W, H);
    assert.equal(d.colors[0], "white");
    assert.ok(!d.colors.includes("brown"));
  });

  test("a burgundy piece on a grey wall is burgundy", () => {
    const d = dominantColors(picture(W, H, [200, 200, 200], (x, y) => (inCentre(x, y) ? hex("burgundy") : null)), W, H);
    assert.equal(d.colors[0], "burgundy");
  });

  test("a two-tone piece returns main + second, in order of area", () => {
    const d = dominantColors(
      picture(W, H, [250, 250, 250], (x, y) => (inCentre(x, y) ? (y < H * 0.55 ? hex("olive") : hex("cream")) : null)),
      W,
      H
    );
    assert.equal(d.colors.length, 2);
    assert.ok(d.colors.includes("olive") || d.colors.includes("khaki"));
  });

  test("a small logo is ignored: still a single colour", () => {
    const d = dominantColors(
      picture(W, H, [250, 250, 250], (x, y) => (Math.abs(x - 48) < 4 && Math.abs(y - 40) < 4 ? [220, 20, 20] : inCentre(x, y) ? hex("black") : null)),
      W,
      H
    );
    assert.deepEqual(d.colors, ["black"]);
  });

  test("a garment filling the whole frame (no separable backdrop) still reads its colour", () => {
    const d = dominantColors(picture(W, H, hex("forest")), W, H);
    assert.equal(d.colors[0], "forest");
  });

  test("a subject the same colour as the wall falls back to the whole frame instead of returning nothing", () => {
    const d = dominantColors(picture(W, H, hex("sage")), W, H);
    assert.equal(d.colors[0], "sage");
  });

  test("transparent pixels (cut-out PNGs) are ignored", () => {
    const data = picture(W, H, [0, 0, 0], (x, y) => (inCentre(x, y) ? hex("red") : null));
    for (let i = 0; i < W * H; i++) if (data[i * 4] === 0 && data[i * 4 + 1] === 0) data[i * 4 + 3] = 0;
    assert.equal(dominantColors(data, W, H).colors[0], "red");
  });

  test("empty or short buffers return no colours, not an exception", () => {
    assert.deepEqual(dominantColors(new Uint8ClampedArray(0), 0, 0).colors, []);
    assert.deepEqual(dominantColors(new Uint8ClampedArray(8), 10, 10).colors, []);
  });

  test("speed: a 96×96 sample is read in a few milliseconds", () => {
    const data = picture(W, H, [250, 250, 250], (x, y) => (inCentre(x, y) ? hex("denim") : null));
    dominantColors(data, W, H); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) dominantColors(data, W, H);
    const per = (performance.now() - t0) / 20;
    console.log(`  [local measurement] dominantColors 96x96: ${per.toFixed(2)} ms per photo`);
    assert.ok(per < 50, `${per} ms`);
  });
});
