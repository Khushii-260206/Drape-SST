"use client";

import { Layers, MessageCircle, Settings2, Shirt, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { OfflineBanner } from "./OfflineBanner";
import { Welcome } from "./Welcome";

const TABS = [
  { href: "/", label: "Stylist", icon: MessageCircle },
  { href: "/wardrobe/", label: "Wardrobe", icon: Shirt },
  { href: "/outfits/", label: "Outfits", icon: Layers },
  { href: "/profile/", label: "You", icon: UserRound },
  { href: "/settings/", label: "Settings", icon: Settings2 },
];

function normalize(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** The glass bubble behind the current tab. Tabs are equal width, so it slides with a plain translate. */
function Bubble({ index, inset, className }: { index: number; inset: string; className?: string }) {
  if (index < 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute rounded-full bg-surface/85 shadow-soft ring-1 ring-white/50 transition-transform duration-500 ease-[cubic-bezier(0.34,1.35,0.64,1)] motion-reduce:transition-none dark:ring-white/15",
        className
      )}
      style={{
        top: inset,
        bottom: inset,
        left: inset,
        width: `calc((100% - ${inset} * 2) / ${TABS.length})`,
        transform: `translateX(${index * 100}%)`,
      }}
    />
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = normalize(usePathname() ?? "/");
  const activeIndex = TABS.findIndex((t) => normalize(t.href) === pathname);
  const identity = useIdentity();

  // Still starting up in the browser: show only the logo so nothing flashes before we know who is here.
  if (identity === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Drape">
        <Logo className="animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }
  // First run on this device: choose a name before anything else.
  if (identity === null) return <Welcome />;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-[70] rounded-full bg-ink px-4 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <OfflineBanner />

      <header className="glass-bar sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="Drape — home"
            className="rounded-xl focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            <Logo />
          </Link>

          <nav aria-label="Main" className="glass relative ml-auto hidden w-[22rem] grid-cols-5 rounded-full p-1 sm:grid md:w-[31rem]">
            <Bubble index={activeIndex} inset="0.25rem" />
            {TABS.map(({ href, label, icon: Icon }, i) => {
              const active = i === activeIndex;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  className={cn(
                    "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                    active ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", active && "text-brand-600")} aria-hidden />
                  <span className="hidden md:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
          <Link
            href="/profile/"
            aria-label={`${identity.name} — your profile`}
            title="Your profile"
            className="order-last flex shrink-0 items-center gap-2 rounded-full py-1 pr-1 pl-1 transition hover:bg-surface/70 lg:pr-3"
          >
            <Avatar name={identity.name} photo={identity.photo} />
            <span className="hidden max-w-[8rem] truncate text-sm font-medium text-gray-800 lg:inline" data-testid="nav-name">
              {identity.name}
            </span>
          </Link>
        </div>
      </header>

      <main id="main" className="flex flex-1 flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-0">
        {children}
      </main>

      {/* Phones: a floating glass dock, like the system tab bar. */}
      <nav
        aria-label="Main"
        className="glass fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 rounded-[28px] sm:hidden"
      >
        <div className="relative grid h-16 grid-cols-5 p-1.5">
          <Bubble index={activeIndex} inset="0.375rem" className="rounded-[22px]" />
          {TABS.map(({ href, label, icon: Icon }, i) => {
            const active = i === activeIndex;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-[22px] text-[10px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                  active ? "text-brand-700" : "text-gray-500 active:text-gray-800"
                )}
              >
                <Icon className="size-5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
