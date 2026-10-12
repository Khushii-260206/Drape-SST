import { useSyncExternalStore } from "react";
import { forgetAccountState, forgetPreviousAccount } from "./forget";

/*
 * The decisions behind <AuthGate>, kept free of React so they can be tested directly.
 *
 * Cleanup is a side effect, so it runs in an effect, not during render. The gap before that effect runs is closed by
 * state: children render only once the effect has recorded that THIS account period (epoch + user id) was settled.
 * Until then the gate shows the loading screen, so a previous account's cache can't be read by the next one's screens.
 */

/** Identifies one signed-in period of one account; null when nobody is signed in. */
export const accountToken = (epoch: number, userId: string | undefined): string | null => (userId ? `${epoch}:${userId}` : null);

/** The pages the app has (one folder each under src/app, plus the home page). Anything else is a 404. */
export const KNOWN_ROUTES = ["/", "/wardrobe", "/outfits", "/profile", "/settings"];

/** True for a real page, with or without a trailing slash (the static export serves /wardrobe/). */
export const isKnownRoute = (pathname: string): boolean => KNOWN_ROUTES.includes(pathname.replace(/\/+$/, "") || "/");

export type GateView = "loading" | "unconfigured" | "signin" | "reset" | "app";

export function gateView(input: {
  session: { user: { id: string } } | null | undefined;
  configured: boolean;
  token: string | null;
  settled: string | null;
  /** "ready" while the user arrived from a password-reset link and still has to choose a new password. */
  recovery?: "idle" | "ready" | "invalid";
}): GateView {
  const { session, configured, token, settled, recovery } = input;
  if (session === undefined) return "loading";
  if (!configured) return "unconfigured";
  if (session === null) return "signin";
  if (recovery === "ready") return "reset"; // the link's temporary session must never open the app until a password is set
  return token !== null && token === settled ? "app" : "loading";
}

/**
 * The effect body: drop what the previous account (or the ended session) left in this browser. Idempotent, so React
 * Strict Mode's second run, or a repeat for the same account, changes nothing more.
 */
export function settleAccount(userId: string | undefined): void {
  if (userId) forgetPreviousAccount(userId);
  else forgetAccountState();
}

// Which account period has been settled. A tiny external store rather than component state, so the effect can publish it
// without calling setState inside an effect, and so Strict Mode's remount sees the same answer.
let settledToken: string | null = null;
const settledListeners = new Set<() => void>();

export function markSettled(token: string | null): void {
  if (settledToken === token) return;
  settledToken = token;
  settledListeners.forEach((l) => l());
}

export function useSettledToken(): string | null {
  return useSyncExternalStore(
    (l) => {
      settledListeners.add(l);
      return () => void settledListeners.delete(l);
    },
    () => settledToken,
    () => null
  );
}
