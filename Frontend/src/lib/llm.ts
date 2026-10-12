import { PROVIDERS } from "./providers";
import { recordOutcome } from "./aistatus";
import { coolDown, cooldownMsLeft, markHealthy, planLanes, type ProviderKey } from "./router";
import type { Provider } from "./types";

/*
 * Talks to Gemini / Groq / OpenRouter straight from the browser (all allow CORS, and all speak the
 * OpenAI chat-completions format), so the app can live on static hosting with no backend. Kept free of
 * React/DOM imports and non-erasable TS syntax so the exact same file can be exercised from Node in tests.
 */

export type LlmConfig = { provider: Provider; apiKey: string; model: string };
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export type LlmPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
/** A user turn that includes a photo. */
type VisionMessage = { role: "user"; content: LlmPart[] };
export type StreamEvent = { type: "content"; text: string } | { type: "model"; model: string };
export type LlmErrorKind = "auth" | "rate" | "model" | "network" | "aborted" | "timeout" | "other";

export class LlmError extends Error {
  kind: LlmErrorKind;
  status?: number;
  /** How long the provider said to wait before retrying, when it said. */
  retryAfterMs?: number;
  provider?: Provider;
  constructor(message: string, kind: LlmErrorKind = "other", status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const IDLE_TIMEOUT_MS = 60_000;
/** While another provider is waiting in the wings, give up on a silent one sooner. */
const FAILOVER_FIRST_BYTE_MS = 30_000;

// ------------------------------------------------------------------ errors

/** Reads "try again in 7.2s", "retry in 33s", "6m15.36s", "850ms" or a `retryDelay` field out of an error body. */
function parseRetryDelayMs(text: string): number | undefined {
  const m =
    /(?:try again|retry)\s*(?:in|after)\s*(?:(\d+)\s*m(?!s))?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(text) ??
    /retryDelay"?\s*:\s*"?(?:(\d+)\s*m(?!s))?\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(text);
  if (!m) return undefined;
  const minutes = m[1] ? Number(m[1]) : 0;
  const amount = Number(m[2]);
  const ms = minutes * 60_000 + (m[3].toLowerCase() === "ms" ? amount : amount * 1000);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined;
}

function classify(provider: Provider, status: number, bodyText: string, retryAfterHeader?: string | null): LlmError {
  const name = PROVIDERS[provider].name;
  let detail = "";
  try {
    // Gemini wraps its error in an array: [{ "error": { ... } }]
    const parsed = JSON.parse(bodyText) as unknown;
    const j = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: string }; message?: string };
    detail = j?.error?.message ?? j?.message ?? "";
  } catch {
    detail = bodyText.slice(0, 200);
  }

  const headerMs =
    retryAfterHeader && /^\d+(\.\d+)?$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader) * 1000 : undefined;
  const retryAfterMs = headerMs ?? parseRetryDelayMs(bodyText);
  const tag = (e: LlmError) => {
    e.provider = provider;
    return e;
  };

  // Google answers a bad key with 400 "API key not valid" rather than 401.
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(detail))) {
    return tag(
      new LlmError(
        `${name} rejected your API key. Re-check it in Settings (copy the whole key, with no spaces).`,
        "auth",
        status
      )
    );
  }
  // 413 = this request is bigger than the model's per-minute token allowance (Groq's free tier is small).
  if (status === 429 || status === 413) {
    return tag(
      new LlmError(
        `${name} is rate-limiting this model right now — free models get busy. Wait a few seconds and try again, or pick another model in Settings.`,
        "rate",
        status,
        // Too-large requests won't fit in a second; leave that model alone for a few minutes.
        status === 413 ? 5 * 60_000 : retryAfterMs
      )
    );
  }
  if (status === 402) {
    return tag(new LlmError(`${name} says this model needs credits. Choose a free model in Settings.`, "other", status));
  }
  if (status === 404 || (/model/i.test(detail) && /(not found|does not exist|decommission|no access|unavailable)/i.test(detail))) {
    return tag(new LlmError(`That model isn't available on ${name} right now. Pick another one in Settings.`, "model", status));
  }
  if (status >= 500) {
    return tag(new LlmError(`${name} had a hiccup (${status}). Try again in a moment.`, "other", status, retryAfterMs));
  }
  return tag(new LlmError(detail ? `${name}: ${detail}` : `${name} returned an error (${status}).`, "other", status));
}

type AbortLink = {
  signal: AbortSignal;
  bump: () => void;
  /** The first token has arrived: from now on only a long silence counts as a stall. */
  settle: () => void;
  wasTimeout: () => boolean;
  dispose: () => void;
};

function linkAbort(outer?: AbortSignal, firstByteMs: number = IDLE_TIMEOUT_MS): AbortLink {
  const controller = new AbortController();
  let timedOut = false;
  let limit = firstByteMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bump = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limit);
  };
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onAbort);
  }
  bump();
  return {
    signal: controller.signal,
    bump,
    settle: () => {
      limit = IDLE_TIMEOUT_MS;
      bump();
    },
    wasTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

function toLlmError(e: unknown, link: AbortLink, provider: Provider): LlmError {
  const providerName = PROVIDERS[provider].name;
  if (e instanceof LlmError) {
    e.provider ??= provider;
    return e;
  }
  const name = (e as { name?: string } | null)?.name;
  let err: LlmError;
  if (name === "AbortError") {
    err = link.wasTimeout()
      ? new LlmError(`${providerName} took too long to answer. Try again, or pick a faster model in Settings.`, "timeout")
      : new LlmError("Stopped.", "aborted");
  } else if (e instanceof TypeError) {
    err = new LlmError(
      `Couldn't reach ${providerName}. Check your internet connection (a VPN, firewall or ad-blocker can also block it).`,
      "network"
    );
  } else {
    err = new LlmError(e instanceof Error ? e.message : "Something went wrong talking to the AI.", "other");
  }
  err.provider = provider;
  return err;
}

function throwIfErrorBody(provider: Provider, json: unknown): void {
  if (Array.isArray(json)) json = json[0];
  if (typeof json !== "object" || json === null) return;
  const err = (json as { error?: { code?: unknown } }).error;
  if (!err) return;
  const code = err.code;
  const status =
    typeof code === "number" ? code : typeof code === "string" && /^\d+$/.test(code) ? Number(code) : 500;
  throw classify(provider, status, JSON.stringify({ error: err }));
}

// ------------------------------------------------------------------ requests

async function postChat(
  cfg: LlmConfig,
  model: string,
  messages: (LlmMessage | VisionMessage)[],
  stream: boolean,
  link: AbortLink,
  maxTokens?: number,
  temperature = 0.7
): Promise<Response> {
  const info = PROVIDERS[cfg.provider];
  // Header values must be plain ASCII. A key pasted with a zero-width character or smart quote would
  // otherwise make fetch() throw a TypeError that looks exactly like "no internet".
  if (!/^[\x21-\x7E]+$/.test(cfg.apiKey)) {
    const err = new LlmError(
      `Your ${info.name} API key contains a character it shouldn't (a space, a curly quote or something invisible). Paste it again straight from ${info.name}.`,
      "auth"
    );
    err.provider = cfg.provider;
    throw err;
  }
  const body: Record<string, unknown> = { model, messages, stream, temperature };
  if (cfg.provider === "openrouter") {
    // OpenRouter fails over between models on its own servers: chosen model first, then the defaults.
    body.models = [model, ...PROVIDERS.openrouter.fallbackModels].filter((m, i, a) => a.indexOf(m) === i).slice(0, 3);
  }
  if (maxTokens) body.max_tokens = maxTokens;

  let res: Response;
  try {
    res = await fetch(info.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: link.signal,
    });
  } catch (e) {
    throw toLlmError(e, link, cfg.provider);
  }
  link.bump();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw classify(cfg.provider, res.status, text, res.headers.get("retry-after"));
  }
  return res;
}

async function* readResponse(res: Response, provider: Provider, link: AbortLink): AsyncGenerator<StreamEvent> {
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    // The provider answered without streaming, or sent an error body with HTTP 200.
    const json = (await res.json()) as {
      model?: unknown;
      choices?: { message?: { content?: unknown } }[];
    };
    throwIfErrorBody(provider, json);
    if (typeof json !== "object" || json === null) return;
    if (typeof json.model === "string") yield { type: "model", model: json.model };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text === "string" && text) yield { type: "content", text };
    return;
  }

  if (!res.body) throw new LlmError("The AI provider sent an empty response.", "other");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let announced = false;
  let truncated = false;
  let settled = false;

  function* handleLine(rawLine: string): Generator<StreamEvent, boolean> {
    const line = rawLine.replace(/\r$/, "");
    // Blank lines and ": keep-alive" comments carry no data.
    if (!line || line.startsWith(":") || !line.startsWith("data:")) return false;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return true;

    let json: {
      model?: unknown;
      choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
    };
    try {
      json = JSON.parse(data);
    } catch {
      return false;
    }
    // `data: null` (or any non-object frame) carries nothing for us.
    if (typeof json !== "object" || json === null) return false;
    throwIfErrorBody(provider, json);

    if (!announced && typeof json.model === "string") {
      announced = true;
      yield { type: "model", model: json.model };
    }
    const choice = json.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      if (!settled) {
        settled = true;
        link.settle();
      }
      yield { type: "content", text: content };
    }
    if (choice?.finish_reason === "length") truncated = true;
    return false;
  }

  try {
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      link.bump();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        finished = yield* handleLine(line);
        if (finished) break;
        newline = buffer.indexOf("\n");
      }
    }
    if (!finished && buffer.trim()) yield* handleLine(buffer);
    if (truncated) {
      yield { type: "content", text: "\n\n_(That reply hit the length limit — ask me to continue.)_" };
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }
}

/** One attempt: one provider, one model. Throws an LlmError if it fails. */
async function* streamLane(
  cfg: LlmConfig,
  model: string,
  messages: LlmMessage[],
  signal?: AbortSignal,
  firstByteMs?: number
): AsyncGenerator<StreamEvent> {
  const link = linkAbort(signal, firstByteMs);
  try {
    const res = await postChat(cfg, model, messages, true, link);
    yield* readResponse(res, cfg.provider, link);
  } catch (e) {
    throw toLlmError(e, link, cfg.provider);
  } finally {
    link.dispose();
  }
}

// ------------------------------------------------------------------ rolling across providers

/** How long to leave a lane alone after it failed. */
function cooldownFor(err: LlmError): { scope: "lane" | "provider"; ms: number } {
  switch (err.kind) {
    case "rate":
      return { scope: "lane", ms: err.retryAfterMs ?? 45_000 };
    case "model":
      return { scope: "lane", ms: 30 * 60_000 };
    case "auth":
      return { scope: "provider", ms: 30 * 60_000 };
    case "network":
      return { scope: "provider", ms: 15_000 };
    case "timeout":
      return { scope: "lane", ms: 60_000 };
    default:
      return { scope: "lane", ms: err.retryAfterMs ?? ((err.status ?? 0) >= 500 ? 30_000 : 20_000) };
  }
}

/** Turns "everything failed" into one clear message. */
function describe(errors: LlmError[]): LlmError {
  const names = Array.from(new Set(errors.map((e) => (e.provider ? PROVIDERS[e.provider].name : "")).filter(Boolean)));
  const rate = errors.filter((e) => e.kind === "rate");
  if (rate.length > 0 && errors.every((e) => e.kind !== "auth" && e.kind !== "network")) {
    const waits = rate.map((e) => e.retryAfterMs ?? 45_000);
    const secs = Math.max(5, Math.ceil(Math.min(...waits) / 1000));
    const wait = secs >= 5400 ? `${Math.round(secs / 3600)} hours` : secs >= 90 ? `${Math.ceil(secs / 60)} minutes` : `${secs} seconds`;
    return new LlmError(
      `Every AI provider is busy right now (${names.join(", ")}). The first should be free again in about ${wait} — try again then.`,
      "rate",
      429,
      Math.min(...waits)
    );
  }
  // Mixed failures: report the most useful one (anything that isn't a bad key on a spare provider).
  return errors.find((e) => e.kind !== "auth") ?? errors[0];
}

/**
 * Streams a reply, rolling across every provider that has a key. Each request starts from the next
 * provider in the rotation; a provider or model that is rate-limited (or down, or retired) is put on a
 * short cooldown and the next one answers instead — all before a single word is shown. Once text has
 * started arriving, a failure is reported as usual rather than silently switching mid-sentence.
 *
 * `keys` holds one entry per provider that has an API key.
 */
export async function* streamChatAny(
  keys: ProviderKey[],
  messages: LlmMessage[],
  signal?: AbortSignal,
  rolling: boolean = true
): AsyncGenerator<StreamEvent> {
  const lanes = planLanes(keys, { rolling });
  if (lanes.length === 0) throw new LlmError("Add an API key in Settings to start chatting.", "auth");

  const errors: LlmError[] = [];
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    let produced = false;
    try {
      const last = i === lanes.length - 1;
      const firstByteMs = last ? IDLE_TIMEOUT_MS : FAILOVER_FIRST_BYTE_MS;
      for await (const event of streamLane(lane, lane.model, messages, signal, firstByteMs)) {
        if (event.type === "content") produced = true;
        yield event;
      }
      markHealthy(lane.provider, lane.model);
      recordOutcome(lane.provider, lane.apiKey, { ok: true });
      return;
    } catch (e) {
      const err = e instanceof LlmError ? e : new LlmError(e instanceof Error ? e.message : "Something went wrong.");
      err.provider ??= lane.provider;
      if (!produced) recordOutcome(lane.provider, lane.apiKey, { ok: false, kind: err.kind, message: err.message });
      if (err.kind === "aborted" || produced) throw err;
      errors.push(err);
      const { scope, ms } = cooldownFor(err);
      coolDown(lane.provider, scope === "provider" ? "*" : lane.model, ms);
      // A provider that rejected our key will reject every one of its models: skip them in this plan too.
      if (scope === "provider") {
        for (let j = i + 1; j < lanes.length; j++) if (lanes[j].provider === lane.provider) lanes.splice(j--, 1);
      }
    }
  }
  throw describe(errors);
}

/** Photo questions are small and one-shot, so a silent provider is abandoned quickly and only a couple of lanes are tried. */
const VISION_LANE_TIMEOUT_MS = 20_000;
const VISION_DEADLINE_MS = 35_000;
const VISION_MAX_LANES = 2;

/**
 * One non-streaming answer to a question about a photo. Tries providers that have a vision model (healthy ones
 * first), so a busy provider just means the next one answers. Latency is bounded: at most `maxLanes` attempts, each
 * cut off after `laneTimeoutMs`, and nothing new is started once `deadlineMs` has passed. Without that, a stack of
 * slow providers would multiply the wait (3 lanes × 45 s) before the user even saw an error.
 */
export async function completeVision(
  keys: ProviderKey[],
  parts: LlmPart[],
  opts: { signal?: AbortSignal; maxTokens?: number; temperature?: number; laneTimeoutMs?: number; deadlineMs?: number; maxLanes?: number } = {}
): Promise<{ text: string; model: string }> {
  // One model per provider first (so a silent provider falls over to a different one), then each provider's spare models.
  const perProvider = keys.map((k) => PROVIDERS[k.provider].visionModels.map((model) => ({ ...k, model })));
  const lanes = Array.from({ length: Math.max(0, ...perProvider.map((l) => l.length)) }, (_, d) => perProvider.map((l) => l[d]).filter(Boolean)).flat();
  if (lanes.length === 0) {
    throw new LlmError("Looking at photos needs a Gemini or OpenRouter key. Add one in Settings.", "auth");
  }
  // Healthy lanes first (stable sort keeps the user's provider order); cooling ones last (still tried if nothing else is left).
  lanes.sort((a, b) => Number(cooldownMsLeft(a.provider, a.model) > 0) - Number(cooldownMsLeft(b.provider, b.model) > 0));

  const started = Date.now();
  const deadline = opts.deadlineMs ?? VISION_DEADLINE_MS;
  const errors: LlmError[] = [];
  for (const lane of lanes.slice(0, opts.maxLanes ?? VISION_MAX_LANES)) {
    const left = deadline - (Date.now() - started);
    if (errors.length > 0 && left < 3000) break;
    const link = linkAbort(opts.signal, Math.max(3000, Math.min(opts.laneTimeoutMs ?? VISION_LANE_TIMEOUT_MS, left)));
    try {
      const res = await postChat(lane, lane.model, [{ role: "user", content: parts }], false, link, opts.maxTokens ?? 800, opts.temperature);
      const json = (await res.json()) as { model?: unknown; choices?: { message?: { content?: unknown } }[] } | unknown[];
      throwIfErrorBody(lane.provider, json);
      const first = Array.isArray(json) ? undefined : json;
      const text = first?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new LlmError("The model sent back nothing for that photo.", "other");
      markHealthy(lane.provider, lane.model);
      recordOutcome(lane.provider, lane.apiKey, { ok: true });
      return { text, model: typeof first?.model === "string" ? first.model : lane.model };
    } catch (e) {
      const err = toLlmError(e, link, lane.provider);
      if (err.kind === "aborted") throw err;
      errors.push(err);
      recordOutcome(lane.provider, lane.apiKey, { ok: false, kind: err.kind, message: err.message });
      const { scope, ms } = cooldownFor(err);
      coolDown(lane.provider, scope === "provider" ? "*" : lane.model, ms);
    } finally {
      link.dispose();
    }
  }
  throw describe(errors);
}

/** One tiny non-streaming request, used by Settings to check a key + model actually work. */
export type TestResult = { ok: boolean; message: string; kind?: LlmErrorKind };

export async function testConnection(cfg: LlmConfig, signal?: AbortSignal): Promise<TestResult> {
  const link = linkAbort(signal);
  try {
    const res = await postChat(cfg, cfg.model, [{ role: "user", content: "Reply with just the word: ready" }], false, link, 48);
    const json = (await res.json()) as { model?: unknown } | null;
    throwIfErrorBody(cfg.provider, json);
    const model = typeof json?.model === "string" ? json.model : cfg.model;
    recordOutcome(cfg.provider, cfg.apiKey, { ok: true });
    return { ok: true, message: `Connected — ${model} answered.` };
  } catch (e) {
    const err = toLlmError(e, link, cfg.provider);
    // A rate-limit or missing-model reply still means the key itself was accepted.
    const prefix = err.kind === "rate" || err.kind === "model" ? "Your key works, but: " : "";
    recordOutcome(cfg.provider, cfg.apiKey, { ok: false, kind: err.kind, message: err.message });
    return { ok: false, kind: err.kind, message: prefix + err.message };
  } finally {
    link.dispose();
  }
}
