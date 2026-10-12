// Builds the static site for the browser tests with a dummy, unroutable Supabase host, so those tests can never reach a
// real project. Shell variables win over .env.local, so nothing from your real settings is used.
// Output goes to Frontend/.e2e-out (never Frontend/out, which may hold a real build). `npm run e2e` runs this first, so the
// browser tests always drive the current source.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

export const E2E_OUT = path.resolve(import.meta.dirname, "../.e2e-out");
rmSync(E2E_OUT, { recursive: true, force: true });
const env = { ...process.env, E2E_BUILD_DIR: ".e2e-out", NEXT_PUBLIC_SUPABASE_URL: "https://mock-project.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "mock-anon-key" };
const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env, shell: process.platform === "win32", timeout: 10 * 60_000 });
process.exit(r.status ?? 1);
