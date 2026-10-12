"use client";

import { LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { signOut, useSession } from "@/lib/auth";
import { forgetAccountState } from "@/lib/forget";
import { useIdentity } from "@/lib/identity";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { ReactNode } from "react";
import { ApiKeyForm } from "./ApiKeyForm";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { DataTools } from "./DataTools";
import { ThemePicker } from "./ThemePicker";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-surface p-5 shadow-soft ring-1 ring-gray-200/70 sm:p-6">
      <h2 className="font-serif text-2xl text-gray-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Account() {
  const identity = useIdentity();
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSignOut() {
    setConfirming(false);
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (e) {
      // The session on this browser is already gone by now (see signOut), so the sign-in screen takes over; say what didn't happen.
      setError(e instanceof Error ? e.message : "Couldn't sign out.");
    } finally {
      forgetAccountState(); // whatever happened, this browser must not keep the account's data
      setSigningOut(false);
    }
  }

  return (
    <>
      <p className="text-sm text-gray-600">
        {identity ? <>Signed in as <strong className="font-semibold text-gray-800">{identity.name}</strong>. </> : null}
        {session?.user.email ? <>Your account is <strong className="font-semibold text-gray-800">{session.user.email}</strong>. </> : null}
        Your wardrobe, photos and chats belong to this account only.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={signingOut}
          className="btn-secondary inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 border-t border-red-100 pt-5">
        <h3 className="text-sm font-semibold text-red-700">Danger zone</h3>
        <p className="mt-1 text-sm text-gray-600">
          Permanently delete this account together with every piece, photo, outfit, chat and your profile. This can&apos;t be undone.
        </p>
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-red-700 shadow-sm ring-1 ring-red-300 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:outline-none"
        >
          <Trash2 className="size-4" aria-hidden /> Delete account…
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Sign out?"
        message="You'll need your email and password to get back in. Nothing is deleted. This browser forgets your name, photo, saved city, cached data and photo links (an AI key you pasted stays until you remove it under AI connection)."
        confirmLabel="Sign out"
        danger={false}
        onCancel={() => setConfirming(false)}
        onConfirm={doSignOut}
      />
      <DeleteAccountDialog open={deleting} onClose={() => setDeleting(false)} email={session?.user.email ?? ""} />
    </>
  );
}

export default function SettingsView() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="hero-surface mb-5 rounded-[28px] px-5 py-5 sm:px-7 sm:py-6">
        <h1 className="font-serif text-4xl tracking-tight text-gray-900 sm:text-5xl">Settings</h1>
        <p className="mt-1 text-sm text-gray-600">Connect your AI and look after your data.</p>
      </header>

      {/* One column on phones and tablets; AI on the left and everything else on the right from laptop width. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Section
          title="AI connection"
          description="Powers your stylist chat and photo recognition. Adding your own free key is optional where this copy of Drape already has one."
        >
          <ApiKeyForm />
        </Section>

        <div className="space-y-5">
          <Section title="Appearance" description="Follow your device, or pick a side.">
            <ThemePicker />
          </Section>

          <Section title="Account">
            <Account />
          </Section>

          <Section title="Your data">
            <DataTools />
          </Section>

          <div className="flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong className="font-semibold">Where your data lives.</strong> Photos, details and chats are stored in your own
              Supabase project, tied to your account, and only you can open them. When you chat, your messages and the text details of your pieces, your profile and the weather are sent to the AI provider you chose so it can answer. A photo is sent only when you ask the AI to
              recognise it (Fill in with AI, Detect with AI or Detect colours), and only that one photo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
