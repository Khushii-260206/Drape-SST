# Demo video script (about 5 minutes)

Record against your deployed site (or `npm run dev`) with a real Supabase project and your own AI key. Only show what you
actually do on screen; skip a step rather than faking it. Hide the key when you paste it (the field is masked).

1. **Intro (15 s)**: what Drape is; static Next.js + Supabase + free AI providers.
2. **Sign up / sign in (30 s)**: create an account, confirm the email if enabled, enter your name. Reload the page: still signed in.
3. **Add a piece manually (30 s)**: photo, type from the categories (show several kinds of tops), main and second colour, save.
4. **Add a piece with AI (45 s)**: choose a photo; colours appear instantly (on-device); "Fill in with AI" → editable suggestion → Save. Mention one call per photo.
5. **Wardrobe tools (30 s)**: search, filter, sort, favourite, edit, delete, open Insights.
6. **Settings → AI connection (45 s)**: show "Key saved — not tested", press **Check connection**, show the real result. Open Advanced.
7. **Stylist chat (45 s)**: ask for an outfit; save a suggested look to Outfits; reopen it from Chats.
8. **Profile, dark mode, backup (30 s)**: edit profile; toggle dark; export a backup and say AI keys are excluded.
9. **Security (30 s)**: sign out and in as a second account to show it sees none of the first account's data; mention RLS and the private bucket.
10. **Account deletion (20 s)**: only if the `delete-account` function is deployed; use a throw-away account.
11. **Tests (20 s)**: show `npm test` and `npm run e2e` passing; say these use mocks, plus the read-only live `verify:project`.
