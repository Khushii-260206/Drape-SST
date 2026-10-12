import { colorLabel, isKnownColor } from "./catalog";
import type { Profile } from "./types";

/*
 * The person using the app: body, colouring and taste. Everything is optional; whatever is filled in is
 * turned into a short brief for the stylist so fits, proportions and colours suit them. Pure functions
 * (no React/DOM) so they can be unit-tested in Node.
 */

type Option<T extends string> = { id: T; label: string; hint?: string };

export const GENDERS: Option<Exclude<Profile["gender"], "">>[] = [
  { id: "man", label: "Man" },
  { id: "woman", label: "Woman" },
  { id: "nonbinary", label: "Non-binary" },
];

export const BUILDS: Option<Exclude<Profile["build"], "">>[] = [
  { id: "slim", label: "Slim", hint: "Lean, narrow frame" },
  { id: "athletic", label: "Athletic", hint: "Broad shoulders, narrower waist" },
  { id: "average", label: "Average", hint: "Medium, balanced frame" },
  { id: "broad", label: "Broad", hint: "Wide, sturdy frame" },
  { id: "curvy", label: "Curvy", hint: "Defined waist, fuller hips" },
  { id: "plus", label: "Plus size", hint: "Fuller figure" },
];

export const SHOULDERS: Option<Exclude<Profile["shoulders"], "">>[] = [
  { id: "narrow", label: "Narrow" },
  { id: "average", label: "Average" },
  { id: "broad", label: "Broad" },
];

export const SKIN_TONES: { id: Exclude<Profile["skinTone"], "">; label: string; hex: string }[] = [
  { id: "fair", label: "Fair", hex: "#f7dcc8" },
  { id: "light", label: "Light", hex: "#efc6a4" },
  { id: "medium", label: "Medium", hex: "#dba67d" },
  { id: "olive", label: "Olive", hex: "#c39265" },
  { id: "tan", label: "Tan", hex: "#a9764d" },
  { id: "brown", label: "Brown", hex: "#80522f" },
  { id: "deep", label: "Deep", hex: "#52361f" },
];

export const UNDERTONES: Option<Exclude<Profile["undertone"], "">>[] = [
  { id: "warm", label: "Warm", hint: "Gold looks better than silver; veins look greenish" },
  { id: "cool", label: "Cool", hint: "Silver looks better than gold; veins look bluish" },
  { id: "neutral", label: "Neutral", hint: "Both work; veins look blue-green" },
];

export const FITS: Option<Exclude<Profile["fit"], "">>[] = [
  { id: "slim", label: "Slim" },
  { id: "regular", label: "Regular" },
  { id: "relaxed", label: "Relaxed" },
  { id: "oversized", label: "Oversized" },
];

export const BUDGETS: Option<Exclude<Profile["budget"], "">>[] = [
  { id: "budget", label: "Budget-friendly" },
  { id: "mid", label: "Mid-range" },
  { id: "premium", label: "Premium" },
];

export const VIBES = [
  "Minimal",
  "Streetwear",
  "Smart casual",
  "Classic",
  "Sporty",
  "Traditional / ethnic",
  "Edgy",
  "Preppy",
  "Vintage",
  "Techwear",
  "Bohemian",
  "Old money",
];

export const EMPTY_PROFILE: Profile = {
  name: "",
  age: null,
  gender: "",
  heightCm: null,
  weightKg: null,
  build: "",
  shoulders: "",
  chestCm: null,
  waistCm: null,
  hipsCm: null,
  shoeSize: "",
  skinTone: "",
  undertone: "",
  hair: "",
  fit: "",
  vibes: [],
  favoriteColors: [],
  avoidColors: [],
  budget: "",
  lifestyle: "",
  notes: "",
  persona: "",
  personaAt: null,
};

const oneOf = <T extends string>(v: unknown, options: readonly { id: T }[]): T | "" =>
  typeof v === "string" && options.some((o) => o.id === v) ? (v as T) : "";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
};

const colors = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((c): c is string => typeof c === "string" && isKnownColor(c)))).slice(0, 6) : [];

/** Anything read from the database (or typed in) becomes a well-formed profile; unknown values are dropped. */
export function cleanProfile(raw: unknown): Profile {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    name: text(r.name, 40),
    age: num(r.age, 10, 110),
    gender: oneOf(r.gender, GENDERS),
    heightCm: num(r.heightCm, 100, 230),
    weightKg: num(r.weightKg, 25, 250),
    build: oneOf(r.build, BUILDS),
    shoulders: oneOf(r.shoulders, SHOULDERS),
    chestCm: num(r.chestCm, 50, 200),
    waistCm: num(r.waistCm, 40, 200),
    hipsCm: num(r.hipsCm, 50, 220),
    shoeSize: text(r.shoeSize, 12),
    skinTone: oneOf(r.skinTone, SKIN_TONES),
    undertone: oneOf(r.undertone, UNDERTONES),
    hair: text(r.hair, 40),
    fit: oneOf(r.fit, FITS),
    vibes: Array.isArray(r.vibes) ? Array.from(new Set(r.vibes.filter((v): v is string => typeof v === "string" && VIBES.includes(v)))).slice(0, 6) : [],
    favoriteColors: colors(r.favoriteColors),
    avoidColors: colors(r.avoidColors),
    budget: oneOf(r.budget, BUDGETS),
    lifestyle: text(r.lifestyle, 160),
    notes: text(r.notes, 400),
    persona: typeof r.persona === "string" ? r.persona.trim().slice(0, 900) : "",
    personaAt: typeof r.personaAt === "number" && Number.isFinite(r.personaAt) ? r.personaAt : null,
  };
}

export const cmToFeetInches = (cm: number): string => {
  const totalInches = Math.round(cm / 2.54);
  return `${Math.floor(totalInches / 12)}′${totalInches % 12}″`;
};

export const kgToPounds = (kg: number): number => Math.round(kg * 2.20462);

const FIELDS: ((p: Profile) => boolean)[] = [
  (p) => Boolean(p.name),
  (p) => p.age !== null,
  (p) => Boolean(p.gender),
  (p) => p.heightCm !== null,
  (p) => p.weightKg !== null,
  (p) => Boolean(p.build),
  (p) => Boolean(p.skinTone),
  (p) => Boolean(p.fit),
  (p) => p.vibes.length > 0,
  (p) => p.favoriteColors.length > 0 || p.avoidColors.length > 0,
  (p) => Boolean(p.lifestyle),
];

/** 0–100: how much of the profile the stylist has to work with. */
export function completeness(p: Profile): number {
  return Math.round((FIELDS.filter((f) => f(p)).length / FIELDS.length) * 100);
}

const label = <T extends string>(options: readonly { id: T; label: string }[], id: T | "") => options.find((o) => o.id === id)?.label.toLowerCase();

/** The "about the user" brief for the stylist's instructions. Empty string when nothing is filled in. */
export function profileForPrompt(p: Profile): string {
  const lines: string[] = [];

  const who = [p.name && `Name: ${p.name}`, p.age !== null && `${p.age} years old`, label(GENDERS, p.gender)].filter(Boolean);
  if (who.length) lines.push(who.join(", "));

  const body: string[] = [];
  if (p.heightCm !== null) body.push(`${p.heightCm} cm tall (${cmToFeetInches(p.heightCm)})`);
  if (p.weightKg !== null) body.push(`${p.weightKg} kg`);
  const b = label(BUILDS, p.build);
  if (b) body.push(`${b} build`);
  const sh = label(SHOULDERS, p.shoulders);
  if (sh) body.push(`${sh} shoulders`);
  if (p.chestCm !== null) body.push(`chest ${p.chestCm} cm`);
  if (p.waistCm !== null) body.push(`waist ${p.waistCm} cm`);
  if (p.hipsCm !== null) body.push(`hips ${p.hipsCm} cm`);
  if (p.shoeSize) body.push(`shoe size ${p.shoeSize}`);
  if (body.length) lines.push(`Body: ${body.join(", ")}`);

  const look: string[] = [];
  const skin = label(SKIN_TONES, p.skinTone);
  if (skin) look.push(`${skin} skin tone`);
  const under = label(UNDERTONES, p.undertone);
  if (under) look.push(`${under} undertone`);
  if (p.hair) look.push(`${p.hair} hair`);
  if (look.length) lines.push(`Colouring: ${look.join(", ")}`);

  const taste: string[] = [];
  const fit = label(FITS, p.fit);
  if (fit) taste.push(`prefers a ${fit} fit`);
  if (p.vibes.length) taste.push(`style: ${p.vibes.join(", ")}`);
  const budget = label(BUDGETS, p.budget);
  if (budget) taste.push(`${budget} budget`);
  if (taste.length) lines.push(`Taste: ${taste.join("; ")}`);

  if (p.favoriteColors.length) lines.push(`Favourite colours: ${p.favoriteColors.map(colorLabel).join(", ")}`);
  if (p.avoidColors.length) lines.push(`Avoids these colours: ${p.avoidColors.map(colorLabel).join(", ")}`);
  if (p.lifestyle) lines.push(`Day to day: ${p.lifestyle}`);
  if (p.notes) lines.push(`In their own words: "${p.notes.replace(/"/g, "'")}"`);
  if (p.persona) lines.push(`Style persona: ${p.persona.replace(/\s+/g, " ")}`);

  return lines.join("\n");
}
