"use client";

import { useSyncExternalStore } from "react";

/*
 * What to call the person using Drape on this device. The account is the Supabase sign-in (auth.ts); the display
 * name and profile photo chosen after the first sign-in are kept in this browser only (localStorage) and are never
 * written to the database. Clearing site data, signing out, or signing in as a different account brings the welcome screen back.
 */

const KEY = "drape:identity";
export const MAX_NAME_LENGTH = 40;

export type Identity = { name: string; photo: string | null; createdAt: number };

const listeners = new Set<() => void>();

/** Whitespace collapsed, trimmed and capped. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** Returns a message to show the user, or null when the name is fine. */
export function validateName(raw: string): string | null {
  return cleanName(raw) ? null : "Please enter a name.";
}

function parse(raw: string | null): Identity | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Identity>;
    const name = typeof v.name === "string" ? cleanName(v.name) : "";
    if (!name) return null;
    const photo = typeof v.photo === "string" && v.photo.startsWith("data:image/") ? v.photo : null;
    return { name, photo, createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.now() };
  } catch {
    return null;
  }
}

// useSyncExternalStore needs the same object back until the stored text changes.
let lastRaw: string | null | undefined;
let lastValue: Identity | null = null;

function snapshot(): Identity | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // storage blocked: behaves as if nobody has set up yet
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = parse(raw);
  }
  return lastValue;
}

function emit() {
  listeners.forEach((l) => l());
}

/** Saves the identity. Throws a readable error if the browser refuses to store it. */
export function saveIdentity(next: { name: string; photo?: string | null }): Identity {
  const name = cleanName(next.name);
  if (!name) throw new Error("Please enter a name.");
  const current = snapshot();
  const identity: Identity = {
    name,
    photo: next.photo === undefined ? (current?.photo ?? null) : next.photo,
    createdAt: current?.createdAt ?? Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    throw new Error("Your browser wouldn't let Drape save your name on this device. Check that site data isn't blocked.");
  }
  emit();
  return identity;
}

export function clearIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored, nothing to clear
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** `undefined` while the page is still starting up in the browser, `null` when nobody has set up yet. */
export function useIdentity(): Identity | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
