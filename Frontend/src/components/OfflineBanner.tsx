"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** A slim notice when the connection drops, so a failed save or a silent chat isn't a mystery. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-ink px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-center text-xs font-medium text-paper"
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      You&apos;re offline — changes and the stylist need a connection.
    </div>
  );
}
