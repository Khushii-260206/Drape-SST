// Lets `node --test` run the app's TypeScript as-is: extensionless relative imports resolve to .ts, "@/" to src/.
// Also pins the Supabase env to a dummy, unroutable project so no test can ever reach a real one.
import { register } from "node:module";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock-project.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock-anon-key";
for (const k of ["GEMINI", "GROQ", "OPENROUTER"]) delete process.env[`NEXT_PUBLIC_${k}_API_KEY`];
register("./resolve-ts.mjs", import.meta.url);
