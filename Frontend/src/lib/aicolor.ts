import { COLORS, typeLabel } from "./catalog";
import { photoToAnalysisUrl } from "./image";
import { completeVision } from "./llm";
import type { ProviderKey } from "./router";

/*
 * "Detect colours": asks a vision model which of the app's named colours a garment is. Pixel-averaging
 * can't tell the garment from the bedspread behind it or correct for a dim, warm room, so this is
 * done by a model that actually looks at the photo. Only runs when the user asks, and only that photo
 * (a small JPEG) is sent to the AI provider.
 */

const IDS = COLORS.map((c) => c.id);

async function photoToDataUrl(photo: Blob | string): Promise<string> {
  if (photo instanceof Blob) return photoToAnalysisUrl(photo);
  const res = await fetch(photo);
  if (!res.ok) throw new Error("Couldn't load that photo.");
  return photoToAnalysisUrl(await res.blob());
}

function colorPrompt(typeId?: string): string {
  const what = typeId ? typeLabel(typeId).toLowerCase() : "clothing item";
  return (
    `This photo shows one clothing item: a ${what}. Ignore the background (bed, floor, hands, other items). ` +
    `What colour is the ${what} itself? Give the MAIN colour first. Add a second colour ONLY if it clearly covers ` +
    `at least a quarter of the item (a two-tone body or big panels); small logos, prints, stitching, labels, buttons ` +
    `and soles do NOT count. When in doubt return just one colour. Use ONLY these ids: ${IDS.join(", ")}. ` +
    `Judge the true colour of the fabric, correcting for dim or warm lighting (white clothes often look beige or grey ` +
    `in photos). Reply with JSON only: {"colors": ["main"]} or {"colors": ["main", "second"]}`
  );
}

/** Reads the model's reply into at most two valid colour ids (main first). Tolerates chatter around the JSON. */
function parseColors(text: string): string[] {
  const valid = (v: unknown): v is string => typeof v === "string" && IDS.includes(v.trim().toLowerCase());
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json) {
    try {
      const list = (JSON.parse(json) as { colors?: unknown }).colors;
      if (Array.isArray(list)) {
        const ids = list.filter(valid).map((c) => c.trim().toLowerCase());
        return Array.from(new Set(ids)).slice(0, 2);
      }
    } catch {
      // fall through to scanning the text
    }
  }
  // No usable JSON: take the first one or two colour names mentioned, in order.
  const found = Array.from(text.toLowerCase().matchAll(/[a-z]+(?:-[a-z]+)?/g), (m) => m[0]).filter((w) => IDS.includes(w));
  return Array.from(new Set(found)).slice(0, 2);
}

/** Which colours does this garment look like? Rejects if the provider can't answer (all busy, no vision key). */
export async function detectColors(
  photo: Blob | string,
  typeId: string | undefined,
  keys: ProviderKey[],
  signal?: AbortSignal
): Promise<string[]> {
  const url = await photoToDataUrl(photo);
  const { text } = await completeVision(
    keys,
    [
      { type: "text", text: colorPrompt(typeId) },
      { type: "image_url", image_url: { url } },
    ],
    { signal, maxTokens: 800, temperature: 0.1 }
  );
  const colors = parseColors(text);
  if (colors.length === 0) throw new Error("The model couldn't make out a colour in that photo.");
  return colors;
}
