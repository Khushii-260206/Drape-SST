"use client";

import { useSyncExternalStore } from "react";
import type { LlmErrorKind } from "./llm";
import type { Provider } from "./types";

/*
 * What this browser has actually learned about each AI provider this session. A saved (or built-in) key says nothing
 * about whether the provider accepts it, so status only ever comes from a real reply: the user's explicit "Check
 * connection", or an AI action they started (a chat message, Fill in with AI). Nothing here probes providers on its own.
 *
 * Held in memory only: a reload starts again from "not tested", so a stale "connected" can't outlive the facts. Each entry
 * remembers a fingerprint of the key it was learned for, so pasting or removing a key discards it. The key itself is never stored here.
 */

export type ProviderHealth = "ok" | "rate" | "model" | "auth" | "network" | "failed";
export type ProviderStatus = { health: ProviderHealth; message: string; at: number; fp: string };

/** Short, non-reversible tag for "this exact key", used only to notice that the key changed. */
export function keyFingerprint(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return `${key.length}:${(h >>> 0).toString(36)}`;
}

let statuses: Partial<Record<Provider, ProviderStatus>> = {};
const listeners = new Set<() => void>();

function healthFor(kind: LlmErrorKind | undefined): ProviderHealth {
  switch (kind) {
    case "rate":
    case "model":
    case "auth":
    case "network":
      return kind;
    default:
      return "failed";
  }
}

/** Records a real outcome for a provider. `kind` is undefined for success. Aborted requests say nothing and are ignored. */
export function recordOutcome(provider: Provider, apiKey: string, outcome: { ok: true } | { ok: false; kind?: LlmErrorKind; message: string }) {
  if (!outcome.ok && outcome.kind === "aborted") return;
  statuses = {
    ...statuses,
    [provider]: {
      health: outcome.ok ? "ok" : healthFor(outcome.kind),
      message: outcome.ok ? "Connection successful" : outcome.message,
      at: Date.now(),
      fp: keyFingerprint(apiKey),
    },
  };
  listeners.forEach((l) => l());
}

/** The status for this provider, but only if it was learned for the key that is saved now. */
export function statusFor(all: Partial<Record<Provider, ProviderStatus>>, provider: Provider, apiKey: string | undefined): ProviderStatus | null {
  const s = all[provider];
  return s && apiKey && s.fp === keyFingerprint(apiKey) ? s : null;
}

export function getAiStatuses() {
  return statuses;
}

export function resetAiStatus() {
  statuses = {};
  listeners.forEach((l) => l());
}

export function useAiStatuses() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => statuses,
    () => ({})
  );
}

/** One short label for a provider card. Never says "connected" unless a request succeeded. */
export function healthLabel(hasKey: boolean, builtIn: boolean, status: ProviderStatus | null): { text: string; tone: "good" | "warn" | "bad" | "idle" } {
  if (!hasKey) return { text: "No key", tone: "idle" };
  if (!status) return { text: builtIn ? "Built-in key — not tested" : "Key saved — not tested", tone: "idle" };
  switch (status.health) {
    case "ok":
      return { text: "Connection successful", tone: "good" };
    case "rate":
      return { text: "Rate limited", tone: "warn" };
    case "model":
      return { text: "Key works — model unavailable", tone: "warn" };
    case "auth":
      return { text: "Key rejected", tone: "bad" };
    default:
      return { text: "Connection failed", tone: "bad" };
  }
}
