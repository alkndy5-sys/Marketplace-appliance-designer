-- Shared company library: public read and insert only. Existing owner update/delete policies stay intact.
begin;
grant select, insert on public.manufacturer_brands to anon;
grant select, insert on public.manufacturer_brands to authenticated;
drop policy if exists shared_brands_read on public.manufacturer_brands;
create policy shared_brands_read on public.manufacturer_brands for select to anon, authenticated
using (owner_id = 'bb6317cb-448d-4abc-9bdd-7c09cb474a6f'::uuid);
drop policy if exists shared_brands_add on public.manufacturer_brands;
create policy shared_brands_add on public.manufacturer_brands for insert to anon, authenticated
with check (owner_id = 'bb6317cb-448d-4abc-9bdd-7c09cb474a6f'::uuid
and payload->>'id' = brand_id
and length(trim(payload->>'name')) between 1 and 150
and coalesce(length(payload->>'logoUrl'),0) <= 1500000
and payload->>'mode' in ('img','text'));
commit;
