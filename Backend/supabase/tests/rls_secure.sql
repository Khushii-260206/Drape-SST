-- Verifies schema.secure.sql against a local Postgres. Raises on the first failed expectation.
\set ON_ERROR_STOP 1
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');

-- Owner A creates one of everything.
begin; set local role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
select t.expect('A inserts item',    t.n($q$insert into public.items(id,type,category,created_at,updated_at) values('11111111','tshirt','tops',1,1)$q$), 1);
select t.expect('A inserts chat',    t.n($q$insert into public.chats(id,created_at,updated_at) values('c1c1c1c1',1,1)$q$), 1);
select t.expect('A inserts message', t.n($q$insert into public.chat_messages(id,chat_id,role,content,created_at) values('m1','c1c1c1c1','user','hi',1)$q$), 1);
select t.expect('A inserts outfit',  t.n($q$insert into public.outfits(id,name,created_at) values('0f0f0f0f','Look',1)$q$), 1);
select t.expect('A inserts profile', t.n($q$insert into public.profile(data) values('{}')$q$), 1);
select t.expect('A edits own item',  t.n($q$update public.items set description='edited' where id='11111111'$q$), 1);
select t.expect('A uploads own photo', t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','aaaaaaaa-0000-0000-0000-000000000001/11111111/front')$q$), 1);
select t.expect('A sees own item',   t.n('select 1 from public.items'), 1);
commit;

-- User B must see and touch none of it.
begin; set local role authenticated; select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',true);
select t.expect('B sees no items',    t.n('select 1 from public.items'), 0);
select t.expect('B sees no chats',    t.n('select 1 from public.chats'), 0);
select t.expect('B sees no messages', t.n('select 1 from public.chat_messages'), 0);
select t.expect('B sees no outfits',  t.n('select 1 from public.outfits'), 0);
select t.expect('B sees no profile',  t.n('select 1 from public.profile'), 0);
select t.expect('B sees no photos',   t.n('select 1 from storage.objects'), 0);
select t.expect('B cannot edit A item',   t.n($q$update public.items set description='hacked' where id='11111111'$q$), 0);
select t.expect('B cannot delete A item', t.n($q$delete from public.items where id='11111111'$q$), 0);
select t.expect('B cannot wipe A outfits',t.n($q$delete from public.outfits$q$), 0);
select t.expect('B cannot delete A photo',t.n($q$delete from storage.objects where bucket_id='wardrobe'$q$), 0);
select t.expect('B cannot insert row owned by A', t.n($q$insert into public.items(user_id,id,type,category,created_at,updated_at) values('aaaaaaaa-0000-0000-0000-000000000001','22222222','x','y',1,1)$q$), -1);
select t.expect('B cannot upload into A folder',  t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','aaaaaaaa-0000-0000-0000-000000000001/x/front')$q$), -1);
select t.expect('B cannot upload outside own folder', t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','11111111/front')$q$), -1);
select t.expect('B cannot attach message to A chat', t.n($q$insert into public.chat_messages(id,chat_id,role,content,created_at) values('m9','c1c1c1c1','user','x',1)$q$), -1);
select t.expect('B may reuse the same piece id (per-user ids)', t.n($q$insert into public.items(id,type,category,created_at,updated_at) values('11111111','shoe','shoes',1,1)$q$), 1);
select t.expect('B uploads into own folder', t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','bbbbbbbb-0000-0000-0000-000000000002/11111111/front')$q$), 1);
commit;

-- A cannot hand a row to someone else, and still has exactly their own data.
begin; set local role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
select t.expect('A cannot reassign row to B', t.n($q$update public.items set user_id='bbbbbbbb-0000-0000-0000-000000000002' where id='11111111'$q$), -1);
select t.expect('A still sees only own items',  t.n('select 1 from public.items'), 1);
select t.expect('A still sees only own photos', t.n('select 1 from storage.objects'), 1);
select t.expect('A deletes own item', t.n($q$delete from public.items where id='11111111'$q$), 1);
commit;

-- The public anon key (what every visitor of the site holds) gets nothing.
begin; set local role anon;
select t.expect('anon cannot read items',    t.n('select 1 from public.items'), -1);
select t.expect('anon cannot read chats',    t.n('select 1 from public.chats'), -1);
select t.expect('anon cannot read messages', t.n('select 1 from public.chat_messages'), -1);
select t.expect('anon cannot read outfits',  t.n('select 1 from public.outfits'), -1);
select t.expect('anon cannot read profile',  t.n('select 1 from public.profile'), -1);
select t.expect('anon cannot insert item',   t.n($q$insert into public.items(id,type,category,created_at,updated_at) values('33333333','x','y',1,1)$q$), -1);
select t.expect('anon cannot delete items',  t.n('delete from public.items'), -1);
select t.expect('anon sees no photos',       t.n('select 1 from storage.objects'), 0);
select t.expect('anon cannot upload',        t.n($q$insert into storage.objects(bucket_id,name) values('wardrobe','whatever/x/front')$q$), -1);
select t.expect('anon cannot delete photos', t.n($q$delete from storage.objects$q$), 0);
commit;
select t.expect('bucket is private', (select count(*) from storage.buckets where id='wardrobe' and public = false), 1);
