"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import { useHydrated } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const OPTIONS: { id: ThemeMode; label: string; icon: LucideIcon }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export function ThemePicker() {
  const mode = useThemeMode();
  const hydrated = useHydrated();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 rounded-2xl bg-gray-100 p-1">
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const active = hydrated && mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setThemeMode(id)}
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
              active ? "bg-surface text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-900"
            )}
          >
            <Icon className={cn("size-4", active && "text-blush-600")} aria-hidden /> {label}
          </button>
        );
      })}
    </div>
  );
}
