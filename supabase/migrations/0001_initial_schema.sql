-- APT Stock Portal — initial schema
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin','operator','customer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.zoho_items (
  zoho_item_id text primary key,
  item_name text not null,
  part_code text,
  unit text,
  unit_needs_review boolean not null default false,
  product_type text not null default 'goods',
  zoho_status text not null default 'Active',
  synced_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  status text not null default 'draft' check (status in ('draft','published','amended')),
  created_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_stock_entries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  zoho_item_id text not null references public.zoho_items(zoho_item_id),
  available_quantity numeric(14,3) not null check (available_quantity >= 0),
  unit_snapshot text not null,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique(report_id, zoho_item_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists daily_reports_date_idx on public.daily_reports(report_date desc);
create index if not exists daily_stock_entries_report_idx on public.daily_stock_entries(report_id);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

alter table public.profiles enable row level security;
alter table public.zoho_items enable row level security;
alter table public.daily_reports enable row level security;
alter table public.daily_stock_entries enable row level security;
alter table public.audit_logs enable row level security;

-- Helper function avoids recursive profile policies.
create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active = true $$;

create policy "users can read own profile" on public.profiles
for select to authenticated using (id = auth.uid() or public.current_app_role() = 'admin');

create policy "admins manage profiles" on public.profiles
for all to authenticated using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create policy "authenticated users read active goods catalogue" on public.zoho_items
for select to authenticated using (zoho_status = 'Active' and product_type = 'goods');

create policy "admins manage catalogue" on public.zoho_items
for all to authenticated using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create policy "operators and admins read reports" on public.daily_reports
for select to authenticated using (public.current_app_role() in ('admin','operator'));

create policy "customers read published reports" on public.daily_reports
for select to authenticated using (
  public.current_app_role() = 'customer' and status in ('published','amended')
);

create policy "operators create reports" on public.daily_reports
for insert to authenticated with check (
  public.current_app_role() in ('admin','operator') and created_by = auth.uid()
);

create policy "operators update draft reports" on public.daily_reports
for update to authenticated using (
  public.current_app_role() in ('admin','operator') and status = 'draft'
) with check (public.current_app_role() in ('admin','operator'));

create policy "operators read entries" on public.daily_stock_entries
for select to authenticated using (public.current_app_role() in ('admin','operator'));

create policy "customers read entries for published reports" on public.daily_stock_entries
for select to authenticated using (
  public.current_app_role() = 'customer' and exists (
    select 1 from public.daily_reports r
    where r.id = report_id and r.status in ('published','amended')
  )
);

create policy "operators insert entries" on public.daily_stock_entries
for insert to authenticated with check (
  public.current_app_role() in ('admin','operator') and updated_by = auth.uid()
);

create policy "operators update entries on draft reports" on public.daily_stock_entries
for update to authenticated using (
  public.current_app_role() in ('admin','operator') and exists (
    select 1 from public.daily_reports r where r.id = report_id and r.status = 'draft'
  )
) with check (public.current_app_role() in ('admin','operator'));

create policy "admins read audit logs" on public.audit_logs
for select to authenticated using (public.current_app_role() = 'admin');

-- Production hardening still required before launch:
-- 1) Create only the two operator accounts and named customer account(s).
-- 2) Add a server-side publish RPC that validates exactly one entry per active goods item
--    and rejects any item whose unit_needs_review flag is true.
-- 3) Enforce optimistic concurrency with revision checks in that RPC.
-- 4) Add append-only audit triggers for report/entry changes.
-- 5) Keep the Supabase service-role key and Zoho OAuth credentials server-side only.
