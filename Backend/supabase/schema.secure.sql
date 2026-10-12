-- Drape: PRIVATE schema — every row and every photo belongs to one signed-in Supabase Auth user.
--
-- The app signs users in with Supabase Auth (email + password) and sends their access token with every request.
--
-- What this gives you:
--   * every table has user_id (defaults to auth.uid()) and a row is visible/changeable only by its owner;
--   * the `anon` role (the public key everyone can see in the site) has NO access to any table or photo;
--   * photos live at  <user id>/<piece id>/<front|back>[_sm]  and storage policies check that first folder;
--   * ids are unique per user (primary key is (user_id, id)), so two users can never collide or overwrite each other.
--
-- Safe to re-run. Run it on a project you own, in Supabase -> SQL Editor. It refuses to run on top of the old
-- open schema (see the check below) so it can't silently leave open policies behind.

do $$
begin
  if to_regclass('public.items') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'items' and column_name = 'user_id') then
    raise exception 'public.items comes from the old open schema (no user_id). Back up your data (Settings -> Download backup), run lockdown.sql, then drop the old tables or use a fresh project, and run this again.';
  end if;
end $$;

create table if not exists public.items (
  user_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id          text   not null check (id ~ '^[0-9a-f]{8}$'),
  type        text   not null,
  category    text   not null,
  colors      text[] not null default '{}',
  description text   not null default '',
  has_back    boolean not null default false,
  favorite    boolean not null default false,
  wear_count  integer not null default 0,
  last_worn   bigint,
  created_at  bigint not null,
  updated_at  bigint not null,
  primary key (user_id, id)
);

create table if not exists public.outfits (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null check (id ~ '^[0-9a-f]{8}$'),
  name       text   not null,
  item_ids   text[] not null default '{}',
  note       text   not null default '',
  created_at bigint not null,
  worn_count integer not null default 0,
  last_worn  bigint,
  primary key (user_id, id)
);
create index if not exists outfits_by_time on public.outfits (user_id, created_at desc);

create table if not exists public.profile (
  user_id    uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb  not null default '{}',
  updated_at bigint not null default 0
);

create table if not exists public.chats (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id         text   not null check (id ~ '^[0-9a-f]{8}$'),
  title      text   not null default 'New chat',
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, id)
);
create index if not exists chats_by_recent on public.chats (user_id, updated_at desc);

create table if not exists public.chat_messages (
  user_id    uuid   not null default auth.uid(),
  id         text   not null,
  chat_id    text   not null,
  role       text   not null check (role in ('user', 'assistant')),
  content    text   not null,
  created_at bigint not null,
  error      text,
  error_kind text,
  model      text,
  primary key (user_id, id),
  foreign key (user_id, chat_id) references public.chats (user_id, id) on delete cascade
);
create index if not exists chat_messages_by_chat on public.chat_messages (user_id, chat_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- Row Level Security: owner only. Policies are for signed-in users; `anon` gets none.
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['items', 'outfits', 'profile', 'chats', 'chat_messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner only" on public.%I', t);
    execute format(
      'create policy "owner only" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    -- Supabase grants new tables to anon by default; take that away so RLS isn't the only barrier.
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Photos: private bucket, files under <user id>/..., only the owner can touch them.
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "open photos"  on storage.objects;  -- from the old open schema
drop policy if exists "owner photos" on storage.objects;
create policy "owner photos" on storage.objects for all to authenticated
  using      (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
