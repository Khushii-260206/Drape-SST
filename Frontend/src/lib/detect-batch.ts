import type { Dominant } from "./imagecolor";
import { LlmError } from "./llm";

/*
 * The engine behind "Detect colours" for the whole wardrobe. Before, it asked the AI about every piece, one after another
 * (~3 s each, so a minute for 20 pieces, and every call spent free-tier quota). Now:
 *   1. each photo's colours are read locally first (a few ms, no network);
 *   2. only when that read isn't clear-cut (cluttered background, several competing colours) is the AI asked;
 *   3. AI calls run a few at a time, and one rate-limit answer pauses all workers instead of each rediscovering it.
 * Free of React/DOM so it is tested in Node with fake photos and a fake AI.
 */

export type Detected = { colors: string[]; source: "photo" | "ai" } | { error: string };

/** A local read is trusted when the backdrop was clearly separable and one colour clearly dominates the garment. */
export function localIsConfident(d: Dominant): boolean {
  return d.colors.length > 0 && d.separated && d.shares[0] >= 0.7;
}

const MAX_WAITS_PER_PIECE = 4;
const MAX_WAIT_MS = 90_000;

export type BatchDeps<T extends { id: string }> = {
  loadPhoto: (item: T) => Promise<Blob>;
  local: (photo: Blob) => Promise<Dominant>;
  /** Null when no vision-capable key is connected: then the local read is used as is. */
  ai: ((photo: Blob, item: T, signal: AbortSignal) => Promise<string[]>) | null;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (done: number) => void;
  onWaiting?: (waiting: boolean) => void;
  /** Test seam. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

const realSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

export async function detectBatch<T extends { id: string }>(items: T[], deps: BatchDeps<T>): Promise<Record<string, Detected>> {
  const { signal, concurrency = 3, sleep = realSleep, now = Date.now } = deps;
  const out: Record<string, Detected> = {};
  let next = 0;
  let done = 0;
  let pauseUntil = 0;
  let waiters = 0;

  async function pauseIfNeeded() {
    while (!signal.aborted && now() < pauseUntil) {
      if (waiters++ === 0) deps.onWaiting?.(true);
      await sleep(pauseUntil - now(), signal);
      if (--waiters === 0) deps.onWaiting?.(false);
    }
  }

  async function one(item: T): Promise<Detected> {
    const photo = await deps.loadPhoto(item);
    let local: Dominant | null = null;
    try {
      local = await deps.local(photo);
    } catch {
      local = null; // a browser that can't read pixels: the AI (if any) decides
    }
    if (local && local.colors.length > 0 && (!deps.ai || localIsConfident(local))) return { colors: local.colors, source: "photo" };
    if (!deps.ai) return { error: "Couldn't read this photo's colours on this device." };

    for (let attempt = 0; ; attempt++) {
      await pauseIfNeeded();
      if (signal.aborted) return { error: "Stopped" };
      try {
        return { colors: await deps.ai(photo, item, signal), source: "ai" };
      } catch (e) {
        if (signal.aborted) return { error: "Stopped" };
        const rate = e instanceof LlmError && e.kind === "rate";
        const wait = e instanceof LlmError ? (e.retryAfterMs ?? 20_000) : 0;
        if (rate && attempt < MAX_WAITS_PER_PIECE && wait <= MAX_WAIT_MS) {
          pauseUntil = Math.max(pauseUntil, now() + Math.min(60_000, Math.max(5_000, wait + 500)));
          continue;
        }
        // The AI is unavailable for this piece: a clear local read is still better than nothing.
        if (local && local.colors.length > 0) return { colors: local.colors, source: "photo" };
        return { error: e instanceof Error ? e.message : "Couldn't detect" };
      }
    }
  }

  async function worker() {
    while (!signal.aborted) {
      const item = items[next++];
      if (!item) return;
      try {
        out[item.id] = await one(item);
      } catch (e) {
        out[item.id] = { error: e instanceof Error ? e.message : "Couldn't read this photo." };
      }
      deps.onProgress?.(++done);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, worker));
  return out;
}
