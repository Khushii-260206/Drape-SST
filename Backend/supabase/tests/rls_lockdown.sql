-- After lockdown.sql the open policies are gone and anon is shut out, with the data still there.
\set ON_ERROR_STOP 1
insert into public.items(id,type,category,created_at,updated_at) values('cccccccc','tshirt','tops',1,1);
insert into storage.objects(bucket_id,name) values('wardrobe','cccccccc/front');
begin; set local role anon;
select t.expect('LOCKED: anon cannot read items',    t.n('select 1 from public.items'), -1);
select t.expect('LOCKED: anon cannot delete items',  t.n('delete from public.items'), -1);
select t.expect('LOCKED: anon sees no photos',       t.n('select 1 from storage.objects'), 0);
select t.expect('LOCKED: anon cannot delete photos', t.n('delete from storage.objects'), 0);
select t.expect('LOCKED: anon cannot upload',        t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','x/front')$q$), -1);
commit;
select t.expect('LOCKED: data not deleted', (select count(*) from public.items) + (select count(*) from storage.objects), 2);
