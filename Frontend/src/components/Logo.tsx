import { cn } from "@/lib/utils";

/** The Drape mark: a hanger on a blush-to-lavender tile with a rose spark. Same drawing as app/icon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="drape-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6DDE5" />
          <stop offset="1" stopColor="#E8E0F5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#drape-mark)" />
      <path
        d="M13.4 10.2a2.6 2.6 0 1 1 4.1 2.1c-.9.6-1.5 1.15-1.5 2.1v.75M16 15.15 6.9 21.5c-.95.66-.48 2.1.66 2.1h16.88c1.14 0 1.6-1.44.66-2.1Z"
        fill="none"
        stroke="#343238"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.6" cy="8.4" r="1.6" fill="#A04564" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-serif text-[26px] leading-none tracking-tight text-gray-900">Drape</span>
    </span>
  );
}
