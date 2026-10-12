-- Demonstrates what the CURRENT open schema.sql allows. Each line is a hole; PASS here means "the hole is real".
\set ON_ERROR_STOP 1
insert into public.items(id,type,category,created_at,updated_at) values('aaaaaaaa','tshirt','tops',1,1);
insert into storage.objects(bucket_id,name) values('wardrobe','aaaaaaaa/front');
begin; set local role anon;
select t.expect('OPEN: anon can read every item',   t.n('select 1 from public.items'), 1);
select t.expect('OPEN: anon can see every photo',   t.n('select 1 from storage.objects'), 1);
select t.expect('OPEN: anon can insert items',      t.n($q$insert into public.items(id,type,category,created_at,updated_at) values('bbbbbbbb','x','y',1,1)$q$), 1);
select t.expect('OPEN: anon can upload files',      t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','spam/front')$q$), 1);
select t.expect('OPEN: anon can delete all items',  t.n('delete from public.items'), 2);
select t.expect('OPEN: anon can delete all photos', t.n('delete from storage.objects'), 2);
commit;
