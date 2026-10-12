import type { Provider } from "./types";

type ModelOption = { id: string; label: string; note: string };

export type ProviderInfo = {
  name: string;
  /** Where to create a free key. */
  keyUrl: string;
  keyHost: string;
  endpoint: string;
  defaultModel: string;
  models: ModelOption[];
  /** Tried in order when the chosen model is busy or has been retired. */
  fallbackModels: string[];
  /** Models that can look at a photo (used for "detect colours"); empty if the provider has none on its free tier. */
  visionModels: string[];
};

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  gemini: {
    name: "Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHost: "aistudio.google.com",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-3.8-flash",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Best quality · recommended" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "Reliable all-rounder" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", note: "Fastest" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", note: "Deepest thinking, slower" },
    ],
    fallbackModels: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"],
    visionModels: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
  },
  groq: {
    name: "Groq",
    keyUrl: "https://console.groq.com/keys",
    keyHost: "console.groq.com/keys",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "openai/gpt-oss-120b",
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "Best quality · recommended" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "Faster, lighter" },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", note: "Balanced" },
    ],
    fallbackModels: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
    visionModels: [],
  },
  openrouter: {
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    keyHost: "openrouter.ai/keys",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "nvidia/nemotron-3-super-120b-a12b:free",
    models: [
      {
        id: "nvidia/nemotron-3-super-120b-a12b:free",
        label: "Nemotron 3 Super 120B (free)",
        note: "Best quality · recommended",
      },
      { id: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B (free)", note: "Balanced" },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", note: "Good all-rounder" },
    ],
    fallbackModels: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3.8-27b:free",
      "google/gemma-4-31b-it:free",
    ],
    visionModels: ["google/gemma-4-31b-it:free"],
  },
};

/** Display order; the first one with a key is the default. */
export const PROVIDER_IDS: Provider[] = ["gemini", "groq", "openrouter"];
