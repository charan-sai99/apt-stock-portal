-- =============================================================================
-- APT Stock Portal — 0003 production hardening
-- Apply after 0001_initial_schema.sql and 0002_entry_timestamps_and_manager_audit.sql
--
-- NON-DESTRUCTIVE: no table is dropped, no row is deleted, no column is removed.
-- What this migration DOES replace:
--   * Some RLS policies from 0001/0002 (direct client writes are removed; all
--     writes now go through validated SECURITY DEFINER functions, and customers
--     read through sanitised functions instead of raw tables).
--   * The 0002 stock-entry trigger is replaced by richer stamp + audit triggers.
-- Existing rows are kept; new columns are added with safe defaults/backfills.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Settings (factory timezone)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.app_settings(key, value)
values ('factory_timezone', 'Asia/Kolkata')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "authenticated read settings" on public.app_settings;
create policy "authenticated read settings" on public.app_settings
  for select to authenticated using (true);

create or replace function public.factory_timezone()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select value from public.app_settings where key = 'factory_timezone'), 'Asia/Kolkata') $$;

create or replace function public.factory_today()
returns date language sql stable security definer set search_path = public
as $$ select (now() at time zone public.factory_timezone())::date $$;

-- -----------------------------------------------------------------------------
-- 2. Profiles: email, operator slot (STOCK_OPERATOR_1 / STOCK_OPERATOR_2)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists operator_slot smallint;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_operator_slot_chk') then
    alter table public.profiles add constraint profiles_operator_slot_chk
      check (operator_slot is null or operator_slot in (1, 2));
  end if;
  -- NOT VALID: existing operator rows (if any) are not rejected; the admin
  -- assigns their slot from the Users page. New/updated rows are checked.
  if not exists (select 1 from pg_constraint where conname = 'profiles_operator_slot_role_chk') then
    alter table public.profiles add constraint profiles_operator_slot_role_chk
      check ((role = 'operator') = (operator_slot is not null)) not valid;
  end if;
end $$;

create unique index if not exists profiles_active_operator_slot_uidx
  on public.profiles(operator_slot) where role = 'operator' and is_active;

-- Admin user writes now go through server actions + admin_* functions (audited).
drop policy if exists "admins manage profiles" on public.profiles;

-- Readable role label used by the UI.
create or replace function public.role_label(p_role text, p_slot smallint)
returns text language sql immutable
as $$ select case
  when p_role = 'admin' then 'ADMIN'
  when p_role = 'customer' then 'CUSTOMER'
  when p_role = 'operator' and p_slot is not null then 'STOCK_OPERATOR_' || p_slot
  when p_role = 'operator' then 'STOCK_OPERATOR'
  else upper(p_role) end $$;

-- -----------------------------------------------------------------------------
-- 3. Catalogue (zoho_items)
-- -----------------------------------------------------------------------------
alter table public.zoho_items add column if not exists sku text;
alter table public.zoho_items add column if not exists description text;
alter table public.zoho_items add column if not exists include_in_stock boolean not null default true;
alter table public.zoho_items add column if not exists unit_source text;
alter table public.zoho_items add column if not exists unit_configured_by uuid references public.profiles(id);
alter table public.zoho_items add column if not exists unit_configured_at timestamptz;
alter table public.zoho_items add column if not exists zoho_last_modified_time timestamptz;
alter table public.zoho_items add column if not exists created_at timestamptz not null default now();
alter table public.zoho_items add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'zoho_items_unit_source_chk') then
    alter table public.zoho_items add constraint zoho_items_unit_source_chk
      check (unit_source is null or unit_source in ('zoho', 'admin'));
  end if;
end $$;

create index if not exists zoho_items_reportable_idx
  on public.zoho_items(product_type, zoho_status, include_in_stock);
create index if not exists zoho_items_name_idx on public.zoho_items(item_name);

-- 0001 let ANY authenticated user read the catalogue, including someone who
-- signed up without a portal profile. Require an active portal role.
drop policy if exists "authenticated users read active goods catalogue" on public.zoho_items;
drop policy if exists "portal users read active goods catalogue" on public.zoho_items;
create policy "portal users read active goods catalogue" on public.zoho_items
  for select to authenticated using (
    public.current_app_role() in ('admin', 'operator', 'customer')
    and zoho_status = 'Active' and product_type = 'goods');

-- Admins read everything (services, inactive) but write only via functions.
drop policy if exists "admins manage catalogue" on public.zoho_items;
drop policy if exists "admins read full catalogue" on public.zoho_items;
create policy "admins read full catalogue" on public.zoho_items
  for select to authenticated using (public.current_app_role() = 'admin');

create or replace function public.is_reportable(i public.zoho_items)
returns boolean language sql stable
as $$ select i.product_type = 'goods' and i.zoho_status = 'Active' and i.include_in_stock $$;

-- -----------------------------------------------------------------------------
-- 4. Daily reports
-- -----------------------------------------------------------------------------
alter table public.daily_reports add column if not exists version integer not null default 1;
alter table public.daily_reports add column if not exists last_modified_by uuid references public.profiles(id);
alter table public.daily_reports add column if not exists published_item_count integer;
alter table public.daily_reports add column if not exists amended_at timestamptz;
alter table public.daily_reports add column if not exists amended_by uuid references public.profiles(id);
alter table public.daily_reports add column if not exists amendment_count integer not null default 0;

-- Writes only via get_or_create_today_report / save_draft_entries / submit_report / amend_entry.
drop policy if exists "operators create reports" on public.daily_reports;
drop policy if exists "operators update draft reports" on public.daily_reports;
-- Customers read published data only through published_* functions (no operator identities).
drop policy if exists "customers read published reports" on public.daily_reports;

create or replace function public.capture_report_timestamps()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if new.report_date is distinct from old.report_date then
    raise exception 'The reporting date of a report cannot be changed';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'A published report cannot be returned to draft';
  end if;
  if old.status = 'draft' and new.status in ('published', 'amended') then
    new.submitted_at := now();
    new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  elsif old.status <> 'draft' then
    new.submitted_at := old.submitted_at;
    new.submitted_by := old.submitted_by;
  end if;
  return new;
end $$;

create or replace function public.prevent_published_report_delete()
returns trigger language plpgsql
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Published reports are permanent records and cannot be deleted';
  end if;
  return old;
end $$;

drop trigger if exists daily_report_no_delete on public.daily_reports;
create trigger daily_report_no_delete before delete on public.daily_reports
  for each row execute function public.prevent_published_report_delete();

-- -----------------------------------------------------------------------------
-- 5. Daily stock entries
-- -----------------------------------------------------------------------------
alter table public.daily_stock_entries add column if not exists created_at timestamptz;
alter table public.daily_stock_entries add column if not exists created_by uuid references public.profiles(id);
alter table public.daily_stock_entries add column if not exists created_by_name text;
alter table public.daily_stock_entries add column if not exists updated_by_name text;
alter table public.daily_stock_entries add column if not exists report_date date;
alter table public.daily_stock_entries add column if not exists item_name_snapshot text;
alter table public.daily_stock_entries add column if not exists part_code_snapshot text;

-- Backfill existing rows without firing audit triggers (no data is changed
-- except filling the new columns from values already stored).
alter table public.daily_stock_entries disable trigger user;
update public.daily_stock_entries e set
  created_at      = coalesce(e.created_at, e.updated_at),
  created_by      = coalesce(e.created_by, e.updated_by),
  updated_by_name = coalesce(e.updated_by_name, p.display_name),
  created_by_name = coalesce(e.created_by_name, p.display_name),
  report_date     = coalesce(e.report_date, r.report_date),
  item_name_snapshot = coalesce(e.item_name_snapshot, i.item_name),
  part_code_snapshot = coalesce(e.part_code_snapshot, i.part_code)
from public.daily_reports r, public.zoho_items i, public.profiles p
where r.id = e.report_id and i.zoho_item_id = e.zoho_item_id and p.id = e.updated_by;
alter table public.daily_stock_entries enable trigger user;

alter table public.daily_stock_entries alter column created_at set default now();
alter table public.daily_stock_entries alter column created_at set not null;

create index if not exists daily_stock_entries_item_idx on public.daily_stock_entries(zoho_item_id);
create index if not exists daily_stock_entries_report_date_idx on public.daily_stock_entries(report_date desc);

drop policy if exists "operators insert entries" on public.daily_stock_entries;
drop policy if exists "operators update entries on draft reports" on public.daily_stock_entries;
drop policy if exists "customers read entries for published reports" on public.daily_stock_entries;
-- "operators read entries" (admin + operator select) from 0001 is kept.

-- BEFORE trigger: server-generated timestamps, identities, snapshots, revision.
create or replace function public.stamp_stock_entry()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), new.updated_by);
  v_name text;
  v_report public.daily_reports;
  v_item public.zoho_items;
begin
  select * into v_report from public.daily_reports where id = new.report_id;
  if v_report.status <> 'draft'
     and coalesce(current_setting('app.operation', true), '') <> 'amendment' then
    raise exception 'Published stock records cannot be modified directly; use the amendment process';
  end if;
  select display_name into v_name from public.profiles where id = v_uid;

  if tg_op = 'INSERT' then
    select * into v_item from public.zoho_items where zoho_item_id = new.zoho_item_id;
    new.report_date := v_report.report_date;
    new.item_name_snapshot := v_item.item_name;
    new.part_code_snapshot := v_item.part_code;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := v_uid;
    new.updated_by := v_uid;
    new.created_by_name := v_name;
    new.updated_by_name := v_name;
    new.revision := 1;
  else
    new.id := old.id;
    new.report_id := old.report_id;
    new.zoho_item_id := old.zoho_item_id;
    new.report_date := old.report_date;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.item_name_snapshot := old.item_name_snapshot;
    new.part_code_snapshot := old.part_code_snapshot;
    if new.available_quantity is distinct from old.available_quantity
       or new.unit_snapshot is distinct from old.unit_snapshot then
      new.updated_at := now();
      new.updated_by := v_uid;
      new.updated_by_name := v_name;
      new.revision := old.revision + 1;
    else
      new.updated_at := old.updated_at;
      new.updated_by := old.updated_by;
      new.updated_by_name := old.updated_by_name;
      new.revision := old.revision;
    end if;
  end if;
  return new;
end $$;

-- AFTER trigger: append an audit record for every quantity change.
create or replace function public.audit_stock_entry()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_op text := nullif(current_setting('app.operation', true), '');
  v_reason text := nullif(current_setting('app.reason', true), '');
  v_uid uuid;
  v_name text;
  v_old numeric;
begin
  if tg_op = 'UPDATE' then
    if new.available_quantity is not distinct from old.available_quantity
       and new.unit_snapshot is not distinct from old.unit_snapshot then
      return null;
    end if;
    v_old := old.available_quantity;
  end if;
  v_uid := coalesce(auth.uid(), new.updated_by);
  select display_name into v_name from public.profiles where id = v_uid;

  insert into public.audit_logs(
    actor_id, actor_name, action, operation, entity_type, entity_id,
    report_id, report_date, zoho_item_id, old_quantity, new_quantity, details, created_at)
  values (
    v_uid, v_name,
    case when tg_op = 'INSERT' then 'stock_entry_created' else 'stock_entry_updated' end,
    coalesce(v_op, case when tg_op = 'INSERT' then 'draft_entry' else 'draft_update' end),
    'daily_stock_entry', new.id::text,
    new.report_id, new.report_date, new.zoho_item_id, v_old, new.available_quantity,
    jsonb_build_object('unit', new.unit_snapshot, 'revision', new.revision, 'reason', v_reason,
                       'item_name', new.item_name_snapshot),
    new.updated_at);
  return null;
end $$;

create or replace function public.prevent_entry_delete()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'Stock entries are permanent records and cannot be deleted';
end $$;

drop trigger if exists daily_stock_entry_audit on public.daily_stock_entries;   -- 0002 trigger
drop trigger if exists daily_stock_entry_stamp on public.daily_stock_entries;
drop trigger if exists daily_stock_entry_audit_after on public.daily_stock_entries;
drop trigger if exists daily_stock_entry_no_delete on public.daily_stock_entries;
create trigger daily_stock_entry_stamp before insert or update on public.daily_stock_entries
  for each row execute function public.stamp_stock_entry();
create trigger daily_stock_entry_audit_after after insert or update on public.daily_stock_entries
  for each row execute function public.audit_stock_entry();
create trigger daily_stock_entry_no_delete before delete on public.daily_stock_entries
  for each row execute function public.prevent_entry_delete();

-- -----------------------------------------------------------------------------
-- 6. Audit log: structured columns + append-only
-- -----------------------------------------------------------------------------
alter table public.audit_logs add column if not exists actor_name text;
alter table public.audit_logs add column if not exists operation text;
alter table public.audit_logs add column if not exists report_id uuid references public.daily_reports(id);
alter table public.audit_logs add column if not exists report_date date;
alter table public.audit_logs add column if not exists zoho_item_id text;
alter table public.audit_logs add column if not exists old_quantity numeric(14,3);
alter table public.audit_logs add column if not exists new_quantity numeric(14,3);

create index if not exists audit_logs_report_idx on public.audit_logs(report_id);
create index if not exists audit_logs_item_idx on public.audit_logs(zoho_item_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_operation_idx on public.audit_logs(operation);

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql
as $$ begin raise exception 'Audit records are append-only'; end $$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
drop trigger if exists audit_logs_no_truncate on public.audit_logs;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_mutation();

-- Internal helper for functions below.
create or replace function public.write_audit(
  p_action text, p_operation text, p_entity_type text, p_entity_id text,
  p_details jsonb default '{}'::jsonb, p_report_id uuid default null,
  p_report_date date default null, p_zoho_item_id text default null,
  p_old numeric default null, p_new numeric default null, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := coalesce(p_actor, auth.uid()); v_name text;
begin
  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.audit_logs(actor_id, actor_name, action, operation, entity_type, entity_id,
    details, report_id, report_date, zoho_item_id, old_quantity, new_quantity)
  values (v_uid, v_name, p_action, p_operation, p_entity_type, p_entity_id,
    coalesce(p_details, '{}'::jsonb), p_report_id, p_report_date, p_zoho_item_id, p_old, p_new);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Report amendments (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.report_amendments (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.daily_reports(id),
  report_date date not null,
  zoho_item_id text not null references public.zoho_items(zoho_item_id),
  previous_quantity numeric(14,3),
  new_quantity numeric(14,3) not null check (new_quantity >= 0),
  unit text not null,
  reason text not null check (char_length(btrim(reason)) >= 5),
  amended_by uuid not null references public.profiles(id),
  amended_by_name text,
  amended_at timestamptz not null default now()
);
create index if not exists report_amendments_report_idx on public.report_amendments(report_id);
alter table public.report_amendments enable row level security;
drop policy if exists "admins read amendments" on public.report_amendments;
create policy "admins read amendments" on public.report_amendments
  for select to authenticated using (public.current_app_role() = 'admin');
drop trigger if exists report_amendments_append_only on public.report_amendments;
create trigger report_amendments_append_only before update or delete on public.report_amendments
  for each row execute function public.prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- 8. Zoho synchronisation
-- -----------------------------------------------------------------------------
create table if not exists public.zoho_sync_runs (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('full', 'incremental', 'file_import')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_seen integer not null default 0,
  items_created integer not null default 0,
  items_updated integer not null default 0,
  error_message text,
  triggered_by uuid references public.profiles(id),
  modified_since timestamptz
);
alter table public.zoho_sync_runs enable row level security;
drop policy if exists "admins read sync runs" on public.zoho_sync_runs;
create policy "admins read sync runs" on public.zoho_sync_runs
  for select to authenticated using (public.current_app_role() = 'admin');

-- Server-only OAuth token store (no policies => only the service role can access).
create table if not exists public.zoho_oauth_tokens (
  id smallint primary key default 1 check (id = 1),
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  api_domain text,
  updated_at timestamptz not null default now()
);
alter table public.zoho_oauth_tokens enable row level security;
revoke all on table public.zoho_oauth_tokens from anon, authenticated;

create or replace function public.first_line(p text)
returns text language sql immutable
as $$ select nullif(btrim(split_part(replace(coalesce(p, ''), E'\r', ''), E'\n', 1)), '') $$;

-- Upsert Zoho items. Callable by the service role only (server-side sync).
create or replace function public.zoho_upsert_items(p_items jsonb, p_run_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  e jsonb; v_created int := 0; v_updated int := 0; v_seen int := 0; v_inserted boolean;
  v_unit text; v_type text; v_status text;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if coalesce(e->>'zoho_item_id', '') = '' or coalesce(e->>'name', '') = '' then continue; end if;
    v_seen := v_seen + 1;
    v_unit := nullif(btrim(coalesce(e->>'unit', '')), '');
    v_type := case when lower(coalesce(e->>'product_type', 'goods')) = 'service' then 'service' else 'goods' end;
    v_status := case when lower(coalesce(e->>'status', 'active')) = 'active' then 'Active' else 'Inactive' end;

    insert into public.zoho_items as z (
      zoho_item_id, item_name, description, part_code, sku, unit, unit_source, unit_needs_review,
      product_type, zoho_status, include_in_stock, zoho_last_modified_time, synced_at, updated_at)
    values (
      e->>'zoho_item_id', btrim(e->>'name'), e->>'description', public.first_line(e->>'description'),
      nullif(btrim(coalesce(e->>'sku', '')), ''), v_unit,
      case when v_unit is null then null else 'zoho' end, v_unit is null,
      v_type, v_status, v_type = 'goods',
      nullif(e->>'last_modified_time', '')::timestamptz, now(), now())
    on conflict (zoho_item_id) do update set
      item_name = excluded.item_name,
      description = excluded.description,
      part_code = excluded.part_code,
      sku = excluded.sku,
      -- Zoho is master for units when it has one; an empty Zoho unit never
      -- erases a unit that an admin configured.
      unit = coalesce(excluded.unit, z.unit),
      unit_source = case when excluded.unit is not null then 'zoho' else z.unit_source end,
      unit_needs_review = coalesce(excluded.unit, z.unit) is null,
      product_type = excluded.product_type,
      zoho_status = excluded.zoho_status,
      zoho_last_modified_time = coalesce(excluded.zoho_last_modified_time, z.zoho_last_modified_time),
      synced_at = now(),
      updated_at = now()
    returning (xmax = 0) into v_inserted;
    if v_inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
  end loop;

  if p_run_id is not null then
    update public.zoho_sync_runs
      set items_seen = items_seen + v_seen, items_created = items_created + v_created,
          items_updated = items_updated + v_updated
      where id = p_run_id;
  end if;
  return jsonb_build_object('seen', v_seen, 'created', v_created, 'updated', v_updated);
end $$;

-- -----------------------------------------------------------------------------
-- 9. Application functions (RPC). All SECURITY DEFINER with explicit role checks.
-- -----------------------------------------------------------------------------
create or replace function public.require_role(variadic p_roles text[])
returns uuid language plpgsql stable security definer set search_path = public
as $$
declare v_role text := public.current_app_role();
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_role is null or not (v_role = any(p_roles)) then
    raise exception 'You do not have permission to perform this action' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Session info for the UI.
create or replace function public.my_profile()
returns table (id uuid, display_name text, email text, role text, operator_slot smallint,
               role_label text, is_active boolean)
language sql stable security definer set search_path = public
as $$
  select p.id, p.display_name, p.email, p.role, p.operator_slot,
         public.role_label(p.role, p.operator_slot), p.is_active
  from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.portal_summary()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_latest record;
begin
  perform public.require_role('admin', 'operator', 'customer');
  select report_date, submitted_at, amended_at into v_latest
    from public.daily_reports where status in ('published', 'amended')
    order by report_date desc limit 1;
  return jsonb_build_object(
    'factory_timezone', public.factory_timezone(),
    'factory_today', public.factory_today(),
    'reportable_items', (select count(*) from public.zoho_items i where public.is_reportable(i)),
    'items_missing_unit', (select count(*) from public.zoho_items i
                           where public.is_reportable(i) and (i.unit is null or i.unit_needs_review)),
    'latest_published_date', v_latest.report_date,
    'latest_published_at', v_latest.submitted_at,
    'latest_amended_at', v_latest.amended_at);
end $$;

create or replace function public.get_or_create_today_report()
returns public.daily_reports language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin', 'operator'); v_date date := public.factory_today();
        r public.daily_reports;
begin
  insert into public.daily_reports(report_date, created_by, status, last_modified_by)
  values (v_date, v_uid, 'draft', v_uid)
  on conflict (report_date) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.daily_reports where report_date = v_date;
  else
    perform public.write_audit('report_created', 'report_created', 'daily_report', r.id::text,
      jsonb_build_object('report_date', v_date), r.id, v_date);
  end if;
  return r;
end $$;

-- Parse a JSON quantity strictly. Returns null and sets p_error on invalid input.
create or replace function public.parse_quantity(p_raw jsonb, out quantity numeric, out error text)
language plpgsql immutable
as $$
declare v_txt text;
begin
  if p_raw is null or jsonb_typeof(p_raw) = 'null' then
    error := 'A quantity is required (enter 0 for no stock)'; return;
  end if;
  if jsonb_typeof(p_raw) not in ('number', 'string') then
    error := 'Quantity must be a number'; return;
  end if;
  v_txt := btrim(p_raw #>> '{}');
  if v_txt ~ '^-' then error := 'Quantity cannot be negative'; return; end if;
  if v_txt !~ '^[0-9]+(\.[0-9]+)?$' then error := 'Quantity must be a valid number'; return; end if;
  quantity := v_txt::numeric;
  if quantity <> round(quantity, 3) then
    quantity := null; error := 'Quantity can have at most 3 decimal places'; return;
  end if;
  if quantity > 99999999999 then
    quantity := null; error := 'Quantity is too large'; return;
  end if;
end $$;

-- Save draft quantities with optimistic concurrency.
-- p_entries: [{ "zoho_item_id": "...", "quantity": 12, "expected_revision": 0 }]
--   expected_revision = revision the client last saw (0 = no saved value yet).
-- Rows whose revision changed are NOT written; they are returned as conflicts.
create or replace function public.save_draft_entries(p_report_id uuid, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_role text := public.current_app_role();
  r public.daily_reports;
  e jsonb;
  v_item public.zoho_items;
  v_existing public.daily_stock_entries;
  v_parsed record;
  v_expected int;
  v_saved int := 0;
  v_conflicts jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Entries must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 2000 then
    raise exception 'Too many entries in one request' using errcode = '22023';
  end if;

  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status <> 'draft' then
    raise exception 'The report for % has already been published and can no longer be edited', r.report_date
      using errcode = 'P0001';
  end if;
  if v_role = 'operator' and r.report_date <> public.factory_today() then
    raise exception 'Operators can only edit the report for today (%)', public.factory_today()
      using errcode = 'P0001';
  end if;

  for e in select * from jsonb_array_elements(p_entries) loop
    select * into v_item from public.zoho_items where zoho_item_id = e->>'zoho_item_id';
    if not found or not public.is_reportable(v_item) then
      v_errors := v_errors || jsonb_build_object('zoho_item_id', e->>'zoho_item_id',
        'error', 'Item is not part of the stock-reporting catalogue');
      continue;
    end if;
    if v_item.unit is null or v_item.unit_needs_review then
      v_errors := v_errors || jsonb_build_object('zoho_item_id', v_item.zoho_item_id,
        'error', 'Unit not configured; an administrator must set the unit first');
      continue;
    end if;
    select * into v_parsed from public.parse_quantity(e->'quantity');
    if v_parsed.error is not null then
      v_errors := v_errors || jsonb_build_object('zoho_item_id', v_item.zoho_item_id, 'error', v_parsed.error);
      continue;
    end if;
    begin
      v_expected := coalesce((e->>'expected_revision')::int, 0);
    exception when others then v_expected := -1;
    end;

    select * into v_existing from public.daily_stock_entries
      where report_id = r.id and zoho_item_id = v_item.zoho_item_id for update;
    if found then
      if v_existing.revision <> v_expected then
        v_conflicts := v_conflicts || jsonb_build_object(
          'zoho_item_id', v_item.zoho_item_id, 'current_quantity', v_existing.available_quantity,
          'current_revision', v_existing.revision, 'updated_by_name', v_existing.updated_by_name,
          'updated_at', v_existing.updated_at, 'your_quantity', v_parsed.quantity);
        continue;
      end if;
      if v_parsed.quantity is distinct from v_existing.available_quantity then
        update public.daily_stock_entries
          set available_quantity = v_parsed.quantity, unit_snapshot = v_item.unit, updated_by = v_uid
          where id = v_existing.id;
        v_saved := v_saved + 1;
      end if;
    else
      if v_expected <> 0 then
        v_conflicts := v_conflicts || jsonb_build_object('zoho_item_id', v_item.zoho_item_id,
          'current_quantity', null, 'current_revision', 0, 'your_quantity', v_parsed.quantity);
        continue;
      end if;
      insert into public.daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
      values (r.id, v_item.zoho_item_id, v_parsed.quantity, v_item.unit, v_uid);
      v_saved := v_saved + 1;
    end if;
  end loop;

  if v_saved > 0 then
    update public.daily_reports set version = version + 1, last_modified_by = v_uid
      where id = r.id returning * into r;
  end if;

  return jsonb_build_object(
    'saved', v_saved, 'conflicts', v_conflicts, 'errors', v_errors, 'report_version', r.version,
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
        'zoho_item_id', s.zoho_item_id, 'available_quantity', s.available_quantity,
        'revision', s.revision, 'updated_at', s.updated_at, 'updated_by_name', s.updated_by_name))
      from public.daily_stock_entries s where s.report_id = r.id), '[]'::jsonb));
end $$;

-- Publish a complete report (transactional; row-locked; version-checked).
create or replace function public.submit_report(p_report_id uuid, p_expected_version integer)
returns public.daily_reports language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_role text := public.current_app_role();
  r public.daily_reports;
  v_no_unit int; v_missing int; v_count int;
begin
  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status <> 'draft' then
    raise exception 'The official report for % has already been published', r.report_date using errcode = 'P0001';
  end if;
  if v_role = 'operator' and r.report_date <> public.factory_today() then
    raise exception 'Operators can only submit the report for today (%)', public.factory_today() using errcode = 'P0001';
  end if;
  if r.version <> p_expected_version then
    raise exception 'The report was changed by another user since you loaded it. Reload and review before submitting.'
      using errcode = '40001';
  end if;

  select count(*) into v_no_unit from public.zoho_items i
    where public.is_reportable(i) and (i.unit is null or i.unit_needs_review);
  if v_no_unit > 0 then
    raise exception 'Cannot publish: % catalogue item(s) have no unit configured. An administrator must set them first.', v_no_unit
      using errcode = 'P0001';
  end if;

  select count(*) into v_missing from public.zoho_items i
    where public.is_reportable(i)
      and not exists (select 1 from public.daily_stock_entries e
                      where e.report_id = r.id and e.zoho_item_id = i.zoho_item_id);
  if v_missing > 0 then
    raise exception 'Cannot publish an incomplete report: % item(s) have no saved quantity.', v_missing
      using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.daily_stock_entries where report_id = r.id;
  update public.daily_reports
    set status = 'published', submitted_by = v_uid, submitted_at = now(),
        version = version + 1, last_modified_by = v_uid, published_item_count = v_count
    where id = r.id returning * into r;

  perform public.write_audit('report_published', 'report_published', 'daily_report', r.id::text,
    jsonb_build_object('report_date', r.report_date, 'item_count', v_count), r.id, r.report_date);
  return r;
end $$;

-- Admin correction of a published report (auditable amendment).
create or replace function public.amend_entry(p_report_id uuid, p_zoho_item_id text,
                                              p_new_quantity numeric, p_reason text)
returns public.daily_stock_entries language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin');
  r public.daily_reports;
  v_item public.zoho_items;
  v_entry public.daily_stock_entries;
  v_prev numeric;
  v_parsed record;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'A reason of at least 5 characters is required for an amendment' using errcode = 'P0001';
  end if;
  select * into v_parsed from public.parse_quantity(to_jsonb(p_new_quantity));
  if v_parsed.error is not null then raise exception '%', v_parsed.error using errcode = 'P0001'; end if;

  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status not in ('published', 'amended') then
    raise exception 'Only published reports can be amended; edit drafts normally' using errcode = 'P0001';
  end if;
  select * into v_item from public.zoho_items where zoho_item_id = p_zoho_item_id;
  if not found then raise exception 'Unknown item' using errcode = 'P0002'; end if;

  perform set_config('app.operation', 'amendment', true);
  perform set_config('app.reason', btrim(p_reason), true);

  select * into v_entry from public.daily_stock_entries
    where report_id = r.id and zoho_item_id = p_zoho_item_id for update;
  if found then
    v_prev := v_entry.available_quantity;
    if v_prev = v_parsed.quantity then
      raise exception 'The new quantity is the same as the recorded quantity' using errcode = 'P0001';
    end if;
    update public.daily_stock_entries set available_quantity = v_parsed.quantity, updated_by = v_uid
      where id = v_entry.id returning * into v_entry;
  else
    if v_item.unit is null then raise exception 'Item has no unit configured' using errcode = 'P0001'; end if;
    insert into public.daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
      values (r.id, p_zoho_item_id, v_parsed.quantity, v_item.unit, v_uid) returning * into v_entry;
  end if;

  insert into public.report_amendments(report_id, report_date, zoho_item_id, previous_quantity, new_quantity,
                                       unit, reason, amended_by, amended_by_name)
  values (r.id, r.report_date, p_zoho_item_id, v_prev, v_parsed.quantity, v_entry.unit_snapshot, btrim(p_reason),
          v_uid, (select display_name from public.profiles where id = v_uid));

  update public.daily_reports
    set status = 'amended', amended_at = now(), amended_by = v_uid,
        amendment_count = amendment_count + 1, version = version + 1, last_modified_by = v_uid,
        published_item_count = (select count(*) from public.daily_stock_entries where report_id = r.id)
    where id = r.id;

  perform set_config('app.operation', '', true);
  perform set_config('app.reason', '', true);
  return v_entry;
end $$;

-- Catalogue administration.
create or replace function public.admin_set_item_unit(p_zoho_item_id text, p_unit text)
returns public.zoho_items language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_item public.zoho_items; v_old text;
        v_unit text := btrim(coalesce(p_unit, ''));
begin
  if v_unit = '' or char_length(v_unit) > 20 then
    raise exception 'Unit must be 1–20 characters' using errcode = 'P0001';
  end if;
  select unit into v_old from public.zoho_items where zoho_item_id = p_zoho_item_id for update;
  if not found then raise exception 'Unknown item' using errcode = 'P0002'; end if;
  update public.zoho_items set unit = v_unit, unit_needs_review = false, unit_source = 'admin',
         unit_configured_by = v_uid, unit_configured_at = now(), updated_at = now()
    where zoho_item_id = p_zoho_item_id returning * into v_item;
  perform public.write_audit('item_unit_configured', 'unit_configured', 'zoho_item', p_zoho_item_id,
    jsonb_build_object('previous_unit', v_old, 'new_unit', v_unit, 'item_name', v_item.item_name),
    null, null, p_zoho_item_id);
  return v_item;
end $$;

create or replace function public.admin_set_item_inclusion(p_zoho_item_id text, p_include boolean)
returns public.zoho_items language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_item public.zoho_items;
begin
  update public.zoho_items set include_in_stock = p_include, updated_at = now()
    where zoho_item_id = p_zoho_item_id returning * into v_item;
  if v_item.zoho_item_id is null then raise exception 'Unknown item' using errcode = 'P0002'; end if;
  perform public.write_audit('item_inclusion_changed', 'catalogue_change', 'zoho_item', p_zoho_item_id,
    jsonb_build_object('include_in_stock', p_include, 'item_name', v_item.item_name), null, null, p_zoho_item_id);
  return v_item;
end $$;

-- User administration (auth user itself is created server-side with the service role).
create or replace function public.admin_upsert_profile(p_user_id uuid, p_display_name text, p_role text,
                                                       p_operator_slot smallint, p_is_active boolean)
returns public.profiles language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_old public.profiles; v_new public.profiles; v_email text;
begin
  if p_role not in ('admin', 'operator', 'customer') then raise exception 'Invalid role' using errcode = 'P0001'; end if;
  if p_role = 'operator' and p_operator_slot not in (1, 2) then
    raise exception 'Operators must be assigned slot 1 or 2' using errcode = 'P0001';
  end if;
  if p_role <> 'operator' then p_operator_slot := null; end if;
  if char_length(btrim(coalesce(p_display_name, ''))) < 2 then
    raise exception 'Display name is required' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid and (p_role <> 'admin' or not p_is_active) then
    raise exception 'You cannot remove your own administrator access' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if not found then raise exception 'Auth user not found' using errcode = 'P0002'; end if;
  if p_role = 'operator' and p_is_active and exists (
      select 1 from public.profiles where role = 'operator' and is_active
        and operator_slot = p_operator_slot and id <> p_user_id) then
    raise exception 'Operator slot % is already assigned to another active operator', p_operator_slot
      using errcode = 'P0001';
  end if;

  select * into v_old from public.profiles where id = p_user_id;
  insert into public.profiles(id, display_name, role, operator_slot, is_active, email)
  values (p_user_id, btrim(p_display_name), p_role, p_operator_slot, p_is_active, v_email)
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role,
    operator_slot = excluded.operator_slot, is_active = excluded.is_active, email = excluded.email,
    updated_at = now()
  returning * into v_new;

  perform public.write_audit(case when v_old.id is null then 'user_created' else 'user_updated' end,
    'user_admin', 'profile', p_user_id::text,
    jsonb_build_object('email', v_email,
      'previous', case when v_old.id is null then null else jsonb_build_object(
        'display_name', v_old.display_name, 'role', public.role_label(v_old.role, v_old.operator_slot),
        'is_active', v_old.is_active) end,
      'new', jsonb_build_object('display_name', v_new.display_name,
        'role', public.role_label(v_new.role, v_new.operator_slot), 'is_active', v_new.is_active)));
  return v_new;
end $$;

-- Customer-safe read functions (no operator identities, published data only).
create or replace function public.published_reports(p_limit integer default 120)
returns table (report_id uuid, report_date date, status text, submitted_at timestamptz,
               amended_at timestamptz, item_count integer, amendment_count integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select r.id, r.report_date, r.status, r.submitted_at, r.amended_at,
           coalesce(r.published_item_count, 0), r.amendment_count
    from public.daily_reports r
    where r.status in ('published', 'amended')
    order by r.report_date desc
    limit least(greatest(coalesce(p_limit, 120), 1), 1000);
end $$;

create or replace function public.published_report_stock(p_report_date date)
returns table (zoho_item_id text, item_name text, part_code text, sku text, description text,
               unit text, available_quantity numeric, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select e.zoho_item_id, coalesce(e.item_name_snapshot, i.item_name), coalesce(e.part_code_snapshot, i.part_code),
           i.sku, i.description, e.unit_snapshot, e.available_quantity, e.updated_at
    from public.daily_reports r
    join public.daily_stock_entries e on e.report_id = r.id
    left join public.zoho_items i on i.zoho_item_id = e.zoho_item_id
    where r.report_date = p_report_date and r.status in ('published', 'amended')
    order by 2;
end $$;

create or replace function public.published_item_history(p_zoho_item_id text, p_limit integer default 30)
returns table (report_date date, available_quantity numeric, unit text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select r.report_date, e.available_quantity, e.unit_snapshot, e.updated_at
    from public.daily_stock_entries e
    join public.daily_reports r on r.id = e.report_id
    where e.zoho_item_id = p_zoho_item_id and r.status in ('published', 'amended')
    order by r.report_date desc
    limit least(greatest(coalesce(p_limit, 30), 1), 366);
end $$;

-- -----------------------------------------------------------------------------
-- 10. Function privileges
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Callable by signed-in users (each function checks the role itself).
  foreach f in array array[
    'public.my_profile()', 'public.portal_summary()', 'public.get_or_create_today_report()',
    'public.save_draft_entries(uuid, jsonb)', 'public.submit_report(uuid, integer)',
    'public.amend_entry(uuid, text, numeric, text)', 'public.admin_set_item_unit(text, text)',
    'public.admin_set_item_inclusion(text, boolean)',
    'public.admin_upsert_profile(uuid, text, text, smallint, boolean)',
    'public.published_reports(integer)', 'public.published_report_stock(date)',
    'public.published_item_history(text, integer)', 'public.factory_today()', 'public.factory_timezone()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Internal / server-only.
  foreach f in array array[
    'public.zoho_upsert_items(jsonb, bigint)',
    'public.write_audit(text, text, text, text, jsonb, uuid, date, text, numeric, numeric, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
