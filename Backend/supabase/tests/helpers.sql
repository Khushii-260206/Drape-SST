create schema if not exists t;
grant usage on schema t to anon, authenticated;
-- Rows visible to / changed by `q` under the current role; -1 when the database refused outright (permission / RLS error).
create or replace function t.n(q text) returns bigint language plpgsql as $$
declare c bigint;
begin
  if q ~* '^\s*select' then execute 'select count(*) from (' || q || ') s' into c;
  else execute q; get diagnostics c = row_count; end if;
  return c;
exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation then return -1;
end $$;
create or replace function t.expect(label text, got bigint, want bigint) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL  %: got %, wanted %', label, got, want; end if;
  raise notice 'PASS  % (%)', label, got;
end $$;
grant execute on all functions in schema t to anon, authenticated;
