import { colorHex, colorLabel } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const MULTICOLOR_BG =
  "conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)";

export function colorBackground(id: string): string {
  return id === "multicolor" ? MULTICOLOR_BG : colorHex(id);
}

/** Small colour dots for a piece's colours (the main colour first). */
export function ColorDots({ colors, className }: { colors: string[]; className?: string }) {
  if (colors.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {colors.map((c) => (
        <span
          key={c}
          title={colorLabel(c)}
          className="size-4 rounded-full ring-1 ring-black/20 dark:ring-white/40"
          style={{ background: colorBackground(c) }}
        />
      ))}
    </span>
  );
}
