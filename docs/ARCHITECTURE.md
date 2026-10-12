# Architecture and data flow

```
Browser (static Next.js export, no server of its own)
 ├─ UI: Frontend/src/components   (wardrobe, outfits, chat, settings, auth gate)
 ├─ Local logic: lib/catalog (types/colours), lib/imagecolor + colorsample (colour read on-device),
 │               lib/recognize (one vision call per photo, cached), lib/router + llm (provider rotation)
 ├─ lib/auth ──────────────► Supabase Auth (email + password, session in this browser)
 ├─ lib/db, lib/photos ────► Supabase Postgres + private Storage bucket "wardrobe" (RLS: owner only)
 ├─ lib/llm ───────────────► Gemini / Groq / OpenRouter (key pasted by the user, sent only to its own provider)
 └─ lib/auth.deleteAccount ► Edge Function delete-account (holds the service-role key; runs on Supabase only)
```

## What lives where

| Data | Location | Notes |
| --- | --- | --- |
| Pieces, outfits, chats, messages, profile | Postgres, tables with `user_id` | RLS policy "owner only" on every table |
| Photos | Storage bucket `wardrobe`, path `<user id>/…` | Private; shown through short-lived signed URLs |
| Name, avatar, city, theme | This browser | Cleared on sign-out except theme |
| AI keys, model choice | This browser's localStorage (`my-wardrobe:settings:v1`) | Never sent to Supabase, never in a backup |
| AI provider status | Memory only | Learned from real replies; a reload resets it to "not tested" |
| Service-role key | Supabase (injected into the Edge Function) | Not in the repo, site or `.env` |

## Main flows

- **Sign-in / session**: Supabase Auth in the browser; `AuthGate` shows the sign-in screen when there is no session. A session
  change bumps an account epoch, and `forgetAccountState` clears caches, photo links and per-account settings (sign-out, switch, expiry).
- **Add a piece**: choose a photo → resized on-device → colours read locally (no network) → optionally ONE vision call
  (cached per photo, deduplicated) → every field editable → Save writes the row and uploads the photo and thumbnail.
- **Chat**: wardrobe text + profile + weather → `streamChatAny` rotates providers, cooling down busy ones; photos are not sent.
- **Delete account**: re-enter password (fresh token) → Edge Function verifies the token, then removes photos → rows
  (children first) → Auth user; stops and reports the stage on failure; safe to retry.
- **Static export**: no server code, so the only secrets-capable component is the Edge Function. Everything `NEXT_PUBLIC_*`
  is public; the build refuses privileged keys and strips AI keys from production builds.
