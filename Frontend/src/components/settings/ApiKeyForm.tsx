"use client";

import { ChevronDown, CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, Loader2, Repeat, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { healthLabel, statusFor, useAiStatuses } from "@/lib/aistatus";
import { testConnection, type TestResult } from "@/lib/llm";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/providers";
import {
  cleanKey,
  isBuiltInKey,
  removeProviderKey,
  saveProviderKey,
  saveProviderModel,
  selectProvider,
  setRolling,
  useSettings,
} from "@/lib/settings";
import type { Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useToast } from "../Toaster";

const CUSTOM = "__custom__";

const inputClass =
  "w-full rounded-xl border border-gray-200 bg-surface px-3.5 py-2.5 text-base shadow-soft transition placeholder:text-gray-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 focus:outline-none sm:text-sm";

/**
 * "AI connection": one plain status, then the optional key. The key is the person's own (bring-your-own), is optional where
 * the site already has one, lives only in this browser, and goes only to the provider it belongs to. Rotation between
 * providers and model choice are real but rarely needed, so they sit under "Advanced".
 */
export function ApiKeyForm({ compact = false }: { compact?: boolean }) {
  const { settings, hydrated } = useSettings();
  const toast = useToast();
  const [picked, setPicked] = useState<Provider | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const selected = picked ?? settings.provider;
  const info = PROVIDERS[selected];
  const savedKey = settings.keys[selected];
  const savedModel = settings.models[selected] || info.defaultModel;
  const modelValue = modelDraft ?? savedModel;
  const statuses = useAiStatuses();
  const withKey = PROVIDER_IDS.filter((p) => settings.keys[p]);
  const healthOf = (p: Provider) => statusFor(statuses, p, settings.keys[p]);
  const verified = withKey.filter((p) => healthOf(p)?.health === "ok");
  const trouble = withKey.filter((p) => healthOf(p) && healthOf(p)?.health !== "ok" && healthOf(p)?.health !== "model" && healthOf(p)?.health !== "rate");
  const limited = withKey.filter((p) => ["rate", "model"].includes(healthOf(p)?.health ?? ""));
  const canSeePhotos = verified.some((p) => PROVIDERS[p].visionModels.length > 0);
  const names = (ids: Provider[]) => ids.map((p) => PROVIDERS[p].name).join(", ");
  const banner =
    withKey.length === 0
      ? { tone: "warn", title: "AI isn't set up yet", body: "Add a free key below to chat with your stylist and let the AI fill in new pieces from photos." }
      : verified.length > 0
        ? {
            tone: "good",
            title: `Connection successful — ${names(verified)}`,
            body: canSeePhotos
              ? "Your stylist can chat, and the AI can recognise new pieces from their photos."
              : "Your stylist can chat. To also recognise pieces from photos, add a Gemini or OpenRouter key.",
          }
        : trouble.length > 0 || limited.length > 0
          ? {
              tone: "warn",
              title: "AI needs attention",
              body: `${names([...trouble, ...limited])}: ${[...trouble, ...limited].map((p) => healthLabel(true, false, healthOf(p)).text.toLowerCase()).join("; ")}. Check the key below.`,
            }
          : {
              tone: "idle",
              title: "Not tested yet",
              body: `${withKey.length === 1 ? "A key is" : `${withKey.length} keys are`} saved for ${names(withKey)}, but nothing has been sent to the provider. Press “Check connection” to test the selected one; Drape never tests in the background.`,
            };
  const isCustom = customOpen || !info.models.some((m) => m.id === modelValue);

  function choose(provider: Provider) {
    setPicked(provider);
    setKeyDraft("");
    setShowKey(false);
    setModelDraft(null);
    setCustomOpen(false);
    setResult(null);
    if (settings.keys[provider]) selectProvider(provider);
  }

  function onModelSelect(value: string) {
    setResult(null);
    if (value === CUSTOM) {
      setCustomOpen(true);
      setModelDraft(modelValue);
      return;
    }
    setCustomOpen(false);
    setModelDraft(null);
    saveProviderModel(selected, value);
  }

  async function saveAndTest() {
    const key = cleanKey(keyDraft) || cleanKey(savedKey ?? "");
    if (!key) {
      setResult({ ok: false, message: `Paste your ${info.name} key first.` });
      return;
    }
    const model = modelValue.trim() || info.defaultModel;
    setTesting(true);
    setResult(null);
    let outcome: TestResult;
    try {
      outcome = await testConnection({ provider: selected, apiKey: key, model });
    } finally {
      setTesting(false);
    }

    // Only keep the key once the provider has accepted it. A busy or retired model still proves the
    // key itself is good, so that case is saved too (with a heads-up).
    if (outcome.ok || outcome.kind === "rate" || outcome.kind === "model") {
      saveProviderKey(selected, key, model);
      setKeyDraft("");
      setShowKey(false);
      setModelDraft(null);
      // On the chat's first-run card the form disappears as soon as a key is saved, so say it with a toast.
      toast(outcome.ok ? "Connected — your stylist is ready." : outcome.message, outcome.ok ? "success" : "error");
    }
    setResult(outcome);
  }

  if (!hydrated) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" aria-hidden />;

  return (
    <div className="space-y-5">
      {!compact && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm",
            banner.tone === "good" ? "bg-emerald-50 text-emerald-900" : banner.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-gray-100 text-gray-800"
          )}
        >
          {banner.tone === "good" ? <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />}
          <div>
            <p className="font-semibold">{banner.title}</p>
            <p className="mt-0.5">{banner.body}</p>
          </div>
        </div>
      )}

      <div role="radiogroup" aria-label="AI service" className="grid grid-cols-3 gap-2.5">
        {PROVIDER_IDS.map((p) => {
          const isSelected = selected === p;
          const hasKey = Boolean(settings.keys[p]);
          const label = healthLabel(hasKey, isBuiltInKey(p, settings.keys[p]), healthOf(p));
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => choose(p)}
              className={cn(
                "relative rounded-2xl border p-3 text-left transition focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none sm:p-3.5",
                isSelected ? "border-brand-400 bg-brand-50 ring-4 ring-brand-100" : "border-gray-200 bg-surface hover:border-gray-300"
              )}
            >
              <span className="block text-sm font-semibold text-gray-900">{PROVIDERS[p].name}</span>
              <span
                className={cn(
                  "mt-0.5 flex items-start gap-1 text-[11px] leading-tight font-medium",
                  label.tone === "good" ? "text-emerald-700" : label.tone === "warn" ? "text-amber-700" : label.tone === "bad" ? "text-red-700" : "text-gray-500"
                )}
              >
                {label.tone === "good" && <CircleCheck className="size-3.5 shrink-0" aria-hidden />}
                {label.text}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor="api-key" className="text-sm font-medium text-gray-800">
            {info.name} API key <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <a
            href={info.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            Get a free key <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
        <div className="relative">
          <input
            id="api-key"
            name="api-key"
            type={showKey ? "text" : "password"}
            value={keyDraft}
            onChange={(e) => {
              setKeyDraft(e.target.value);
              setResult(null);
            }}
            placeholder={
              savedKey
                ? isBuiltInKey(selected, savedKey)
                  ? "Built in — paste a key here to use your own"
                  : "Key saved — paste a new one to replace it"
                : "Paste your API key"
            }
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className={cn(inputClass, "pr-11")}
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? "Hide key" : "Show key"}
            aria-pressed={showKey}
            className="absolute inset-y-0 right-1.5 my-auto size-8 rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            {showKey ? <EyeOff className="mx-auto size-4" aria-hidden /> : <Eye className="mx-auto size-4" aria-hidden />}
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
          Stored only in this browser (not in your account, backups or anywhere else) and sent only to {info.name}. Avoid saving it on a shared computer.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={saveAndTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-500 disabled:opacity-60"
        >
          {testing && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {testing ? "Checking…" : savedKey && !keyDraft.trim() ? "Check connection" : "Save & check"}
        </button>
        {!compact && savedKey && !isBuiltInKey(selected, savedKey) && (
          <button
            type="button"
            onClick={() => {
              removeProviderKey(selected);
              setResult(null);
            }}
            className="text-sm font-medium text-red-600 transition hover:underline"
          >
            Remove key
          </button>
        )}
      </div>

      {result && (
        <div
          role="status"
          className={cn("flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm", result.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}
        >
          {result.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>{result.ok ? "Connection successful. Your key works." : result.message}</span>
        </div>
      )}

      {!compact && (
        <details className="group rounded-2xl bg-gray-50 px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-gray-800 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none">
            Advanced
            <ChevronDown className="size-4 text-gray-500 transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-4 space-y-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                aria-label="Share the load between my keys"
                checked={settings.rolling}
                onChange={(e) => setRolling(e.target.checked)}
                className="mt-1 size-4 shrink-0 accent-brand-600"
              />
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-gray-900">
                  <Repeat className="size-3.5 text-blush-600" aria-hidden /> Share the load between my keys
                </span>
                <span className="mt-0.5 block text-gray-600">
                  {withKey.length > 1
                    ? "Replies take turns across your saved keys, and if one is busy the others take over."
                    : "Add keys for more than one service and replies will take turns, so one busy service never blocks you."}
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="model" className="mb-1.5 block font-medium text-gray-800">
                {info.name} model
              </label>
              <div className="relative">
                <select
                  id="model"
                  aria-label={`${info.name} model`}
                  value={isCustom ? CUSTOM : modelValue}
                  onChange={(e) => onModelSelect(e.target.value)}
                  className={cn(inputClass, "appearance-none pr-10")}
                >
                  {info.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.note}
                    </option>
                  ))}
                  <option value={CUSTOM}>Custom model id…</option>
                </select>
                <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-gray-400" aria-hidden />
              </div>
              {isCustom && (
                <input
                  type="text"
                  value={modelValue}
                  onChange={(e) => setModelDraft(e.target.value)}
                  onBlur={() => {
                    const v = modelValue.trim();
                    if (v) saveProviderModel(selected, v);
                  }}
                  placeholder="provider/model-name"
                  aria-label="Custom model id"
                  autoCapitalize="off"
                  spellCheck={false}
                  className={cn(inputClass, "mt-2 font-mono sm:text-xs")}
                />
              )}
              <p className="mt-1.5 text-xs text-gray-500">If a model is busy or retired, Drape automatically tries the next-best one.</p>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
