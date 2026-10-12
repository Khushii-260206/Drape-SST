"use client";

import { GoTrueClient, type Session } from "@supabase/auth-js";
import { useSyncExternalStore } from "react";
import { SUPABASE_URL } from "./env";

/*
 * Sign-in with Supabase Auth (email + password). The session lives in this browser's localStorage and is refreshed
 * automatically. Every database and storage request carries the signed-in user's access token (see supabase.ts), and
 * the policies in Backend/supabase/schema.secure.sql only let a user touch their own rows and photos.
 */

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const MIN_PASSWORD_LENGTH = 8;

/** False when the site was built without a Supabase URL and key; the sign-in screen then says so instead of failing. */
export const authConfigured = () => Boolean(SUPABASE_URL && ANON_KEY);

let _auth: GoTrueClient | undefined;
let session: Session | null | undefined; // undefined = still reading the stored session
const listeners = new Set<() => void>();

// Counts every change of WHO is signed in (including to and from nobody). Token refreshes keep the same user and don't
// count. The gate keys its "safe to show" state on this, so even a sign-out and sign-in that React batches into one
// render is still seen as a new account period.
let accountEpoch = 0;

function setSession(next: Session | null) {
  if (next?.user.id !== session?.user.id) accountEpoch++;
  session = next;
  listeners.forEach((l) => l());
}

export const currentAccountEpoch = () => accountEpoch;

function auth(): GoTrueClient {
  if (!_auth) {
    if (!SUPABASE_URL || !ANON_KEY) {
      throw new Error("Supabase isn't configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).");
    }
    const client = new GoTrueClient({
      url: `${SUPABASE_URL}/auth/v1`,
      headers: { apikey: ANON_KEY },
      storageKey: "drape:auth",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Looked up at call time so a test can swap fetch out.
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    });
    // Must not call back into the client from here (it would deadlock); it only records the session.
    client.onAuthStateChange((_event, next) => setSession(next));
    _auth = client;
    const hash = typeof location === "undefined" ? "" : location.hash;
    if (hash && parseAuthHash(hash)) history.replaceState(null, "", location.pathname + location.search); // keep tokens out of the address bar
    if (!hash && pendingReset()) recovery = { kind: "ready" };
    void (hash ? handleAuthLink(hash) : Promise.resolve(false))
      .catch(() => setRecovery({ kind: "invalid", message: LINK_INVALID }))
      .then(() => client.getSession())
      .then(({ data }) => {
        if (!data.session && recovery.kind === "ready") setRecovery(IDLE); // the temporary session is gone: nothing to finish
        if (session === undefined) setSession(data.session);
      });
  }
  return _auth;
}

/** The signed-in user's access token, refreshed if it has expired. */
export async function accessToken(): Promise<string | undefined> {
  const { data } = await auth().getSession();
  return data.session?.access_token;
}

/** The signed-in user's id, used as the first folder of every photo path. Throws when nobody is signed in. */
export function requireUserId(): string {
  const id = session?.user.id;
  if (!id) throw new Error("You're signed out. Sign in again to continue.");
  return id;
}

export const hasSession = () => Boolean(session);

const LINK_INVALID = "This reset link has expired or was already used. Request a new one.";

type AuthErrorLike = { message: string; code?: string; status?: number; name?: string; reasons?: string[] };

/**
 * Supabase says WHY a password was refused (`reasons`: "length", "characters", "pwned"), and its policy is set per project, so
 * the wording follows the server instead of always blaming the length.
 */
function weakPasswordMessage(reasons: string[], message: string): string {
  const parts: string[] = [];
  if (reasons.includes("pwned")) parts.push("that password has appeared in a known data breach, so pick one you haven't used elsewhere");
  if (reasons.includes("characters") || /upper|lower|digit|symbol|special|character types/i.test(message)) parts.push("mix upper- and lower-case letters, numbers and symbols");
  if (reasons.includes("length") || parts.length === 0) parts.push(`use at least ${MIN_PASSWORD_LENGTH} characters`);
  const text = parts.join("; ");
  return `That password isn't strong enough: ${text}.`;
}

/** Explains an auth failure. Prefers Supabase's stable `code`/`status`; falls back to the message text. */
export function explain(message: string, err: Partial<AuthErrorLike> = {}): string {
  const m = message.toLowerCase();
  const code = err.code ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/.test(m)) return "That email and password don't match. Check them and try again.";
  if (code === "email_not_confirmed" || /email not confirmed/.test(m)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (code === "user_already_exists" || /already registered|already been registered/.test(m)) return "There's already an account with that email. Sign in instead.";
  if (code === "over_email_send_rate_limit" || /email.*(rate limit|too many)|(rate limit|too many).*email/.test(m)) return "Too many confirmation emails were sent. If one already arrived, open its link and sign in; otherwise wait up to an hour and try again.";
  if (code === "over_request_rate_limit" || err.status === 429 || /rate limit|too many/.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (code === "weak_password" || (/password/.test(m) && /(short|least|weak|characters)/.test(m))) return weakPasswordMessage(err.reasons ?? [], m);
  if (err.name === "AuthRetryableFetchError" || err.status === 0 || /fetch|network/.test(m)) return "Couldn't reach the server. Check your connection and try again.";
  if (code === "same_password" || /different from the old password/.test(m)) return "Choose a password you haven't used before: it must differ from your current one.";
  if (code === "session_not_found" || code === "otp_expired" || /auth session missing|expired|invalid.*(token|link)/.test(m)) return LINK_INVALID;
  if (code === "signup_disabled") return "Sign-ups are turned off for this project.";
  return message;
}

const explainError = (e: AuthErrorLike) => explain(e.message, { ...e, reasons: (e as { reasons?: string[] }).reasons });

// After Supabase refuses to send an e-mail because of its rate limit, don't ask again for a while: every retry only extends
// the wait and can send yet another e-mail. Persisted so a page refresh doesn't clear it.
const SIGNUP_BLOCK = "drape:signup-blocked-until";
const RESET_BLOCK = "drape:reset-blocked-until";
const EMAIL_COOLDOWN_MS = 15 * 60_000;
const RESET_SENT_COOLDOWN_MS = 60_000; // Supabase itself allows one mail per address per minute

function blockedFor(key: string): number {
  try {
    return Math.max(0, Number(localStorage.getItem(key) || 0) - Date.now());
  } catch {
    return 0;
  }
}

function block(key: string, ms: number) {
  try {
    localStorage.setItem(key, String(Date.now() + ms));
  } catch {
    /* storage unavailable: the server limit still applies */
  }
}

const isEmailLimit = (e: AuthErrorLike) => e.code === "over_email_send_rate_limit" || /email.*rate limit/i.test(e.message);
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Where the confirmation e-mail's link should land: this site (including its GitHub Pages sub-path), not just the project's default. */
function siteUrl(): string | undefined {
  return typeof location === "undefined" ? undefined : `${location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
}

function check(email: string, password: string) {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error("Enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
}

export async function signIn(email: string, password: string): Promise<void> {
  check(email, password);
  const { data, error } = await auth().signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(explainError(error));
  setSession(data.session);
}

/** `confirmEmail` is true when the project requires the address to be confirmed before the first sign-in. */
export async function signUp(email: string, password: string): Promise<{ confirmEmail: boolean }> {
  check(email, password);
  const wait = blockedFor(SIGNUP_BLOCK);
  if (wait > 0) {
    throw new Error(`Sign-up is paused to avoid sending more emails. If a confirmation email already arrived, open it and sign in; otherwise try again in ${minutes(wait)} min.`);
  }
  const { data, error } = await auth().signUp({ email: email.trim(), password, options: { emailRedirectTo: siteUrl() } });
  if (error) {
    if (isEmailLimit(error)) block(SIGNUP_BLOCK, EMAIL_COOLDOWN_MS);
    throw new Error(explainError(error));
  }
  // An address that is already registered comes back as a user with no identities (Supabase hides that fact on purpose).
  if (data.user && data.user.identities?.length === 0) throw new Error(explain("already registered"));
  if (data.session) {
    setSession(data.session);
    return { confirmEmail: false };
  }
  return { confirmEmail: true };
}

/*
 * Password reset. The e-mail link comes back to this site with the recovery session in the URL fragment
 * (#access_token=...&refresh_token=...&type=recovery) or, when the link is bad, an error (#error_code=otp_expired ...).
 * `detectSessionInUrl` is off, so handleAuthLink reads it once at start-up and scrubs it from the address bar.
 */
export type Recovery = { kind: "idle" } | { kind: "ready" } | { kind: "invalid"; message: string };
const IDLE: Recovery = { kind: "idle" };
let recovery: Recovery = IDLE;

// A reload mid-reset must not drop the user into the app with the link's temporary session and no new password, so
// "reset pending" survives reloads of this tab (and ends with it).
const PENDING_KEY = "drape:reset-pending";
function pendingReset(next?: boolean): boolean {
  try {
    if (next === true) sessionStorage.setItem(PENDING_KEY, "1");
    else if (next === false) sessionStorage.removeItem(PENDING_KEY);
    return sessionStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

function setRecovery(next: Recovery) {
  recovery = next;
  pendingReset(next.kind === "ready");
  listeners.forEach((l) => l());
}

/** Reads a reset link's fragment. Anything that isn't a recovery link or an auth error returns null and is left alone. */
export function parseAuthHash(hash: string): { kind: "recovery"; access_token: string; refresh_token: string } | { kind: "error"; message: string } | null {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("error") || p.get("error_code")) {
    return { kind: "error", message: explain(p.get("error_description")?.replace(/\+/g, " ") ?? "", { code: p.get("error_code") ?? undefined }) || LINK_INVALID };
  }
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  if (p.get("type") === "recovery" && access_token && refresh_token) return { kind: "recovery", access_token, refresh_token };
  return null;
}

/** Starts a recovery session from the link's fragment, if it is one. Resolves true when the link was handled. */
export async function handleAuthLink(hash: string): Promise<boolean> {
  const link = parseAuthHash(hash);
  if (!link) return false;
  if (link.kind === "error") {
    setRecovery({ kind: "invalid", message: /expired|already used/.test(link.message) || link.message === LINK_INVALID ? LINK_INVALID : link.message });
    return true;
  }
  setRecovery({ kind: "ready" }); // before the session exists, so the gate can never show the app in between
  const { error } = await auth().setSession({ access_token: link.access_token, refresh_token: link.refresh_token });
  if (error) setRecovery({ kind: "invalid", message: LINK_INVALID });
  return true;
}

/** Sends the reset e-mail. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error("Enter a valid email address.");
  const wait = blockedFor(RESET_BLOCK);
  if (wait > 0) throw new Error(`A reset email was requested recently. Check your inbox (and spam), or try again in ${minutes(wait)} min.`);
  const { error } = await auth().resetPasswordForEmail(email.trim(), { redirectTo: siteUrl() });
  if (error) {
    if (isEmailLimit(error)) block(RESET_BLOCK, EMAIL_COOLDOWN_MS);
    throw new Error(explainError(error));
  }
  block(RESET_BLOCK, RESET_SENT_COOLDOWN_MS);
}

/** Sets the new password for the recovery session, then carries on signed in. */
export async function completePasswordReset(password: string, confirm: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password !== confirm) throw new Error("The two passwords don't match.");
  const { error } = await auth().updateUser({ password });
  if (error) {
    if (error.code === "session_not_found" || /session missing/i.test(error.message)) setRecovery({ kind: "invalid", message: LINK_INVALID });
    throw new Error(explainError(error));
  }
  setRecovery(IDLE);
}

/** Leaves the reset screen without choosing a password: the temporary session ends too. */
export async function cancelRecovery(): Promise<void> {
  setRecovery(IDLE);
  await signOut().catch(() => {});
}

/** Acknowledges an invalid-link notice (the sign-in screen has shown it). */
export const dismissRecovery = () => setRecovery(IDLE);

export const currentRecovery = () => recovery;

export function useRecovery(): Recovery {
  return useSyncExternalStore(subscribe, () => recovery, () => IDLE);
}

export type DeleteFailure = "password" | "network" | "not-deployed" | "session" | "partial" | "other";
export class DeleteAccountError extends Error {
  kind: DeleteFailure;
  constructor(message: string, kind: DeleteFailure) {
    super(message);
    this.name = "DeleteAccountError";
    this.kind = kind;
  }
}

/**
 * Permanently deletes the signed-in account. Steps: (1) check the password again, which also gives a fresh token the server
 * insists on; (2) ask the `delete-account` Edge Function (Backend/supabase/functions) to remove photos, rows and the auth user,
 * using a service-role key that only exists on Supabase's side; (3) end this browser's session. The caller then clears this
 * browser's remembered data. Resolves only when the server said the account is gone.
 */
export async function deleteAccount(password: string): Promise<void> {
  const email = session?.user.email;
  if (!session || !email) throw new DeleteAccountError("You're signed out. Sign in again to continue.", "session");
  if (!password) throw new DeleteAccountError("Enter your password to confirm.", "password");

  const { data, error } = await auth().signInWithPassword({ email, password });
  if (error || !data.session) {
    const wrong = error?.code === "invalid_credentials" || /invalid login credentials/i.test(error?.message ?? "");
    throw new DeleteAccountError(wrong ? "That password isn't right." : explainError(error ?? { message: "Couldn't confirm your password." }), wrong ? "password" : "network");
  }
  if (data.session.user.id !== session.user.id) throw new DeleteAccountError("That password belongs to a different account.", "password");

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ confirm: "DELETE" }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new DeleteAccountError("Couldn't reach the server, so I can't tell whether the deletion finished. Check your connection and try again. If the account was already deleted, signing in will no longer work.", "network");
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; stage?: string; reauthenticate?: boolean };
  if (res.status === 404) {
    throw new DeleteAccountError("Account deletion isn't set up on this Supabase project yet (the delete-account function isn't deployed). Your account was not changed.", "not-deployed");
  }
  if (res.status === 401) throw new DeleteAccountError("Your session expired. Sign in again, then try once more.", "session");
  if (body.reauthenticate) throw new DeleteAccountError("For safety, confirm your password again.", "password");
  if (!res.ok || body.ok !== true) {
    const partial = body.stage === "storage" || body.stage === "data" || body.stage === "account";
    throw new DeleteAccountError(
      partial
        ? `${body.error ?? "Part of the deletion failed."} Your account still exists and nothing else was touched: press Delete again to retry.`
        : "Couldn't delete your account. Nothing was changed; try again in a moment.",
      partial ? "partial" : "other"
    );
  }
  // Gone on the server: end the local session (the server may answer 401/404 for a deleted user, which signOut tolerates).
  try {
    sessionStorage.setItem(DELETED_KEY, "1"); // the sign-in screen confirms it, once
  } catch {
    // storage blocked: the screen just won't show the confirmation
  }
  await signOut().catch(() => {});
}

const DELETED_KEY = "drape:account-deleted";
/** True once after an account was deleted in this tab, so the sign-in screen can say so. */
export function consumeDeletedNotice(): boolean {
  try {
    const was = sessionStorage.getItem(DELETED_KEY) === "1";
    sessionStorage.removeItem(DELETED_KEY);
    return was;
  } catch {
    return false;
  }
}

export async function signOut(): Promise<void> {
  const { error } = await auth().signOut({ scope: "local" }); // only this browser; other devices stay signed in
  // The local session is gone even if the server couldn't be told, so signing out never gets stuck.
  if (error && !/fetch|network/i.test(error.message)) throw new Error(explainError(error));
  setSession(null);
}

function subscribe(listener: () => void) {
  if (authConfigured()) auth(); // starts reading the stored session
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes whenever the signed-in account changes; read it in the same render as `useSession`. */
export function useAccountEpoch(): number {
  return useSyncExternalStore(subscribe, () => accountEpoch, () => 0);
}

/** `undefined` while the stored session is being read, `null` when signed out. */
export function useSession(): Session | null | undefined {
  // Without configuration there is nothing to read: report "signed out" so the gate can explain what is missing.
  return useSyncExternalStore(subscribe, () => (authConfigured() ? session : null), () => undefined);
}
