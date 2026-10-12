"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useHydrated } from "./hooks";
import type { LlmConfig } from "./llm";
import { PROVIDERS, PROVIDER_IDS } from "./providers";
import type { AppSettings, Provider } from "./types";

/*
 * Keys come from the build's env (NEXT_PUBLIC_GEMINI_API_KEY / _GROQ_ / _OPENROUTER_) and can be
 * overridden in Settings, which saves to this browser's localStorage. Keys are only ever sent to their
 * own provider. Exposed as an external store so React can read it without hydration flashes.
 */

const STORAGE_KEY = "my-wardrobe:settings:v1";

// Must be written out literally so Next.js can inline them at build time.
const ENV_KEYS = pickStrings({
  gemini: process.env.NEXT_PUBLIC_GEMINI_API_KEY,
  groq: process.env.NEXT_PUBLIC_GROQ_API_KEY,
  openrouter: process.env.NEXT_PUBLIC_OPENROUTER_API_KEY,
});

const DEFAULTS: AppSettings = {
  provider: PROVIDER_IDS.find((p) => ENV_KEYS[p]) ?? PROVIDER_IDS[0],
  rolling: true,
  keys: ENV_KEYS,
  models: {},
};

/** True when this provider's key is the one built into the site (not one pasted in Settings). */
export function isBuiltInKey(provider: Provider, key: string | undefined): boolean {
  return Boolean(key && ENV_KEYS[provider] === key);
}

function pickStrings(value: unknown): Partial<Record<Provider, string>> {
  const out: Partial<Record<Provider, string>> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const p of PROVIDER_IDS) {
    const v = (value as Record<string, unknown>)[p];
    if (typeof v === "string" && v.trim()) out[p] = v.trim();
  }
  return out;
}

function parse(raw: string | null): AppSettings {
  if (!raw) return DEFAULTS;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      provider: PROVIDER_IDS.includes(o.provider as Provider) ? (o.provider as Provider) : DEFAULTS.provider,
      rolling: o.rolling !== false,
      keys: { ...ENV_KEYS, ...pickStrings(o.keys) },
      models: pickStrings(o.models),
    };
  } catch {
    return DEFAULTS;
  }
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: AppSettings | null = null;
const listeners = new Set<() => void>();

function snapshot(): AppSettings {
  if (!current) current = parse(readStorage());
  return current;
}

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      current = parse(readStorage());
      notify();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function update(fn: (s: AppSettings) => AppSettings) {
  const next = fn(snapshot());
  current = next;
  try {
    // Built-in keys are never copied into storage, so a rotated key in the env takes effect on the next deploy.
    const keys = Object.fromEntries(Object.entries(next.keys).filter(([p, k]) => !isBuiltInKey(p as Provider, k)));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, keys }));
  } catch {
    // Private mode / storage blocked: settings still work for this session.
  }
  notify();
}

export function selectProvider(provider: Provider) {
  update((s) => ({ ...s, provider }));
}

export function getRolling(): boolean {
  return snapshot().rolling;
}

export function setRolling(rolling: boolean) {
  update((s) => ({ ...s, rolling }));
}

/**
 * API keys are plain ASCII tokens. Pastes often drag along spaces, line breaks, zero-width characters,
 * smart quotes or wrapping quote marks — any of which breaks the request header — so strip them.
 */
export function cleanKey(raw: string): string {
  return raw.replace(/[^\x21-\x7E]/g, "").replace(/^["'`]+|["'`]+$/g, "");
}

/** Saves a key (and optionally a model) for a provider and makes it the active one. */
export function saveProviderKey(provider: Provider, key: string, model?: string) {
  update((s) => ({
    ...s,
    provider,
    keys: { ...s.keys, [provider]: cleanKey(key) },
    models: model ? { ...s.models, [provider]: model.trim() } : s.models,
  }));
}

export function saveProviderModel(provider: Provider, model: string) {
  update((s) => ({ ...s, models: { ...s.models, [provider]: model.trim() } }));
}

/** Removes a pasted key. If the site has a built-in key for this provider, that one comes back. */
export function removeProviderKey(provider: Provider) {
  update((s) => {
    const keys = { ...s.keys };
    if (ENV_KEYS[provider]) keys[provider] = ENV_KEYS[provider];
    else delete keys[provider];
    return { ...s, keys };
  });
}

function configFor(s: AppSettings, provider: Provider): LlmConfig | null {
  const apiKey = cleanKey(s.keys[provider] ?? "");
  if (!apiKey) return null;
  return { provider, apiKey, model: s.models[provider]?.trim() || PROVIDERS[provider].defaultModel };
}

/** Every provider that has a key, the selected one first. */
export function getConfigChain(s: AppSettings = snapshot()): LlmConfig[] {
  const order = [s.provider, ...PROVIDER_IDS.filter((p) => p !== s.provider)];
  return order.map((p) => configFor(s, p)).filter((c): c is LlmConfig => c !== null);
}

/** Enough to know "can I chat?": the selected provider if it has a key, otherwise any provider that does. */
function getActiveConfig(s: AppSettings = snapshot()): LlmConfig | null {
  return getConfigChain(s)[0] ?? null;
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
  const hydrated = useHydrated();
  const config = useMemo(() => getActiveConfig(settings), [settings]);
  return { settings, hydrated, config };
}
