-- Run once in your Supabase project SQL Editor. Per-user private storage.
create table if not exists public.manufacturer_brands (
 owner_id uuid not null references auth.users(id) on delete cascade,
 brand_id text not null check (length(brand_id) between 1 and 160),
 payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
 primary key (owner_id, brand_id)
);
alter table public.manufacturer_brands enable row level security;
revoke all on public.manufacturer_brands from anon;
revoke all on public.manufacturer_brands from authenticated;
grant select, insert, update, delete on public.manufacturer_brands to authenticated;
drop policy if exists own_brands_read on public.manufacturer_brands;
create policy own_brands_read on public.manufacturer_brands for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists own_brands_insert on public.manufacturer_brands;
create policy own_brands_insert on public.manufacturer_brands for insert to authenticated with check ((select auth.uid()) = owner_id);
drop policy if exists own_brands_update on public.manufacturer_brands;
create policy own_brands_update on public.manufacturer_brands for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists own_brands_delete on public.manufacturer_brands;
create policy own_brands_delete on public.manufacturer_brands for delete to authenticated using ((select auth.uid()) = owner_id);
