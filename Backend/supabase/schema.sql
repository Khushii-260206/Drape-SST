-- My Wardrobe: tables and the photo bucket. Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- !! LEGACY. The app now signs users in and sends a user_id with every row and a <user id>/ folder with every photo,
-- !! so it no longer works against this schema. Use schema.secure.sql. This file is kept only to document the old open
-- !! setup (it let the public anon key read, change and DELETE everything; tests/run-local.sh proves it).
-- To close a project that ran this file: run lockdown.sql (no data is deleted).

create table if not exists public.items (
  id          text primary key check (id ~ '^[0-9a-f]{8}$'),
  type        text   not null,
  category    text   not null,
  colors      text[] not null default '{}',
  description text   not null default '',
  has_back    boolean not null default false,
  created_at  bigint not null,
  updated_at  bigint not null
);

create table if not exists public.chat_messages (
  id         text primary key,
  role       text   not null check (role in ('user', 'assistant')),
  content    text   not null,
  created_at bigint not null,
  error      text,
  error_kind text,
  model      text
);
create index if not exists chat_messages_by_time on public.chat_messages (created_at);

alter table public.items         enable row level security;
alter table public.chat_messages enable row level security;
drop policy if exists "open items"    on public.items;
drop policy if exists "open messages" on public.chat_messages;
create policy "open items"    on public.items         for all to anon, authenticated using (true) with check (true);
create policy "open messages" on public.chat_messages for all to anon, authenticated using (true) with check (true);

-- Photo bucket. Files live at  <piece id>/<front|back>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "open photos" on storage.objects;
create policy "open photos" on storage.objects for all to anon, authenticated
  using (bucket_id = 'wardrobe') with check (bucket_id = 'wardrobe');

-- ---------------------------------------------------------------------------------------------
-- v2: favourites, wear tracking and saved outfits
-- ---------------------------------------------------------------------------------------------
alter table public.items add column if not exists favorite   boolean not null default false;
alter table public.items add column if not exists wear_count integer not null default 0;
alter table public.items add column if not exists last_worn  bigint;

create table if not exists public.outfits (
  id         text primary key check (id ~ '^[0-9a-f]{8}$'),
  name       text   not null,
  item_ids   text[] not null default '{}',
  note       text   not null default '',
  created_at bigint not null,
  worn_count integer not null default 0,
  last_worn  bigint
);
create index if not exists outfits_by_time on public.outfits (created_at desc);

alter table public.outfits enable row level security;
drop policy if exists "open outfits" on public.outfits;
create policy "open outfits" on public.outfits for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.outfits to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- v3: the person using the app (body features, colouring, style) — a single row, id = 'me'
-- ---------------------------------------------------------------------------------------------
create table if not exists public.profile (
  id         text primary key default 'me' check (id = 'me'),
  data       jsonb  not null default '{}',
  updated_at bigint not null default 0
);
alter table public.profile enable row level security;
drop policy if exists "open profile" on public.profile;
create policy "open profile" on public.profile for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.profile to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- v4: separate conversations. "New chat" starts a fresh one and the old ones stay readable.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.chats (
  id         text primary key check (id ~ '^[0-9a-f]{8}$'),
  title      text   not null default 'New chat',
  created_at bigint not null,
  updated_at bigint not null
);
alter table public.chat_messages add column if not exists chat_id text references public.chats (id) on delete cascade;

-- Messages from before conversations existed become one chat (id 00000000), titled after its first question.
insert into public.chats (id, title, created_at, updated_at)
select '00000000',
       coalesce((select left(regexp_replace(content, '\s+', ' ', 'g'), 48) from public.chat_messages
                 where chat_id is null and role = 'user' order by created_at limit 1), 'Earlier chat'),
       min(created_at), max(created_at)
from public.chat_messages where chat_id is null
having count(*) > 0
on conflict (id) do nothing;
update public.chat_messages set chat_id = '00000000' where chat_id is null;

create index if not exists chat_messages_by_chat on public.chat_messages (chat_id, created_at);
create index if not exists chats_by_recent on public.chats (updated_at desc);

alter table public.chats enable row level security;
drop policy if exists "open chats" on public.chats;
create policy "open chats" on public.chats for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.chats to anon, authenticated;
