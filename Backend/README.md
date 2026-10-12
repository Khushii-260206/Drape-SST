# Backend

Drape's server side is [Supabase](https://supabase.com): Postgres for the data and Storage for photos. The
frontend talks to it directly, so this folder holds the definition of that backend rather than a running
server.

## `supabase/schema.secure.sql`

Idempotent — safe to re-run. Paste it into **Supabase → SQL Editor → Run** on a project of your own.

| Object                | Purpose                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `items`               | Wardrobe pieces (type, colours, favourites, wear tracking)                      |
| `outfits`             | Saved looks                                                                     |
| `chats`, `chat_messages` | Conversations with the stylist                                               |
| `profile`             | One profile row per user (`user_id` is the key)                                 |
| `wardrobe` bucket     | Private photo storage (`<user id>/<piece id>/front or back`, 10 MB, jpeg/png/webp) |

## Files (all in `Backend/supabase/`)

| File                     | Use it when                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `schema.secure.sql`      | **The one the app uses.** Owner-only tables and photos; the public anon role has no access.   |
| `lockdown.sql`           | A project ran the old open `schema.sql` and holds data that must not stay public. Keeps data, shuts anon out. |
| `schema.sql`             | Legacy and unused: the old open, login-less schema. The app no longer works against it.       |
| `tests/run-local.sh`     | Verifies all three against a throw-away local Postgres (no Supabase involved).                |

## Delete account (Edge Function)

`supabase/functions/delete-account/` permanently deletes the **calling** user: first every photo under `<user id>/` in the
`wardrobe` bucket, then their rows (`chat_messages`, `chats`, `outfits`, `items`, `profile`), and only then the Auth user. If a
step fails it stops there and says which one; the account still exists and the button can simply be pressed again.
It needs the service-role key, which is why it runs on Supabase and **not** in the browser: Supabase injects
`SUPABASE_SERVICE_ROLE_KEY` into the function itself, so no secret is ever stored in this repo, `.env.local` or the site.

Deploy once (needs the Supabase CLI and a login; this is the one step that can't be done from this repository alone):

```bash
supabase link --project-ref <your-project-ref>
supabase functions deploy delete-account        # JWT verification stays on (the default)
```

How it protects accounts: the id to delete comes from the caller's verified access token, never from the request; the call
must carry `{"confirm":"DELETE"}`; the token must have been issued in the last 5 minutes (the app re-checks the password
right before calling, which issues one); only paths inside `<that user id>/` are ever removed. `core.ts` holds the
procedure and is unit-tested in `Frontend/tests/account-deletion.test.ts`; `index.ts` is only the Deno wiring. Until the
function is deployed, the app says "Account deletion isn't set up on this Supabase project yet" and changes nothing.

## Access model

The app signs users in with Supabase Auth (email + password, `src/lib/auth.ts`). Every request to the database and to
storage carries the signed-in user's access token, never just the anon key. `schema.secure.sql` then enforces:

- every row has a `user_id` (default `auth.uid()`), and one policy per table allows a row only to its owner;
- the `anon` role has no grants on any table, so the public key shipped in the site reads nothing on its own;
- photos live under `<user id>/…` and the storage policy checks that first folder;
- ids are unique per user (`(user_id, id)`), so two accounts can't collide, and chat messages can only attach to the
  same user's chat.

Verified: `tests/run-local.sh` runs these policies on a local Postgres with a stand-in for Supabase's `auth` and
`storage` schemas (53 checks across the open, lockdown, secure and guard scenarios, 40 of them on `schema.secure.sql`: cross-account reads, edits, deletes, inserts and uploads are all refused, anon gets
nothing, the bucket is private). `npm test` in `Frontend/` covers the app side against an in-memory fake.
**Not verified:** a real Supabase project. Nobody has yet run the schema on one, signed up through the real Auth
service, or uploaded a photo through the real Storage service.

**Moving data from the old open project:** in the old app, Settings → Download backup; in the new project, sign up,
then restore the file in Settings. Then close the old project with `lockdown.sql` or delete it.

Rules that always apply:

- Only the **anon / publishable** key belongs in `.env.local`.
- The **service-role / secret** key and the database password must never be added to this project or to any
  `NEXT_PUBLIC_*` variable. A production build stops if it finds one.
- AI provider keys in `.env.local` are used by `npm run dev` only; production builds drop them.

## Connect your own Supabase project and verify it end to end

Everything below happens in your own Supabase dashboard and in `.env.local`; no step needs a secret key.

1. supabase.com → **New project** (a fresh one, never the retired one). Project Settings → API: copy the **Project URL**
   and the **anon / publishable** key. Do not copy the service-role / secret key or the database password.
2. SQL Editor → paste and run `Backend/supabase/schema.secure.sql`. It also creates the private `wardrobe` bucket
   (no manual bucket step). Check Storage shows `wardrobe` **without** the "public" badge.
3. Authentication → Providers: Email enabled. **Turn "Confirm email" off while you run step 6**; you can turn it back
   on afterwards. If it stays on, set Authentication → URL Configuration → **Site URL** to your deployed address
   (for GitHub Pages that includes the repo path, e.g. `https://<user>.github.io/<repo>/`) and add it to **Redirect URLs**.
   Password reset ("Forgot password?") uses the same list: the e-mailed link returns to the page the request was made
   from, so add `http://localhost:3000/` as well for local use, otherwise Supabase sends the link to the Site URL.
4. Put the URL and anon key in the root `.env.local`, replacing the old values (edit the file yourself; do not paste
   keys anywhere else). In `Frontend/`: `npm run check:env` must pass, then `npm run verify:project` (read-only: shows the
   public key alone reads nothing; the bucket's privacy is always NOT VERIFIED, so confirm it in the dashboard).
5. `npm run dev`: create an account, add a piece with a photo. The photo must survive a reload, and Storage → `wardrobe`
   lists `<your user id>/<id>/front` and `…/front_sm`. Sign out: the sign-in screen shows no data.
   Create a second account (private window): it must see an empty closet.
6. **Live two-account check:** `npm run verify:accounts` in `Frontend/`. It signs up two throw-away accounts on the real
   project and proves B cannot read, edit, delete or overwrite A's rows and photos, the bucket is not public, and a
   signed URL works and then stops working after it expires (and a fresh one works). It prints only PASS/FAIL lines and
   removes its own rows and files. Delete the two `drape-verify-*@example.com` users afterwards (Authentication → Users).
   The in-app recovery from an expired link (the photo reappears by itself) is exercised only by the mocked
   browser tests; to see it for real, leave a closet open past the link lifetime and watch the photos reload.
7. Production build (does not deploy): in `Frontend/`, `npm run build`. It writes `Frontend/out/`, replacing the
   previous one, so move that folder aside first if you want to keep it. The build drops AI keys and refuses a
   service-role key. Afterwards search `out/` for your own anon key only; no other key may appear.
