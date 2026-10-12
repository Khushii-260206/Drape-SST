# Drape — your AI stylist

> Repository: `wardrobe`. Pastel-gradient interface, Next.js frontend, Supabase backend.

Photograph your clothes once, then chat with a stylist that knows every piece you own — and you: outfits for
any occasion and any weather, and what to buy next.

- **Wardrobe** — add each piece with a front photo (and an optional back one). **Fill in with AI** looks at the
  photo and suggests the type (T-shirt, polo, button-down, camisole, tunic, bodysuit, hoodie… 85+ types), the colours
  and a short details note: all of it editable, nothing saved until you press Save, and **Enter manually** always
  works without any AI. Colours come from a palette of ~55 named shades (tap the photo with the eyedropper, or they are
  read from the photo on your device the moment you choose it). Star favourites, mark what you wore, sort and filter,
  and open **Insights** for your palette and what's gathering dust. **Detect colours** reviews a suggestion for every
  existing piece and changes nothing until you apply it; clear-cut photos are read on your device and only the
  unclear ones are sent to the AI.
- **Stylist** — a chat that reads your whole wardrobe. Replies come with photos of the pieces, and every
  conversation is kept (**Chats** reopens any of them). It rolls across Gemini, Groq and OpenRouter, so one
  provider's rate limit never blocks you.
- **Outfits** — **Save** any suggested look as a photo collage, mark it worn, remix it, or open the **Ideas**
  tab: every outfit your stylist has ever suggested, collected from all your chats, ready to wear today.
- **You** — your height, weight, build, skin tone, fit and style preferences, favourite and avoided colours,
  budget and lifestyle, plus an AI-written style persona. All of it shapes every outfit.
- **Weather-aware** — add your city (Open-Meteo, no key needed) and outfits account for today's forecast.
- **Pastel interface** — blush-to-lavender banners on warm cream, sage accents, frosted floating surfaces; light, dark or system theme; responsive from a small
  phone to a very large monitor; installs to a home screen like an app.
- **Synced** — pieces, photos, chats and your profile live in *your own Supabase project*, so every device sees
  the same closet. You sign in with email and password (Supabase Auth); every row and photo belongs to your account and
  only you can open it.
- **Sign-in and welcome** — Drape opens on a sign-in / create-account screen. After the first sign-in on a device it
  asks what to call you (and, optionally, for a profile photo). Both are stored in that browser only and are shown in
  the navigation, your profile and the stylist's greeting. Change them on the **You** page; **Settings → Account → Sign
  out** ends the session and makes the browser forget them, along with cached data, photo links, your saved city and
  which chat was open (also when the session ends in another tab). API keys you pasted in Settings are a device setting and
  stay until you press **Remove key**; on a shared computer, remove them before leaving. **Settings → Account → Delete
  account** permanently removes the account, its rows and photos (it needs the `delete-account` Edge Function, see
  [Backend/README.md](Backend/README.md#delete-account-edge-function)); **Forgot password?** on the sign-in screen sends a reset link.

It's a static Next.js site (free on GitHub Pages) that talks straight to Supabase and to the AI providers.

Architecture and data flow: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Demo-video script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

## Project layout

```
wardrobe/
├── Frontend/            Next.js app (TypeScript, Tailwind CSS 4): every page, component and client library
│   ├── src/app/         Routes, global styles and design tokens (globals.css)
│   ├── src/components/  UI, grouped by feature (chat, wardrobe, outfits, profile, settings, ui)
│   ├── src/lib/         Data access, AI provider client, routing and helpers
│   └── public/          Service worker and app icons
├── Backend/
│   └── supabase/        schema.secure.sql: owner-only tables, photo bucket and policies (see Backend/README.md)
├── .github/workflows/   GitHub Pages deployment
├── .env.example         Names of the environment variables (copy to .env.local)
└── README.md
```

**How the two halves fit together.** Drape is a static site: there is no application server of its own.
`Frontend/` is the whole running app and talks directly to your Supabase project (database + file storage)
and to the AI providers. `Backend/` holds everything that defines the server side of that relationship — the
database schema and its access policies. Adding a separate API server would only duplicate what Supabase
already provides, so none exists.

## Setup

Requires Node.js 22 or newer (the Supabase client libraries require it, and CI uses 22).

1. **Create the tables.** In a Supabase project of your own, SQL Editor → paste
   [`Backend/supabase/schema.secure.sql`](Backend/supabase/schema.secure.sql) → Run. It is safe to run again. Then
   Authentication → Providers → Email: keep it enabled (turn "Confirm email" off for a quick personal setup, or leave
   it on and confirm the link you are sent).
2. **Create `.env.local`** in the repository root (it is git-ignored). Start from the template:

   ```bash
   cp .env.example .env.local
   ```

   | Variable                         | Required | Purpose                                   |
   | -------------------------------- | -------- | ----------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`       | yes      | Your Supabase project URL                 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | yes      | Supabase anon / publishable key           |
   | `NEXT_PUBLIC_GEMINI_API_KEY`     | optional | Gemini, **local `npm run dev` only**      |
   | `NEXT_PUBLIC_GROQ_API_KEY`       | optional | Groq, **local `npm run dev` only**        |
   | `NEXT_PUBLIC_OPENROUTER_API_KEY` | optional | OpenRouter, **local `npm run dev` only**  |

   The AI keys are used by the development server on your own machine. A production build (`npm run build`,
   and the GitHub Pages deployment) deliberately leaves them out so they never end up in a public site; there,
   each visitor pastes their own key in **Settings**, and it stays in their browser.

3. **Run it:**

   ```bash
   cd Frontend
   npm install
   npm run dev          # http://localhost:3000
   ```

> **What is public.** Everything starting with `NEXT_PUBLIC_` is compiled into the built site, including the Supabase
> URL and anon key. That is fine here: with `schema.secure.sql` the anon role has no access to any table or photo, and
> a signed-in user can only reach their own rows and files (`Backend/supabase/tests/run-local.sh` checks this on a
> local Postgres). It only holds if you ran `schema.secure.sql` on **your own** project, and never the old open
> `schema.sql`. Never put the database password or the Supabase *service-role* / *secret* key anywhere in this
> project; a production build refuses to run if one is in a `NEXT_PUBLIC_*` variable. Details and what has and has
> not been verified: [Backend/README.md](Backend/README.md).

## Tests

Run from `Frontend/` unless noted.

```bash
npm install
npm test                    # unit/integration tests (mocked Supabase and AI): sign-in, data layer, sign-out cleanup, AI providers, build guard
npm run check:env           # validates .env.local without printing any value
npm run verify:project      # read-only public-key check of YOUR new project (refuses the retired one before any request)
bash ../Backend/supabase/tests/run-local.sh   # 53 SQL policy checks on a throw-away local Postgres (needs Postgres.app or initdb on PATH)

# Browser tests: real Brave/Chrome against the built site, with Supabase and the AI providers faked (58 checks across four suites)
npm i --no-save puppeteer-core   # once; deliberately not a saved dependency
npm run e2e:build                # builds Frontend/.e2e-out with a dummy Supabase host (never touches out/)
npm run e2e                      # rebuilds .e2e-out from the current source, serves it and drives it; CHROME=/path/to/browser to choose the browser
```

`npm run verify:project` has been run against the real Supabase project in `.env.local` (read-only; the public key is refused by
every table's permission rule). `npm run perf` prints local, mocked-network client timings. `npm run verify:accounts` is a *live*
two-account isolation test that creates two throw-away users and sends confirmation emails: run it deliberately, once.

**What is and is not verified.** Every other check above uses mocks or a local stand-in, so it proves the app's logic, the UI
and the SQL policies, **not** that a real Supabase project or real AI keys work. Nothing has been run against a live
Supabase project (Auth, Storage, cross-account isolation) or a live AI provider: do the manual checks in
[Backend/README.md](Backend/README.md) with your own project for that. `npm run e2e:build` uses a dummy URL on purpose,
so the browser run can never touch a real project, and `npm run e2e` refuses a `.e2e-out/` that was not built that way or is older than the source (a real build in `out/` is never overwritten).

**Browser note.** The browser run passes in Brave. In Google Chrome 156 (macOS) it crashed the browser process in the
"upload errors" check on every attempt, while the same step passes alone; the app logged no error, so this looks like
a browser problem, but it is not proven. Use Brave, or another Chrome version, via `CHROME=...`.

## Commands

Run these inside `Frontend/`:

```bash
npm run dev        # development server
npm run lint       # ESLint
npx tsc --noEmit   # type check (run `npm run build` once first so Next's generated types exist)
npm run build      # static export into Frontend/out
```

To test under a sub-path the way GitHub Pages serves a project site, set `PAGES_BASE_PATH` for the build:

```bash
# macOS / Linux
PAGES_BASE_PATH=/my-repo npm run build

# Windows PowerShell
$env:PAGES_BASE_PATH = "/my-repo"; npm run build
```

## Deploy to GitHub Pages

1. Push this project to GitHub.
2. **Settings → Pages → Build and deployment → Source:** *GitHub Actions*.
3. **Settings → Secrets and variables → Actions → Variables:** add `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   nothing else. AI provider keys are deliberately **not** passed to the build (and a production build strips them
   anyway): a published site is public, so each visitor pastes their own key under Settings. Also set the Supabase
   Auth **Site URL** / **Redirect URLs** to the deployed address ([Backend/README.md](Backend/README.md)).
4. The workflow in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds `Frontend/` on every push to
   `main`/`master` and publishes `Frontend/out`.

The same build also works on Vercel, Netlify or any static host (set the project's root directory to `Frontend`).

> **Use your own Supabase project.** Everything in the wardrobe (pieces, photos, chats, the shared profile
> fields on the You page) lives in whichever Supabase project `.env.local` points to. Create your own and run
> `Backend/supabase/schema.secure.sql` there. `npm run check:env`, `npm run dev` and `npm run build` all refuse the old shared project.

## AI keys

Any one provider is enough, but with all three Drape **rolls between them**: each reply starts from the next
provider in turn, so no free tier is hammered. If a provider or model hits a rate limit (or has a daily cap, or
is down or retired) it goes on a cooldown — as long as the provider says — and the next one answers the same
request before you see an error. You only see a message if *every* provider is limited at once. Turn rotation
off in **Settings** to always prefer one provider.

Keys from `.env.local` are used automatically by `npm run dev` only (production builds strip them); you can also paste a
key in **Settings** (saved in that browser only, never in your account or in a backup).

**What the status labels mean.** A saved key is not a working connection. Each provider shows **No key**, **Key saved —
not tested** (or **Built-in key — not tested** for a dev-env key), and only after a real reply **Connection successful**,
**Rate limited**, **Key works — model unavailable**, **Key rejected** or **Connection failed**. Status comes only from
**Check connection** or an AI action you started (a chat message, Fill in with AI); Drape never probes providers in
the background, keeps the result in memory only (a reload goes back to "not tested"), and discards it when the key changes.

| Provider   | Create a key                         | Default model                            |
| ---------- | ------------------------------------ | ---------------------------------------- |
| Gemini     | <https://aistudio.google.com/apikey> | `gemini-3.8-flash`                       |
| Groq       | <https://console.groq.com/keys>      | `openai/gpt-oss-120b`                    |
| OpenRouter | <https://openrouter.ai/keys>         | `nvidia/nemotron-3-super-120b-a12b:free` |

Free models are sometimes busy or retired; Drape tries the next-best one automatically, and you can pick
another (or type any model id) in Settings.

**What is sent where.** Chats send the *text* details of your pieces, your profile and today's weather to the AI
provider — never photos. Photos leave your Supabase project only when you press **Detect with AI** or
**Detect colours**, which send a small copy of that photo to Gemini (or OpenRouter as a backup).
**Settings → Export backup** downloads your wardrobe and saved looks; **Import** merges one back in.

## Design

The palette lives in `Frontend/src/app/globals.css` as design tokens: blush `#F6DDE5`, lavender `#E8E0F5`,
warm cream `#FFF9F2`, sage `#DDE8D5` and charcoal `#343238`. Gradients are reserved for hero sections and page
banners (`.hero-surface`); sage marks secondary actions (`.btn-secondary`); charcoal is the primary action.

### Where things are

| Path (under `Frontend/`)       | What it does                                                               |
| ------------------------------ | -------------------------------------------------------------------------- |
| `src/lib/catalog.ts`           | Clothing types, categories and colours                                     |
| `src/lib/db.ts`                | Supabase tables + photo bucket, chats, outfits, profile, backup/restore    |
| `src/lib/supabase.ts`          | Slim Supabase client (database + storage only)                             |
| `src/lib/photos.ts`            | Batched, cached signed photo URLs (thumbnails and full size)               |
| `src/lib/cache.ts`             | Local read-through cache so every screen paints instantly                  |
| `src/lib/llm.ts`               | Streaming + vision client for Gemini / Groq / OpenRouter, failover, errors |
| `src/lib/router.ts`            | Rolling rotation and cooldowns that pick the provider and model            |
| `src/lib/prompt.ts`            | Turns your wardrobe, profile and weather into the stylist's instructions   |
| `src/lib/looks.ts`             | Finds outfits inside replies (shared by the chat and the Ideas feed)       |
| `src/lib/profile.ts`           | The profile model and the "about the user" brief                           |
| `src/lib/aicolor.ts`           | AI colour detection from a photo                                           |
| `src/lib/weather.ts`           | Open-Meteo city search and forecast                                        |
| `src/lib/theme.ts`             | Light / dark / system theme (applied before first paint)                   |
| `src/components/chat/*`        | Chat UI; replies cite pieces as `[[id]]`, shown as photo chips             |
| `src/components/wardrobe/*`    | Wardrobe grid, add/edit form, colour tools, insights                       |
| `src/components/outfits/*`     | Saved looks and the Ideas feed                                             |
| `src/components/profile/*`     | The You page                                                               |
| `public/sw.js`                 | Service worker: caches the app's hashed files only                         |
| `../Backend/supabase/schema.secure.sql` | Owner-only tables, photo bucket and access policies               |
