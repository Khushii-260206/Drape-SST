-- LOCAL STAND-IN for the parts of Supabase the schema touches (roles, auth.uid(), storage tables). Test use only.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql as
  $$ declare p text[]; begin select string_to_array(name, '/') into p; return p[1:array_length(p, 1) - 1]; end $$;
-- Same defaults a real Supabase project has: anon and authenticated may use everything in these schemas unless RLS stops them.
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid(), storage.foldername(text) to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
grant all on storage.objects, storage.buckets to anon, authenticated;
