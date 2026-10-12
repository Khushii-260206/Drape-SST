"use client";

import {
  ArrowUp,
  Briefcase,
  Camera,
  Check,
  CloudRain,
  Coffee,
  Copy,
  History,
  GlassWater,
  MessageCircle,
  Palette,
  Plus,
  RotateCcw,
  ShoppingBag,
  Sun,
  Square,
  SquarePen,
  Tags,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CATEGORIES } from "@/lib/catalog";
import { PROVIDERS } from "@/lib/providers";
import { getConfigChain, useSettings } from "@/lib/settings";
import type { ChatMessage, Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChat } from "../ChatProvider";
import { useProfile } from "../ProfileProvider";
import { LogoMark } from "../Logo";
import { ApiKeyForm } from "../settings/ApiKeyForm";
import { useToast } from "../Toaster";
import { useWardrobe } from "../WardrobeProvider";
const ChatHistory = dynamic(() => import("./ChatHistory").then((m) => m.ChatHistory));
import { Markdown, plainTextFor } from "./Markdown";
import { WeatherChip } from "./WeatherChip";

const SUGGESTIONS: { icon: LucideIcon; title: string; prompt: string }[] = [
  { icon: Sun, title: "Outfit for today", prompt: "What should I wear today? Take the weather into account." },
  { icon: Coffee, title: "Coffee date", prompt: "What should I wear for a casual coffee date?" },
  { icon: Briefcase, title: "Monday at the office", prompt: "Put together an office look for Monday morning." },
  { icon: GlassWater, title: "Wedding guest", prompt: "Put together an outfit for a wedding I'm attending as a guest." },
  { icon: CloudRain, title: "Rainy day", prompt: "What should I wear if it's raining today?" },
  { icon: ShoppingBag, title: "What to buy next", prompt: "What should I buy next to get the most new outfits?" },
  { icon: Palette, title: "Colour gaps", prompt: "Which colours am I missing, and what would work with what I own?" },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Camera, title: "Snap your clothes", text: "A front photo (and the back, if you like) of each piece." },
  { icon: Tags, title: "Say what it is", text: "Pick the type and colours, add a note on fit or fabric." },
  { icon: MessageCircle, title: "Ask for outfits", text: "Any occasion, any weather — or what's worth buying next." },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function modelLabel(provider: Provider, model: string): string {
  return PROVIDERS[provider].models.find((m) => m.id === model)?.label ?? model;
}

function ThinkingDots() {
  return (
    <div className="flex h-8 items-center gap-1.5 text-sm text-gray-500" aria-label="Styling">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-blush-500 motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
      <span className="ml-1.5 font-serif text-base italic">Putting looks together…</span>
    </div>
  );
}

const MessageRow = memo(function MessageRow({
  message,
  isLast,
  onRetry,
}: {
  message: ChatMessage;
  isLast: boolean;
  onRetry: () => void;
}) {
  const { items } = useWardrobe();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-rise">
        <div className="max-w-[85%] rounded-[22px] rounded-br-md bg-brand-600 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(plainTextFor(message.content, items));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("Couldn't copy — your browser blocked clipboard access.", "error");
    }
  }

  const thinking = message.pending && !message.content;

  return (
    <div className="flex gap-3 animate-rise">
      <LogoMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1">
        {thinking ? (
          <ThinkingDots />
        ) : message.content ? (
          <Markdown text={message.content} streaming={message.pending} />
        ) : null}

        {message.error && (
          <div role="alert" className="mt-2 flex items-start gap-2 rounded-2xl bg-red-50 px-3.5 py-3 text-sm text-red-800 ring-1 ring-red-100">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p>{message.error}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                {message.errorKind === "auth" && (
                  <Link href="/settings/" className="font-semibold underline underline-offset-2">
                    Open Settings
                  </Link>
                )}
                {isLast && (
                  <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {!message.pending && message.content && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-400">
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-1 transition hover:bg-gray-100 hover:text-gray-700"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
            {isLast && !message.error && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 py-1 transition hover:bg-gray-100 hover:text-gray-700"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Another idea
              </button>
            )}
            {message.model && <span className="px-2">{message.model.split("/").pop()}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

function Onboarding() {
  const { profile } = useProfile();
  return (
    <div className="mx-auto w-full max-w-2xl pt-4 sm:pt-10">
      <div className="hero-surface rounded-[32px] px-5 py-9 text-center sm:px-10 sm:py-12">
      <p className="text-xs font-semibold tracking-[0.18em] text-blush-700 uppercase animate-rise">Hi {profile.name} — let&apos;s build your wardrobe</p>
      <h1 className="mt-3 font-serif text-[44px] leading-[1.05] tracking-tight text-gray-900 animate-rise [animation-delay:60ms] sm:text-6xl">
        Your wardrobe, <em className="text-blush-600">styled.</em>
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-gray-600 animate-rise [animation-delay:120ms] sm:text-base">
        Photograph your clothes once. Drape learns every piece and puts together outfits for any occasion — from what
        you already own.
      </p>
      </div>

      <ol className="mt-9 grid gap-3 text-left sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li
            key={title}
            className="glass-card rounded-3xl p-5 animate-rise"
            style={{ animationDelay: `${180 + i * 70}ms` }}
          >
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-sage-100 text-sage-700">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-serif text-2xl text-blush-400">{i + 1}</span>
            </div>
            <h2 className="mt-4 text-[15px] font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">{text}</p>
          </li>
        ))}
      </ol>

      <Link
        href="/wardrobe/"
        className="mt-9 inline-flex items-center gap-2 rounded-full bg-brand-600 px-6 py-3 text-[15px] font-semibold text-white shadow-lift transition hover:bg-brand-500 active:scale-[0.98] animate-rise [animation-delay:400ms]"
      >
        <Plus className="size-4.5" aria-hidden /> Add your first clothing item
      </Link>
    </div>
  );
}

function Welcome({ onPick, canChat }: { onPick: (text: string) => void; canChat: boolean }) {
  const { items } = useWardrobe();
  const { profile } = useProfile();
  const [hello] = useState(greeting);
  const counts = CATEGORIES.map((c) => ({ ...c, n: items.filter((i) => i.category === c.id).length })).filter((c) => c.n > 0);

  return (
    <div className="mx-auto w-full max-w-2xl pt-4 sm:pt-10">
      <div className="hero-surface rounded-[32px] px-5 py-7 sm:px-9 sm:py-9">
      <p className="text-xs font-semibold tracking-[0.18em] text-blush-700 uppercase animate-rise">
        {hello}, {profile.name}
      </p>
      <h1 className="mt-2 font-serif text-[40px] leading-[1.05] tracking-tight text-gray-900 animate-rise [animation-delay:60ms] sm:text-[56px]">
        What are we <em className="text-blush-600">wearing</em> today?
      </h1>
      <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-gray-600 animate-rise [animation-delay:120ms]">
        I know all {items.length} {items.length === 1 ? "piece" : "pieces"} in your wardrobe. Ask for an outfit, a look
        for an occasion — or what to buy next.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs animate-rise [animation-delay:160ms]">
        <WeatherChip />
        {counts.map((c) => (
          <Link
            key={c.id}
            href="/wardrobe/"
            className="rounded-full bg-surface px-3 py-1.5 font-medium text-gray-600 ring-1 ring-gray-200 transition hover:ring-gray-300"
          >
            {c.label} <span className="text-gray-400">{c.n}</span>
          </Link>
        ))}
      </div>
      </div>

      {canChat && (
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map(({ icon: Icon, title, prompt }, i) => (
            <button
              key={title}
              type="button"
              onClick={() => onPick(prompt)}
              className="group glass-card flex items-center gap-3.5 rounded-2xl p-3.5 text-left transition hover:-translate-y-0.5 hover:border-blush-200 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none animate-rise"
              style={{ animationDelay: `${200 + i * 50}ms` }}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sage-100 text-sage-700 transition group-hover:bg-blush-100 group-hover:text-blush-700">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">{title}</span>
                <span className="block truncate text-xs text-gray-500">{prompt}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SetupCard() {
  return (
    <div className="mx-auto mt-8 w-full max-w-xl rounded-3xl bg-surface p-5 shadow-soft ring-1 ring-gray-200/70 sm:p-6">
      <h2 className="font-serif text-2xl text-gray-900">Connect an AI — free, takes a minute</h2>
      <p className="mt-1 mb-5 text-sm text-gray-500">Pick a provider, paste a free API key, and your stylist comes alive.</p>
      <ApiKeyForm compact />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-pulse space-y-4 pt-12" aria-hidden>
      <div className="h-3.5 w-28 rounded-full bg-gray-200" />
      <div className="h-12 w-3/4 rounded-2xl bg-gray-200" />
      <div className="h-4 w-2/3 rounded-full bg-gray-200/70" />
      <div className="grid gap-2.5 pt-6 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[68px] rounded-2xl bg-gray-200/60" />
        ))}
      </div>
    </div>
  );
}

export default function ChatView() {
  const { ready: wardrobeReady, items } = useWardrobe();
  const { messages, chats, ready: chatReady, streaming, send, stop, regenerate, newChat } = useChat();
  const { config, hydrated, settings } = useSettings();
  const chain = getConfigChain(settings);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Follow the conversation while the user is at the bottom; leave them alone if they scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      stickRef.current = el.scrollHeight - (window.scrollY + window.innerHeight) < 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    // Only follow an actual conversation — the welcome screen should open at the top.
    if (messages.length > 0 && stickRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || streaming || !config) return;
    stickRef.current = true;
    send(value);
    setDraft("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // On phones the Enter key should add a new line; the send button is right there.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    submit(draft);
  }

  const ready = hydrated && wardrobeReady && chatReady;
  const hasMessages = messages.length > 0;
  const emptyWardrobe = items.length === 0;
  // With an empty wardrobe and no conversation, the onboarding is the whole page — no composer yet.
  const showComposer = ready && config && (hasMessages || !emptyWardrobe);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
      <div className="flex-1 py-5">
        {!ready ? (
          <LoadingState />
        ) : (
          <>
            {(hasMessages || chats.length > 0) && (
              <div className="mb-5 flex items-center justify-between gap-3">
                {hasMessages ? <h1 className="shrink-0 font-serif text-xl text-gray-900">Your stylist</h1> : <span />}
                {hasMessages && <WeatherChip className="min-h-9 min-w-0 !py-1 text-xs" />}
                <div className="flex shrink-0 items-center gap-2">
                  {chats.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(true)}
                      aria-label="Your chats"
                      className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full bg-surface p-2 text-xs font-medium whitespace-nowrap text-gray-600 shadow-soft ring-1 ring-gray-200/70 transition hover:text-gray-900 sm:px-3.5 sm:py-1.5"
                    >
                      <History className="size-4 sm:size-3.5" aria-hidden /> <span className="hidden sm:inline">Chats · {chats.length}</span>
                    </button>
                  )}
                  {hasMessages && (
                    <button
                      type="button"
                      onClick={newChat}
                      disabled={streaming}
                      aria-label="New chat"
                      className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full bg-surface p-2 text-xs font-medium whitespace-nowrap text-gray-600 shadow-soft ring-1 ring-gray-200/70 transition hover:text-gray-900 disabled:opacity-50 sm:px-3.5 sm:py-1.5"
                    >
                      <SquarePen className="size-4 sm:size-3.5" aria-hidden /> <span className="hidden sm:inline">New chat</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {hasMessages ? (
              <div role="log" className="space-y-7">
                {messages.map((m, i) => (
                  <MessageRow key={m.id} message={m} isLast={i === messages.length - 1} onRetry={regenerate} />
                ))}
                {/* A question with no answer (page reloaded mid-reply, or Stop pressed before any text). */}
                {!streaming && config && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex items-center gap-3 pl-10 text-sm text-gray-500">
                    <span>No reply yet.</span>
                    <button type="button" onClick={regenerate} className="font-medium text-brand-600 underline underline-offset-2">
                      Try again
                    </button>
                  </div>
                )}
              </div>
            ) : emptyWardrobe ? (
              <Onboarding />
            ) : (
              <Welcome onPick={submit} canChat={Boolean(config)} />
            )}
            {!config && <SetupCard />}
          </>
        )}
        <div ref={endRef} />
      </div>

      {showComposer && (
        <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-10 -mx-4 bg-gradient-to-t from-paper via-paper/95 to-transparent px-4 pt-5 pb-3 sm:bottom-0 sm:-mx-6 sm:px-6 sm:pb-5">
          <form
            onSubmit={onSubmit}
            className="glass flex items-end gap-2 rounded-[26px] p-2 transition focus-within:ring-2 focus-within:ring-brand-300"
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              aria-label="Message your stylist"
              placeholder="Ask your stylist anything…"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-base text-gray-900 outline-none placeholder:text-gray-400 sm:text-[15px]"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition hover:opacity-85"
              >
                <Square className="size-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label="Send message"
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-white transition",
                  draft.trim() ? "bg-blush-500 hover:bg-blush-600 active:scale-95" : "bg-gray-200"
                )}
              >
                <ArrowUp className="size-5" aria-hidden />
              </button>
            )}
          </form>
          <p className="mt-2 text-center text-[11px] text-gray-500">
            <span className="hidden sm:inline">
              {settings.rolling && chain.length > 1
                ? `Rotating across ${chain.map((c) => PROVIDERS[c.provider].name).join(" · ")}`
                : `${PROVIDERS[config.provider].name} · ${modelLabel(config.provider, config.model)}`}{" "}
              ·{" "}
            </span>
            Drape can make mistakes — trust your mirror.
          </p>
        </div>
      )}

      {historyOpen && <ChatHistory open onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
