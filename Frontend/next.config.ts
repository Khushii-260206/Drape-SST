import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { prepareBuildEnv } from "./build-env";

// One shared env file: .env.local lives at the repository root (next to .env.example), so load it from
// there as well as from Frontend/. Variables already set in the shell (for example in CI) always win.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

// A production build drops the AI provider keys (visitors add their own under Settings, kept in that browser only) and
// refuses to run if a privileged Supabase key is in any public variable. See build-env.ts.
prepareBuildEnv(process.env);

// Only NEXT_PUBLIC_* values are ever forwarded to the browser bundle; nothing else from the env files is.
const publicEnv = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith("NEXT_PUBLIC_") && v !== undefined)) as Record<string, string>;

// GitHub Pages serves a project site from /<repo-name>/, so the deploy workflow passes that
// path in as PAGES_BASE_PATH (it's empty for a user/organisation site or local development).
const basePath = process.env.PAGES_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  // The service worker needs to know where the site lives (/<repo> on GitHub Pages).
  env: { ...publicEnv, NEXT_PUBLIC_BASE_PATH: process.env.PAGES_BASE_PATH ?? "" },
  // Fully static site: no server needed, so it can be hosted on GitHub Pages (or any static host).
  output: "export",
  // Browser tests build into their own folder (see e2e/build.mjs) so they never overwrite a real build in out/.
  distDir: process.env.E2E_BUILD_DIR || undefined,
  basePath,
  // /settings/ -> settings/index.html, which every static host resolves correctly.
  trailingSlash: true,
  images: { unoptimized: true },
  // Pin the project root to Frontend/ (where node_modules and the lockfile are), so a stray package-lock.json in a parent
  // folder can't change which root Next picks.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
