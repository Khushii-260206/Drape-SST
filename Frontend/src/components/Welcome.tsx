"use client";

import { ArrowRight, Camera, CircleAlert, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { PHOTO_ACCEPT, makeAvatar } from "@/lib/image";
import { MAX_NAME_LENGTH, saveIdentity, validateName } from "@/lib/identity";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";

/** Photo picker used by the welcome screen and the You page. Reports a ready-to-store data URL. */
export function AvatarPicker({
  name,
  photo,
  onChange,
  disabled,
}: {
  name: string;
  photo: string | null;
  onChange: (photo: string | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await makeAvatar(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={name} photo={photo} className="size-20 text-4xl shadow-soft" />
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor={inputId}
            className="btn-secondary inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-400"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
            {photo ? "Change photo" : "Add a photo"}
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={PHOTO_ACCEPT}
              className="sr-only"
              disabled={busy || disabled}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          {photo && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={busy || disabled}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
            >
              <Trash2 className="size-4" aria-hidden /> Remove
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/** First-run screen: choose a name (and optionally a photo) before anything else is shown. */
export function Welcome() {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateName(name);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      saveIdentity({ name, photo });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your name.");
      setSaving(false);
    }
  }

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="hero-surface w-full max-w-lg rounded-[32px] px-6 py-9 sm:px-10 sm:py-11">
        <Logo />
        <p className="mt-8 text-xs font-semibold tracking-[0.18em] text-blush-700 uppercase">Your personal stylist</p>
        <h1 className="mt-2 font-serif text-5xl leading-[1.05] tracking-tight text-gray-900 sm:text-6xl">
          Welcome to <em className="text-blush-600">Drape</em>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-700">
          Photograph your clothes once and get outfits for any occasion. One last thing: tell us what to call you.
        </p>

        <form onSubmit={submit} noValidate className="mt-7 space-y-6">
          <div>
            <label htmlFor="welcome-name" className="mb-1.5 block text-sm font-medium text-gray-800">
              What should we call you?
            </label>
            <input
              id="welcome-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              maxLength={MAX_NAME_LENGTH}
              placeholder="Your name"
              autoComplete="given-name"
              autoFocus
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "welcome-name-error" : undefined}
              className="w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-3 text-base shadow-sm transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none aria-[invalid=true]:border-red-300"
            />
            {error && (
              <p id="welcome-name-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
                <CircleAlert className="size-4 shrink-0" aria-hidden /> {error}
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-800">
              Profile photo <span className="font-normal text-gray-600">(optional)</span>
            </p>
            <AvatarPicker name={name} photo={photo} onChange={setPhoto} disabled={saving} />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-3.5 text-[15px] font-semibold text-white shadow-lift transition hover:bg-brand-500 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Get started <ArrowRight className="size-4" aria-hidden />
          </button>
        </form>

        <div className="mt-6 flex items-start gap-2.5 rounded-2xl bg-sage-100 px-4 py-3.5 text-sm text-sage-700">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">You&apos;re signed in.</strong> Your name and photo stay in this browser only. Your
            wardrobe, chats and clothing photos are saved to your account, and only you can open them.
          </p>
        </div>
      </div>
    </main>
  );
}
