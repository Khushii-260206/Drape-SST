import { PROVIDERS } from "./providers";
import type { Provider } from "./types";

/*
 * Decides which provider + model answers each request, so one provider hitting its rate limit never
 * blocks the app:
 *   - Rolling: every request starts from the NEXT provider that has a key (Gemini, Groq, OpenRouter, …),
 *     spreading load so no single free tier is hammered.
 *   - Cooldowns: a lane (provider + model) that just failed is skipped for a while — as long as the
 *     provider asked for when it said so — then tried again.
 *   - Failover order: first one model per provider (so every provider gets a turn before any provider's
 *     backup models are burned), then the backup models.
 *
 * Plain TypeScript with no React/DOM imports so it runs in Node tests. State is kept in memory and
 * mirrored to localStorage (when available) so cooldowns survive a reload.
 */

export type ProviderKey = { provider: Provider; apiKey: string; model: string };
export type Lane = ProviderKey;

const STORE_KEY = "drape:router:v1";
const MAX_LANES = 9;
// A provider that says "try again in 21 hours" (daily free-tier cap) is believed, up to this limit; our own
// guesses (45 s, 5 min, …) are all far below it.
const MAX_COOLDOWN_MS = 6 * 3600_000;

type State = { cooldowns: Record<string, number>; cursor: number };
let state: State | null = null;

const laneKey = (provider: Provider, model: string) => `${provider}:${model}`;
const providerKey = (provider: Provider) => `${provider}:*`;

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): State {
  if (state) return state;
  state = { cooldowns: {}, cursor: 0 };
  try {
    const raw = storage()?.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<State>;
      if (typeof parsed.cursor === "number") state.cursor = Math.max(0, Math.floor(parsed.cursor));
      for (const [k, v] of Object.entries(parsed.cooldowns ?? {})) {
        if (typeof v === "number" && v > Date.now()) state.cooldowns[k] = v;
      }
    }
  } catch {
    // corrupt or blocked storage: start fresh
  }
  return state;
}

function save() {
  try {
    storage()?.setItem(STORE_KEY, JSON.stringify(load()));
  } catch {
    // storage full or blocked: cooldowns still work for this session
  }
}

export function cooldownMsLeft(provider: Provider, model: string, now = Date.now()): number {
  const s = load();
  const until = Math.max(s.cooldowns[laneKey(provider, model)] ?? 0, s.cooldowns[providerKey(provider)] ?? 0);
  return Math.max(0, until - now);
}

/** Skip this lane (or, with model = "*", the whole provider) for `ms`. */
export function coolDown(provider: Provider, model: string | "*", ms: number, now = Date.now()) {
  const s = load();
  const key = model === "*" ? providerKey(provider) : laneKey(provider, model);
  const until = now + Math.min(Math.max(ms, 1000), MAX_COOLDOWN_MS);
  s.cooldowns[key] = Math.max(s.cooldowns[key] ?? 0, until);
  save();
}

/** A lane that just worked is healthy again. */
export function markHealthy(provider: Provider, model: string) {
  const s = load();
  let changed = false;
  for (const key of [laneKey(provider, model), providerKey(provider)]) {
    if (key in s.cooldowns) {
      delete s.cooldowns[key];
      changed = true;
    }
  }
  if (changed) save();
}

/** Models to try on one provider: the preferred one first, then its backups (OpenRouter backs up server-side). */
function modelsFor(provider: Provider, preferred: string): string[] {
  if (provider === "openrouter") return [preferred.trim()].filter(Boolean);
  const list = [preferred, ...PROVIDERS[provider].fallbackModels].map((m) => m.trim()).filter(Boolean);
  return Array.from(new Set(list));
}

/**
 * The ordered list of lanes to try for one request.
 * `keys` holds one entry per provider that has an API key (chosen provider first). With `rolling`, the
 * starting provider advances on every call; without it, the order is kept as given.
 */
export function planLanes(keys: ProviderKey[], opts: { rolling: boolean; now?: number } = { rolling: true }): Lane[] {
  const now = opts.now ?? Date.now();
  if (keys.length === 0) return [];
  const s = load();

  let ordered = keys;
  if (opts.rolling && keys.length > 1) {
    const start = s.cursor % keys.length;
    ordered = [...keys.slice(start), ...keys.slice(0, start)];
    s.cursor = (s.cursor + 1) % 1_000_000;
    save();
  }

  // Pass 1: each provider's preferred model. Pass 2+: backup models, still one provider at a time.
  const perProvider = ordered.map((k) => modelsFor(k.provider, k.model).map((model): Lane => ({ ...k, model })));
  const lanes: Lane[] = [];
  const depth = Math.max(...perProvider.map((l) => l.length));
  for (let d = 0; d < depth; d++) for (const list of perProvider) if (list[d]) lanes.push(list[d]);

  // Healthy lanes keep their order; cooling-down lanes go last (soonest to recover first) so that, if
  // everything is cooling down, we still try rather than refuse.
  const healthy = lanes.filter((l) => cooldownMsLeft(l.provider, l.model, now) === 0);
  const cooling = lanes
    .filter((l) => cooldownMsLeft(l.provider, l.model, now) > 0)
    .sort((a, b) => cooldownMsLeft(a.provider, a.model, now) - cooldownMsLeft(b.provider, b.model, now));
  return [...healthy, ...cooling].slice(0, MAX_LANES);
}
