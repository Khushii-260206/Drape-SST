import { CATEGORIES, COLORS, TYPES_BY_CATEGORY, categoryOfType, colorLabel, isKnownType, typeLabel } from "./catalog";
import { photoToAnalysisUrl } from "./image";
import { completeVision, LlmError, type LlmPart } from "./llm";
import { PROVIDERS } from "./providers";
import type { ProviderKey } from "./router";
import type { CategoryId } from "./types";

/*
 * AI clothing recognition for the Add-a-piece form: one vision request that looks at the photo and answers in JSON,
 * which is then checked field by field against the app's own catalogue. The model never writes anything straight into
 * the form: an id that isn't in the catalogue, an attribute outside the allowed words, or a made-up number is dropped,
 * so what comes back is always something the edit form, filters and stylist already understand. Results are suggestions:
 * every field stays editable.
 *
 * Fields with no column of their own (pattern, material, sleeves, neckline, fit) are written into the piece's Details
 * text, which the stylist reads. Nothing here needs a database change.
 *
 * Plain TypeScript with no React imports, so it is exercised from Node with a fake `complete`.
 */

export const PATTERNS = ["solid", "striped", "checked", "plaid", "floral", "polka-dot", "graphic", "printed", "colour-blocked", "textured"] as const;
export const SLEEVES = ["sleeveless", "short", "three-quarter", "long"] as const;
export const NECKLINES = ["crew", "v-neck", "scoop", "collared", "polo collar", "henley", "turtleneck", "boat", "square", "halter", "off-shoulder", "hooded", "strapless", "cowl"] as const;
export const FITS = ["fitted", "slim", "regular", "relaxed", "oversized", "cropped"] as const;
/** Looks that can be judged from a photo. Never blends, percentages or care-label claims. */
export const MATERIALS = ["knit", "denim", "leather", "suede", "lace", "satin", "silk-look", "linen-look", "cotton-look", "corduroy", "fleece", "velvet", "mesh", "sequin", "wool-look"] as const;
export type Confidence = "high" | "medium" | "low";

export type Recognition = {
  type: string;
  category: CategoryId;
  /** Built from the checked fields below, so it can never disagree with `type`. */
  name: string;
  /** Palette ids, main first, at most two. May be empty if the model named none that the palette has. */
  colors: string[];
  pattern?: (typeof PATTERNS)[number];
  material?: (typeof MATERIALS)[number];
  sleeve?: (typeof SLEEVES)[number];
  neckline?: (typeof NECKLINES)[number];
  fit?: (typeof FITS)[number];
  confidence: Confidence;
  /** Other plausible types when the model wasn't sure (catalogue ids, never the same as `type`). */
  alternatives: string[];
  /** Ready-made text for the Details box. */
  details: string;
  model?: string;
};

// ---------------------------------------------------------------- prompt

function taxonomyText(): string {
  return CATEGORIES.map((c) => {
    const types = TYPES_BY_CATEGORY[c.id].filter((t) => !t.id.startsWith("other-"));
    // Tops get a visual cue each: that's where look-alikes (tee/polo/henley, hoodie/sweatshirt, blouse/tunic) get mixed up.
    const body = c.id === "top" ? types.map((t) => `\n    ${t.id}: ${t.label}${t.hint ? ` (${t.hint})` : ""}`).join("") : " " + types.map((t) => `${t.id}`).join(", ");
    return `  ${c.label.toUpperCase()} [${c.id}]:${body}`;
  }).join("\n");
}

export function recognitionPrompt(): string {
  return (
    `You are cataloguing one clothing item from a photo for a wardrobe app. Look at the garment itself and ignore the background, hanger, floor or person wearing it.\n\n` +
    `Choose "type" from EXACTLY these ids (the fallback "other-top", "other-bottom", "other-onepiece", "other-outerwear", "other-ethnic", "other-footwear", "other-accessory" is allowed when nothing fits):\n${taxonomyText()}\n\n` +
    `Decide the type from visible evidence: collar, buttons, hood, neckline, sleeve length, hem length, how it closes, how thick the knit is. ` +
    `If two types are plausible, pick the likelier one and list the other in "alternatives" with a lower "confidence".\n\n` +
    `Colours: use ONLY these ids: ${COLORS.map((c) => c.id).join(", ")}. "colors" is the main colour first, then a second only if it covers a large part of the garment (not logos, buttons or stitching). Correct for dim or warm lighting.\n\n` +
    `Only report what you can SEE. Use null for anything you cannot judge from the photo; never guess fabric blends, brands, sizes or care details.\n` +
    `  pattern: ${PATTERNS.join(" | ")} | null\n  sleeve: ${SLEEVES.join(" | ")} | null (tops, dresses, outerwear only)\n  neckline: ${NECKLINES.join(" | ")} | null\n  fit: ${FITS.join(" | ")} | null\n  material: ${MATERIALS.join(" | ")} | null (only a clearly visible look, e.g. knit, denim, leather)\n\n` +
    `Reply with JSON only, no prose and no code fence:\n` +
    `{"type":"id","colors":["id"],"pattern":null,"material":null,"sleeve":null,"neckline":null,"fit":null,"confidence":"high|medium|low","alternatives":["id"]}`
  );
}

// ---------------------------------------------------------------- parsing and validation

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");

const TYPE_SYNONYMS: Record<string, string> = {
  tee: "tshirt", tshirt: "tshirt", teeshirt: "tshirt", shortsleevetee: "tshirt",
  poloshirt: "polo", golfshirt: "polo",
  buttondown: "button-down", buttondownshirt: "button-down", buttonup: "button-down", buttonupshirt: "button-down", oxfordshirt: "button-down", oxford: "button-down",
  dressshirt: "formal-shirt", formalshirt: "formal-shirt",
  casualshirt: "shirt", flannelshirt: "shirt", flannel: "shirt",
  tanktop: "tank", vest: "tank", vesttop: "tank", singlet: "tank", sleevelesstop: "tank", muscletee: "tank",
  cami: "camisole", camitop: "camisole", spaghettistrap: "camisole",
  croptop: "crop-top", croppedtop: "crop-top",
  body: "bodysuit", leotard: "bodysuit",
  sweatshirts: "sweatshirt", crewneck: "sweatshirt", crewnecksweatshirt: "sweatshirt", pullover: "sweater", jumper: "sweater", knitwear: "sweater",
  hooded: "hoodie", hoody: "hoodie", zipup: "hoodie",
  roll: "turtleneck", rollneck: "turtleneck", polonecksweater: "turtleneck", mockneck: "turtleneck",
  top: "other-top", longtunic: "tunic", kurtatop: "tunic",
  pants: "trousers", slacks: "trousers", jean: "jeans", denimjeans: "jeans", sneaker: "sneakers", trainers: "sneakers",
};

/** Accepts a catalogue id, its label, or a common synonym. */
export function normalizeType(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const id = raw.trim().toLowerCase();
  if (isKnownType(id)) return id;
  const sq = squash(raw);
  for (const cat of CATEGORIES) for (const t of TYPES_BY_CATEGORY[cat.id]) if (squash(t.id) === sq || squash(t.label) === sq) return t.id;
  return TYPE_SYNONYMS[sq] && isKnownType(TYPE_SYNONYMS[sq]) ? TYPE_SYNONYMS[sq] : null;
}

/** Accepts a palette id or label ("Light blue", "light_blue"). */
export function normalizeColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const sq = squash(raw);
  const hit = COLORS.find((c) => squash(c.id) === sq || squash(c.label) === sq);
  if (hit) return hit.id;
  if (sq === "multicolour" || sq === "multicolor" || sq === "multi") return "multicolor";
  if (sq === "gray") return "grey";
  if (sq === "offwhite" || sq === "ivory") return "off-white";
  return null;
}

function oneOf<T extends string>(list: readonly T[], raw: unknown): T | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase().replace(/_/g, "-");
  return list.find((x) => x === v || squash(x) === squash(v));
}

/** Pulls the first JSON object out of a reply, tolerating code fences and chatter around it. */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text;
  const start = fenced.indexOf("{");
  if (start < 0) return null;
  // Balanced-brace scan so a trailing "{...}" in the chatter doesn't break the parse.
  let depth = 0;
  let inString = false;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(fenced.slice(start, i + 1));
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const OTHER_BY_CATEGORY: Record<CategoryId, string> = {
  top: "other-top", bottom: "other-bottom", onepiece: "other-onepiece", outerwear: "other-outerwear",
  ethnic: "other-ethnic", footwear: "other-footwear", accessory: "other-accessory",
};

export class RecognitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecognitionError";
  }
}

/** Sleeves and necklines make no sense on shoes or a watch; drop them rather than show nonsense. */
const WEARABLE_ON_BODY: CategoryId[] = ["top", "onepiece", "outerwear", "ethnic"];

export function parseRecognition(text: string, model?: string): Recognition {
  const json = extractJson(text);
  if (!json) throw new RecognitionError("The AI's answer wasn't in a form I could read.");

  let type = normalizeType(json.type);
  if (!type) {
    // The model named a category ("top") instead of a type: use that category's catch-all.
    const cat = typeof json.category === "string" ? CATEGORIES.find((c) => c.id === json.category) : undefined;
    if (cat) type = OTHER_BY_CATEGORY[cat.id];
  }
  if (!type) throw new RecognitionError("The AI couldn't tell what kind of piece this is.");
  const category = categoryOfType(type)!;

  const rawColors = Array.isArray(json.colors) ? json.colors : typeof json.colors === "string" ? [json.colors] : [];
  const colors = Array.from(new Set(rawColors.map(normalizeColor).filter((c): c is string => c !== null))).slice(0, 2);

  const body = WEARABLE_ON_BODY.includes(category);
  const pattern = oneOf(PATTERNS, json.pattern);
  const material = oneOf(MATERIALS, json.material);
  const sleeve = body ? oneOf(SLEEVES, json.sleeve) : undefined;
  const neckline = body ? oneOf(NECKLINES, json.neckline) : undefined;
  const fit = oneOf(FITS, json.fit);

  const alternatives = (Array.isArray(json.alternatives) ? json.alternatives : [])
    .map(normalizeType)
    .filter((t): t is string => t !== null && t !== type)
    .filter((t, i, a) => a.indexOf(t) === i)
    .slice(0, 3);
  let confidence: Confidence = json.confidence === "high" || json.confidence === "medium" || json.confidence === "low" ? json.confidence : "medium";
  // An "other-*" answer, or a model that lists rivals but claims to be sure, isn't "high".
  if (type.startsWith("other-")) confidence = confidence === "high" ? "medium" : confidence;
  if (alternatives.length > 0 && confidence === "high") confidence = "medium";

  const rec: Recognition = { type, category, name: "", colors, pattern, material, sleeve, neckline, fit, confidence, alternatives, details: "", model };
  rec.name = displayName(rec);
  rec.details = detailsText(rec);
  return rec;
}

// ---------------------------------------------------------------- text built from the checked fields

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "White linen-look button-down shirt": colour, pattern (unless plain), material, then the catalogue label. */
export function displayName(r: Pick<Recognition, "type" | "colors" | "pattern" | "material">): string {
  const parts = [
    r.colors[0] ? colorLabel(r.colors[0]) : "",
    r.pattern && r.pattern !== "solid" ? r.pattern : "",
    r.material ?? "",
    typeLabel(r.type).toLowerCase(),
  ].filter(Boolean);
  return cap(parts.join(" ").replace(/\s+/g, " "));
}

/** The Details sentence: only what the AI could see, in plain words, so the stylist can use it and the user can edit it. */
export function detailsText(r: Pick<Recognition, "type" | "pattern" | "material" | "sleeve" | "neckline" | "fit">): string {
  const bits: string[] = [];
  if (r.pattern && r.pattern !== "solid") bits.push(`${r.pattern} pattern`);
  if (r.material) bits.push(`${r.material.replace("-look", " look")}`);
  if (r.sleeve) bits.push(r.sleeve === "sleeveless" ? "sleeveless" : `${r.sleeve.replace("-", " ")} sleeves`);
  if (r.neckline) bits.push(`${r.neckline} neckline`);
  if (r.fit) bits.push(`${r.fit} fit`);
  return bits.length ? `${cap(typeLabel(r.type).toLowerCase())}: ${bits.join(", ")}.` : "";
}

// ---------------------------------------------------------------- cache and in-flight dedupe

/*
 * Results are kept in memory only, per signed-in account, keyed by a hash of the photo's bytes. Choosing the same photo
 * again (or hitting Retry after editing something unrelated) never pays for a second AI call, and two overlapping asks
 * for the same photo share one request. Nothing is written to disk and the whole thing is dropped when the account
 * changes (see forget.ts), so one account's results can never be served to another.
 */
const MAX_CACHED = 24;
const cache = new Map<string, Recognition>();
const inflight = new Map<string, Promise<Recognition>>();

export function clearRecognitionCache(): void {
  cache.clear();
  inflight.clear();
}

async function photoKey(photo: Blob, scope: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await photo.arrayBuffer());
  return `${scope}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export type RecognizeOptions = {
  keys: ProviderKey[];
  /** Whoever is signed in; part of the cache key. */
  scope: string;
  signal?: AbortSignal;
  /** Test seam: replaces the network call. */
  complete?: (image: string, prompt: string, signal?: AbortSignal) => Promise<{ text: string; model: string }>;
  /** Test seam: replaces photo → data URL. */
  prepare?: (photo: Blob) => Promise<string>;
};

/** True when at least one connected provider has a model that can look at photos. */
export const canRecognize = (keys: ProviderKey[]): boolean => keys.some((k) => PROVIDERS[k.provider].visionModels.length > 0);

export const NO_VISION_MESSAGE = "Recognising photos needs a Gemini or OpenRouter key. Add one in Settings, or fill the piece in by hand.";

async function ask(photo: Blob, o: RecognizeOptions): Promise<Recognition> {
  const image = await (o.prepare ?? photoToAnalysisUrl)(photo);
  const prompt = recognitionPrompt();
  const call =
    o.complete ??
    ((url: string, text: string, signal?: AbortSignal) => {
      const parts: LlmPart[] = [{ type: "text", text }, { type: "image_url", image_url: { url } }];
      return completeVision(o.keys, parts, { signal, maxTokens: 700, temperature: 0.1 });
    });
  const { text, model } = await call(image, prompt, o.signal);
  return parseRecognition(text, model);
}

/**
 * Looks at one photo and returns a checked suggestion. Throws LlmError (provider trouble, no key, offline) or
 * RecognitionError (an unreadable answer). A cached result for the same photo and account is returned without a request.
 */
export async function recognizePhoto(photo: Blob, o: RecognizeOptions): Promise<Recognition> {
  if (!o.complete && !canRecognize(o.keys)) throw new LlmError(NO_VISION_MESSAGE, "auth");
  const key = await photoKey(photo, o.scope);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = ask(photo, o)
    .then((rec) => {
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
      cache.set(key, rec);
      return rec;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
