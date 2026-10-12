import { cn } from "@/lib/utils";

/** The person's photo, or their first initial on a blush-to-lavender tile when there isn't one. */
export function Avatar({ name, photo, className }: { name: string; photo: string | null; className?: string }) {
  const initial = (name.trim()[0] ?? "").toUpperCase();
  return (
    <span
      className={cn(
        "hero-surface inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full font-serif text-lg text-gray-900",
        className
      )}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initial || "·"}</span>
      )}
    </span>
  );
}
