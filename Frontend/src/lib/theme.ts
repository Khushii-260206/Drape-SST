"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as KEY } from "./theme-script";

/*
 * Light / dark / follow-the-system. The choice lives in localStorage; an inline script in layout.tsx
 * (theme-script.ts) applies it before first paint, and applyTheme keeps <html data-theme> in step afterwards.
 */

export type ThemeMode = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "system" || v === "dark" ? v : "light";
  } catch {
    return "light";
  }
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode = readMode()) {
  document.documentElement.dataset.theme = resolve(mode);
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  applyTheme(mode);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  // When following the system, re-apply as the OS flips between light and dark.
  const onSystem = () => {
    if (readMode() === "system") applyTheme("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      applyTheme();
      listener();
    }
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, readMode, () => "light");
}
