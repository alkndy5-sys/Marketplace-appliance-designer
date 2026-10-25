-- Additive analytics migration. Raw identifiers are never publicly readable.
begin;
create table if not exists public.site_visitors (
 id uuid primary key, first_seen timestamptz not null default now(), last_seen timestamptz not null default now()
);
create table if not exists public.site_sessions (
 id uuid primary key, visitor_id uuid not null references public.site_visitors(id), last_seen timestamptz not null default now(), visible boolean not null default true
);
create index if not exists site_sessions_seen_idx on public.site_sessions(last_seen);
create table if not exists public.site_visitor_days (
 visitor_id uuid not null references public.site_visitors(id), day date not null, primary key(visitor_id,day)
);
create table if not exists public.site_generated_images (
 event_id uuid primary key, product_hash text not null check(product_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now()
);
create index if not exists site_generated_images_time_idx on public.site_generated_images(created_at);
create table if not exists public.site_analytics_config (id boolean primary key default true check(id), started_at timestamptz not null default now());
insert into public.site_analytics_config(id) values(true) on conflict do nothing;
alter table public.site_visitors enable row level security;
alter table public.site_sessions enable row level security;
alter table public.site_visitor_days enable row level security;
alter table public.site_generated_images enable row level security;
alter table public.site_analytics_config enable row level security;
revoke all on public.site_visitors,public.site_sessions,public.site_visitor_days,public.site_generated_images,public.site_analytics_config from anon,authenticated;
create or replace function public.site_analytics_heartbeat(p_visitor uuid,p_session uuid,p_visible boolean)
returns void language plpgsql security definer set search_path = pg_catalog,public as $$
begin
 if p_visitor is null or p_session is null then raise exception 'Invalid identifier'; end if;
 insert into public.site_visitors(id) values(p_visitor) on conflict(id) do update set last_seen=now();
 insert into public.site_sessions(id,visitor_id,visible) values(p_session,p_visitor,coalesce(p_visible,false))
 on conflict(id) do update set last_seen=now(),visible=excluded.visible where site_sessions.visitor_id=excluded.visitor_id;
 insert into public.site_visitor_days(visitor_id,day) values(p_visitor,(now() at time zone 'Asia/Riyadh')::date) on conflict do nothing;
 delete from public.site_sessions where last_seen < now()-interval '7 days';
end $$;
create or replace function public.site_analytics_export(p_event uuid,p_product_hash text)
returns void language plpgsql security definer set search_path = pg_catalog,public as $$
begin
 if p_event is null or p_product_hash is null or p_product_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid event'; end if;
 insert into public.site_generated_images(event_id,product_hash) values(p_event,p_product_hash) on conflict do nothing;
end $$;
create or replace function public.site_analytics_summary()
returns jsonb language sql security definer set search_path = pg_catalog,public as $$
 select jsonb_build_object(
 'started_at',(select started_at from public.site_analytics_config where id=true),
 'measured_at',now(),
 'online',(select count(distinct visitor_id) from public.site_sessions where last_seen>now()-interval '120 seconds'),
 'active',(select count(distinct visitor_id) from public.site_sessions where visible and last_seen>now()-interval '120 seconds'),
 'visitors',(select count(*) from public.site_visitors),
 'returning',(select count(*) from (select visitor_id from public.site_visitor_days group by visitor_id having count(*)>1) t),
 'today',(select count(*) from public.site_visitor_days where day=(now() at time zone 'Asia/Riyadh')::date),
 'generated_images',(select count(*) from public.site_generated_images),
 'products',(select count(distinct product_hash) from public.site_generated_images),
 'companies',(select count(*) from public.manufacturer_brands where owner_id='bb6317cb-448d-4abc-9bdd-7c09cb474a6f'::uuid),
 'company_logos',(select count(*) from public.manufacturer_brands where owner_id='bb6317cb-448d-4abc-9bdd-7c09cb474a6f'::uuid and coalesce(payload->>'logoUrl','')<>''),
 'database_bytes',pg_database_size(current_database()),
 'company_bytes',pg_total_relation_size('public.manufacturer_brands'),
 'daily',(select jsonb_agg(jsonb_build_object('day',d.day,'visitors',(select count(*) from public.site_visitor_days v where v.day=d.day),'images',(select count(*) from public.site_generated_images e where (e.created_at at time zone 'Asia/Riyadh')::date=d.day)) order by d.day) from (select generate_series((now() at time zone 'Asia/Riyadh')::date-13,(now() at time zone 'Asia/Riyadh')::date,interval '1 day')::date as day) d)
 )
$$;
revoke all on function public.site_analytics_heartbeat(uuid,uuid,boolean), public.site_analytics_export(uuid,text), public.site_analytics_summary() from public;
grant execute on function public.site_analytics_heartbeat(uuid,uuid,boolean), public.site_analytics_export(uuid,text), public.site_analytics_summary() to anon,authenticated;
commit;
