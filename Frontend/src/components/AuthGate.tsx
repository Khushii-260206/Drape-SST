"use client";

import { ArrowRight, CircleAlert, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import NotFound from "@/app/not-found";
import {
  MIN_PASSWORD_LENGTH, authConfigured, cancelRecovery, completePasswordReset, consumeDeletedNotice, dismissRecovery, requestPasswordReset, signIn, signUp,
  useAccountEpoch, useRecovery, useSession,
} from "@/lib/auth";
import { accountToken, gateView, isKnownRoute, markSettled, settleAccount, useSettledToken } from "@/lib/gate";
import { Logo } from "./Logo";

const FIELD =
  "w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-3 text-base shadow-sm transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none";
const SUBMIT =
  "inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition hover:bg-brand-500 active:scale-[0.99] disabled:opacity-60";

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[70] rounded-full bg-ink px-4 py-2 text-sm text-paper focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  );
}

function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <SkipLink />
      <div className="hero-surface w-full max-w-lg rounded-[32px] px-6 py-9 sm:px-10 sm:py-11">
        <Logo />
        <h1 className="mt-8 font-serif text-5xl leading-[1.05] tracking-tight text-gray-900 sm:text-6xl">{title}</h1>
        {children}
      </div>
    </main>
  );
}

function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {children}
    </p>
  );
}

/** Reached from the e-mailed reset link: the link's temporary session lets the user choose a new password. */
function ResetPasswordScreen() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await completePasswordReset(password, again); // on success the gate moves on to the app, signed in
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<>Choose a new <em className="text-blush-600">password</em></>}>
      <p className="mt-3 text-[15px] leading-relaxed text-gray-700">You will be signed in as soon as it is saved.</p>
      <form onSubmit={submit} noValidate className="mt-7 space-y-5">
        <div>
          <label htmlFor="reset-password" className="mb-1.5 block text-sm font-medium text-gray-800">New password</label>
          <input id="reset-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} aria-describedby={error ? "reset-error" : undefined} className={FIELD} />
        </div>
        <div>
          <label htmlFor="reset-confirm" className="mb-1.5 block text-sm font-medium text-gray-800">Confirm new password</label>
          <input id="reset-confirm" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password"
            placeholder="Type it again" aria-describedby={error ? "reset-error" : undefined} className={FIELD} />
        </div>
        {error && <ErrorLine id="reset-error">{error}</ErrorLine>}
        <button type="submit" disabled={busy} className={SUBMIT}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Save password <ArrowRight className="size-4" aria-hidden />
        </button>
        <p className="text-center text-sm text-gray-600">
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => void cancelRecovery()}>Cancel</button>
        </p>
      </form>
    </Card>
  );
}

function SignInScreen({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(notice ? "forgot" : "signin");
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleted] = useState(consumeDeletedNotice); // read once: shown after an account was deleted
  const signingUp = mode === "signup";
  const forgot = mode === "forgot";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (forgot) {
        await requestPasswordReset(email);
        setSent(true);
      } else if (signingUp) {
        const { confirmEmail } = await signUp(email, password);
        if (confirmEmail) setConfirm(true);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = FIELD;

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <SkipLink />
      <div className="hero-surface w-full max-w-lg rounded-[32px] px-6 py-9 sm:px-10 sm:py-11">
        <Logo />
        <h1 className="mt-8 font-serif text-5xl leading-[1.05] tracking-tight text-gray-900 sm:text-6xl">
          {forgot ? "Reset your " : signingUp ? "Create your " : "Welcome back to "}
          {forgot ? <em className="text-blush-600">password</em> : <em className="text-blush-600">Drape</em>}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-700">
          {forgot ? "Enter your email and we will send you a link to choose a new password." : "Your wardrobe, photos and chats are private to your account."}
        </p>
        {deleted && (
          <div role="status" className="mt-5 flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
            <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>Your account and everything in it were deleted. You can create a new one any time.</p>
          </div>
        )}
        {notice && !sent && (
          <div role="alert" className="mt-5">
            <ErrorLine id="auth-notice">{notice}</ErrorLine>
          </div>
        )}

        {forgot && sent ? (
          <div role="status" className="mt-7 flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
            <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              If there is an account for <strong className="font-semibold">{email.trim()}</strong>, a reset link is on its way. It can take a
              minute; check spam too. Then{" "}
              <button type="button" className="font-semibold underline" onClick={() => { setSent(false); setMode("signin"); setPassword(""); dismissRecovery(); }}>
                sign in
              </button>
              .
            </p>
          </div>
        ) : confirm ? (
          <div role="status" className="mt-7 flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
            <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              We sent a confirmation link to <strong className="font-semibold">{email.trim()}</strong>. Open it, then{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  setConfirm(false);
                  setMode("signin");
                  setPassword("");
                }}
              >
                sign in
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-7 space-y-5">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-gray-800">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                className={field}
              />
            </div>
            {!forgot && (
            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-sm font-medium text-gray-800">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signingUp ? "new-password" : "current-password"}
                placeholder={signingUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Your password"}
                aria-describedby={error ? "auth-error" : undefined}
                className={field}
              />
              {!signingUp && (
                <button type="button" className="mt-2 text-sm font-semibold text-brand-700 underline" onClick={() => { setMode("forgot"); setError(null); }}>
                  Forgot password?
                </button>
              )}
            </div>
            )}
            {error && (
              <p id="auth-error" role="alert" className="flex items-start gap-1.5 text-sm text-red-700">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition hover:bg-brand-500 active:scale-[0.99] disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {forgot ? "Send reset link" : signingUp ? "Create account" : "Sign in"} <ArrowRight className="size-4" aria-hidden />
            </button>
            <p className="text-center text-sm text-gray-600">
              {forgot ? "Remembered it?" : signingUp ? "Already have an account?" : "New to Drape?"}{" "}
              <button
                type="button"
                className="font-semibold text-brand-700 underline"
                onClick={() => {
                  setMode(signingUp || forgot ? "signin" : "signup");
                  setError(null);
                  dismissRecovery();
                }}
              >
                {signingUp || forgot ? "Sign in" : "Create an account"}
              </button>
            </p>
          </form>
        )}

        <div className="mt-6 flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Only you can open your pieces, photos and chats. Your AI key (added under Settings) stays in this browser.
          </p>
        </div>
      </div>
    </main>
  );
}

/** Nothing else renders, and nothing is requested from the database, until someone is signed in. */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const epoch = useAccountEpoch();
  const userId = session?.user.id;
  const token = accountToken(epoch, userId);
  const configured = authConfigured();
  const recovery = useRecovery();
  const pathname = usePathname() ?? "/";

  // Which account period the browser's leftovers have been dealt with for. Children wait for it to match the current one.
  const settled = useSettledToken();
  const ended = session === null;
  useEffect(() => {
    if (userId && recovery.kind === "invalid") dismissRecovery(); // a stale "bad link" notice must not greet the next sign-out
  }, [userId, recovery.kind]);
  useEffect(() => {
    if (session === undefined) return; // still reading the stored session
    settleAccount(userId); // a new account clears the old one's cache; no account (signed out / refresh failed) clears all
    markSettled(token);
    // `session` is represented by `userId` and `ended`; token refreshes of the same account must not rerun this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ended, userId]);

  switch (gateView({ session, configured, token, settled, recovery: recovery.kind })) {
    case "loading":
      return (
        <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading Drape">
          <Logo className="animate-pulse motion-reduce:animate-none" />
        </div>
      );
    case "unconfigured":
      return (
        <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10">
          <p role="alert" className="max-w-md text-center text-sm text-red-700">
            <CircleAlert className="mr-1 inline size-4 align-text-bottom" aria-hidden />
            This copy of Drape was built without a Supabase project, so nobody can sign in. Set NEXT_PUBLIC_SUPABASE_URL and
            NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example) and rebuild.
          </p>
        </main>
      );
    case "signin":
      // An address that isn't a page says so even to someone who is signed out (the 404 page holds no data).
      if (!isKnownRoute(pathname)) return <main id="main" className="flex min-h-dvh flex-col"><NotFound /></main>;
      return <SignInScreen notice={recovery.kind === "invalid" ? recovery.message : undefined} />;
    case "reset":
      return <ResetPasswordScreen />;
    case "app":
      // A new key remounts every provider, so one account's data can never linger in state for the next.
      return <div key={token} className="contents">{children}</div>;
  }
}
