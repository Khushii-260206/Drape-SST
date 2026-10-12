"use client";

import { Check, CircleAlert, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { COLORS } from "@/lib/catalog";
import { MAX_NAME_LENGTH, cleanName, saveIdentity, useIdentity, validateName } from "@/lib/identity";
import { generatePersona } from "@/lib/persona";
import {
  BUDGETS,
  BUILDS,
  FITS,
  GENDERS,
  SHOULDERS,
  SKIN_TONES,
  UNDERTONES,
  VIBES,
  cmToFeetInches,
  completeness,
  kgToPounds,
} from "@/lib/profile";
import { getConfigChain } from "@/lib/settings";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "../Avatar";
import { useProfile } from "../ProfileProvider";
import { useToast } from "../Toaster";
import { useWardrobe } from "../WardrobeProvider";
import { AvatarPicker } from "../Welcome";
import { colorBackground } from "../wardrobe/ColorDots";

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-2.5 text-base shadow-soft transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm";

/** Adds or removes one item, keeping at most six. */
const toggled = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : list.length < 6 ? [...list, id] : list;

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] bg-surface p-5 shadow-soft ring-1 ring-gray-200/70 sm:p-6">
      <h2 className="font-serif text-2xl text-gray-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

/** The name chosen on this device. Edits are saved as you type, but never to an empty name. */
function NameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  function change(value: string) {
    setDraft(value);
    const problem = validateName(value);
    setError(problem);
    if (problem) return;
    try {
      saveIdentity({ name: value });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your name.");
    }
  }

  return (
    <>
      <input
        id="p-name"
        value={draft}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          if (validateName(draft)) {
            setDraft(name);
            setError(null);
          } else setDraft(cleanName(draft));
        }}
        maxLength={MAX_NAME_LENGTH}
        placeholder="Your name"
        autoComplete="given-name"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "p-name-error" : undefined}
        className={inputClass}
      />
      {error && (
        <p id="p-name-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-red-700">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </>
  );
}

function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** A number box that lets you type freely and only commits values that make sense. */
function NumberField({
  id,
  value,
  min,
  max,
  placeholder,
  step = 1,
  onCommit,
}: {
  id: string;
  value: number | null;
  min: number;
  max: number;
  placeholder?: string;
  step?: number;
  onCommit: (v: number | null) => void;
}) {
  // While you're typing, the box shows exactly what you typed (even a half-finished "1" for 175);
  // otherwise it shows the saved value, so it also follows the profile finishing loading.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === null ? "" : String(value));

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value === "") return onCommit(null);
        const n = Number(e.target.value);
        if (Number.isFinite(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      className={inputClass}
    />
  );
}

function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string; hint?: string }[];
  value: T | "";
  onChange: (v: T | "") => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.hint}
            // Tapping the chosen one again clears it, so nothing is forced.
            onClick={() => onChange(active ? "" : o.id)}
            className={cn(
              "rounded-full px-3.5 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
              active ? "bg-brand-600 text-white shadow-soft" : "bg-surface text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ColorPick({ value, onToggle, label }: { value: string[]; onToggle: (id: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2 p-1">
      {COLORS.filter((c) => c.id !== "multicolor").map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            aria-label={c.label}
            title={c.label}
            onClick={() => onToggle(c.id)}
            className={cn(
              "relative size-8 rounded-full ring-offset-2 transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
              on ? "scale-105 ring-2 ring-brand-600" : "ring-1 ring-black/10 hover:scale-105 dark:ring-white/30"
            )}
            style={{ background: colorBackground(c.id) }}
          >
            {on && <Check className="absolute inset-0 m-auto size-4 text-white mix-blend-difference" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

export default function ProfileView() {
  const { profile, ready, save, update } = useProfile();
  const { items } = useWardrobe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [moreBody, setMoreBody] = useState(false);

  const pct = completeness(profile);
  const identity = useIdentity();

  async function makePersona() {
    setBusy(true);
    try {
      const persona = await generatePersona(profile, items, getConfigChain());
      update({ persona, personaAt: Date.now() });
      toast("Your style persona is ready");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't write your persona.", "error");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Profile>(key: K) => (v: Profile[K]) => update({ [key]: v } as Partial<Profile>);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="hero-surface flex flex-wrap items-center gap-4 rounded-[28px] px-5 py-5 sm:px-7 sm:py-6">
        <Avatar name={profile.name} photo={identity?.photo ?? null} className="size-16 text-3xl shadow-soft" />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-4xl tracking-tight text-gray-900 sm:text-5xl">{profile.name ? `Hi, ${profile.name}` : "You"}</h1>
          <p className="mt-1 text-sm text-gray-600">The more your stylist knows about you, the better every outfit fits.</p>
        </div>
        <div className="w-full sm:w-56" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Profile {pct}% complete</span>
            <span className={cn(save === "error" && "text-red-600")}>
              {save === "saving" ? "Saving…" : save === "saved" ? "Saved ✓" : save === "error" ? "Couldn't save — retrying when you edit" : ""}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-blush-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <div className={cn("mt-6 grid items-start gap-5 lg:grid-cols-2", !ready && "pointer-events-none opacity-60")}>
        <div className="space-y-5">
          <Card title="The basics">
            <Field label="What should I call you?" htmlFor="p-name">
              <NameField name={profile.name} />
            </Field>
            <Field label="Profile photo" hint="Kept on this device only, separate from your clothing photos.">
              <AvatarPicker
                name={profile.name}
                photo={identity?.photo ?? null}
                onChange={(photo) => {
                  try {
                    saveIdentity({ name: profile.name, photo });
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Couldn't save the photo.", "error");
                  }
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Age" htmlFor="p-age">
                <NumberField id="p-age" value={profile.age} min={10} max={110} placeholder="e.g. 24" onCommit={set("age")} />
              </Field>
              <Field label="Shoe size" htmlFor="p-shoe">
                <input id="p-shoe" value={profile.shoeSize} onChange={(e) => update({ shoeSize: e.target.value })} maxLength={12} placeholder="e.g. UK 9" className={inputClass} />
              </Field>
            </div>
            <Field label="I dress as" hint="So the stylist suggests cuts and pieces that fit how you like to dress.">
              <Chips label="Gender" options={GENDERS} value={profile.gender} onChange={set("gender")} />
            </Field>
          </Card>

          <Card title="Your body" description="Used to pick fits, lengths and proportions that flatter you. Never judged — just measured.">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Height (cm)" htmlFor="p-height" hint={profile.heightCm ? `≈ ${cmToFeetInches(profile.heightCm)}` : undefined}>
                <NumberField id="p-height" value={profile.heightCm} min={100} max={230} placeholder="e.g. 175" onCommit={set("heightCm")} />
              </Field>
              <Field label="Weight (kg)" htmlFor="p-weight" hint={profile.weightKg ? `≈ ${kgToPounds(profile.weightKg)} lb` : undefined}>
                <NumberField id="p-weight" value={profile.weightKg} min={25} max={250} step={0.5} placeholder="e.g. 70" onCommit={set("weightKg")} />
              </Field>
            </div>
            <Field label="Build" hint={BUILDS.find((b) => b.id === profile.build)?.hint ?? "Pick the one that feels closest."}>
              <Chips label="Build" options={BUILDS} value={profile.build} onChange={set("build")} />
            </Field>
            <Field label="Shoulders">
              <Chips label="Shoulders" options={SHOULDERS} value={profile.shoulders} onChange={set("shoulders")} />
            </Field>

            <div>
              <button
                type="button"
                onClick={() => setMoreBody((v) => !v)}
                aria-expanded={moreBody}
                className="inline-flex min-h-9 items-center text-sm font-medium text-brand-700 hover:underline"
              >
                {moreBody ? "Hide measurements" : "Add measurements (chest, waist, hips)"}
              </button>
              {moreBody && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <Field label="Chest (cm)" htmlFor="p-chest">
                    <NumberField id="p-chest" value={profile.chestCm} min={50} max={200} onCommit={set("chestCm")} />
                  </Field>
                  <Field label="Waist (cm)" htmlFor="p-waist">
                    <NumberField id="p-waist" value={profile.waistCm} min={40} max={200} onCommit={set("waistCm")} />
                  </Field>
                  <Field label="Hips (cm)" htmlFor="p-hips">
                    <NumberField id="p-hips" value={profile.hipsCm} min={50} max={220} onCommit={set("hipsCm")} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          <Card title="Your colouring" description="Colours near your face matter most — this helps pick the ones that make you glow.">
            <Field label="Skin tone">
              <div role="radiogroup" aria-label="Skin tone" className="flex flex-wrap gap-3">
                {SKIN_TONES.map((t) => {
                  const active = profile.skinTone === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={t.label}
                      onClick={() => set("skinTone")(active ? "" : t.id)}
                      className="group flex flex-col items-center gap-1.5 focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          "size-10 rounded-full ring-offset-2 transition group-focus-visible:ring-2 group-focus-visible:ring-brand-400",
                          active ? "scale-105 ring-2 ring-brand-600" : "ring-1 ring-black/10 group-hover:scale-105 dark:ring-white/30"
                        )}
                        style={{ background: t.hex }}
                      />
                      <span className={cn("text-xs", active ? "font-semibold text-gray-900" : "text-gray-500")}>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Undertone" hint={UNDERTONES.find((u) => u.id === profile.undertone)?.hint ?? "Not sure? Skip it."}>
              <Chips label="Undertone" options={UNDERTONES} value={profile.undertone} onChange={set("undertone")} />
            </Field>
            <Field label="Hair" htmlFor="p-hair">
              <input id="p-hair" value={profile.hair} onChange={(e) => update({ hair: e.target.value })} maxLength={40} placeholder="e.g. black, short" className={inputClass} />
            </Field>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Your taste">
            <Field label="How do you like clothes to fit?">
              <Chips label="Fit" options={FITS} value={profile.fit} onChange={set("fit")} />
            </Field>
            <Field label="Style words (pick up to 6)">
              <div role="group" aria-label="Style words" className="flex flex-wrap gap-2">
                {VIBES.map((v) => {
                  const on = profile.vibes.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => update((p) => ({ vibes: toggled(p.vibes, v) }))}
                      className={cn(
                        "rounded-full px-3.5 py-2 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                        on ? "bg-blush-500 text-white shadow-soft" : "bg-surface text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300"
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Colours you love">
              <ColorPick label="Favourite colours" value={profile.favoriteColors} onToggle={(id) => update((p) => ({ favoriteColors: toggled(p.favoriteColors, id) }))} />
            </Field>
            <Field label="Colours you avoid">
              <ColorPick label="Colours to avoid" value={profile.avoidColors} onToggle={(id) => update((p) => ({ avoidColors: toggled(p.avoidColors, id) }))} />
            </Field>
            <Field label="Budget when shopping">
              <Chips label="Budget" options={BUDGETS} value={profile.budget} onChange={set("budget")} />
            </Field>
          </Card>

          <Card title="Your life" description="Where you spend your days shapes what you actually need to wear.">
            <Field label="What does a typical week look like?" htmlFor="p-life">
              <input id="p-life" value={profile.lifestyle} onChange={(e) => update({ lifestyle: e.target.value })} maxLength={160} placeholder="e.g. college by day, gym after, weekend outings" className={inputClass} />
            </Field>
            <Field label="Anything else the stylist should know?" htmlFor="p-notes">
              <textarea
                id="p-notes"
                value={profile.notes}
                onChange={(e) => update({ notes: e.target.value })}
                maxLength={400}
                rows={3}
                placeholder="e.g. I hate tight collars, I run warm, I'm always on a bike…"
                className={cn(inputClass, "resize-none")}
              />
            </Field>
          </Card>

          <Card title="Your style persona" description="A short portrait of you as a dresser. The stylist reads it before every answer.">
            <textarea
              value={profile.persona}
              onChange={(e) => update({ persona: e.target.value })}
              maxLength={900}
              rows={5}
              aria-label="Style persona"
              placeholder="Press “Write my persona” and Drape will draft one from your profile and wardrobe — then edit it however you like."
              className={cn(inputClass, "resize-none leading-relaxed")}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={makePersona}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {busy ? "Writing…" : profile.persona ? "Rewrite my persona" : "Write my persona"}
              </button>
              <span className="text-xs text-gray-500">Uses your AI provider; your clothes&apos; text details are sent, never photos.</span>
            </div>
          </Card>

          <div className="flex items-start gap-2.5 rounded-2xl bg-brand-50 px-4 py-3.5 text-sm text-brand-800">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong className="font-semibold">Your details stay yours.</strong> They&apos;re saved in your own Supabase project and sent as
              plain text to the AI provider with each chat so it can style you — never your photos. Leave anything blank and it&apos;s simply not
              used.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
