-- Emergency lockdown for a project that ran the OPEN schema.sql.
--
-- Removes every "open" policy and takes table access away from the public anon key, so the data and photos can no
-- longer be read, changed or deleted by anyone holding the site's key. It does NOT delete any data.
-- Side effect: the current (login-less) app stops working against this project until real Auth is added.
--
-- Only run this on a Supabase project YOU own. Safe to re-run.

drop policy if exists "open items"    on public.items;
drop policy if exists "open messages" on public.chat_messages;
drop policy if exists "open outfits"  on public.outfits;
drop policy if exists "open profile"  on public.profile;
drop policy if exists "open chats"    on public.chats;
drop policy if exists "open photos"   on storage.objects;

do $$
declare t text;
begin
  foreach t in array array['items', 'outfits', 'profile', 'chats', 'chat_messages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated, public', t);
    end if;
  end loop;
end $$;

update storage.buckets set public = false where id = 'wardrobe';
