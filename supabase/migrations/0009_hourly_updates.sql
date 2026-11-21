-- =============================================================================
-- APT Stock Portal — 0009 hourly stock updates
-- Decision (owner, 21 Nov 2026):
--   * Stock is published as hourly UPDATES instead of one report per day.
--     The admin sets the entry hours (opens / closes) and the interval.
--   * Each update is one row in daily_reports, identified by (report_date, slot_hour).
--   * Operators can only edit/publish the update whose time window is open now.
--   * A new update starts with the quantities of the latest PUBLISHED update of the
--     SAME day carried forward (with their original "last changed" time). The first
--     update of a day starts empty, so yesterday's stock is never shown as today's.
-- NON-DESTRUCTIVE: adds columns/settings/functions; replaces the one-report-per-date
-- unique constraint by (report_date, slot_hour). Existing reports keep their data.
-- =============================================================================

-- 1. Settings ----------------------------------------------------------------
insert into public.app_settings(key, value) values
  ('entry_open_hour', '8'), ('entry_close_hour', '20'), ('entry_interval_hours', '1')
on conflict (key) do nothing;

create or replace function public.setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public
as $$ select coalesce((select nullif(value, '')::int from public.app_settings where key = p_key), p_default) $$;

-- 2. Reports become hourly updates --------------------------------------------
alter table public.daily_reports add column if not exists slot_hour smallint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'daily_reports_slot_hour_chk') then
    alter table public.daily_reports add constraint daily_reports_slot_hour_chk check (slot_hour between 0 and 23);
  end if;
end $$;

-- existing reports: slot = hour (factory time) they were published/created — first run only
do $$ begin
  if to_regclass('public.daily_reports_date_slot_uidx') is null then
    alter table public.daily_reports disable trigger user;
    update public.daily_reports
       set slot_hour = extract(hour from (coalesce(submitted_at, created_at) at time zone public.factory_timezone()))::smallint;
    alter table public.daily_reports enable trigger user;
  end if;
end $$;

do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.daily_reports'::regclass and con.contype = 'u'
      and array_length(con.conkey, 1) = 1
      and con.conkey[1] = (select attnum from pg_attribute where attrelid = 'public.daily_reports'::regclass and attname = 'report_date')
  loop
    execute format('alter table public.daily_reports drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists daily_reports_date_slot_uidx on public.daily_reports(report_date, slot_hour);

-- 3. Entries: carry-forward bookkeeping -----------------------------------------
alter table public.daily_stock_entries add column if not exists carried_from_report_id uuid;
alter table public.daily_stock_entries add column if not exists value_updated_at timestamptz;
alter table public.daily_stock_entries add column if not exists value_updated_by_name text;
alter table public.daily_stock_entries disable trigger user;
update public.daily_stock_entries set value_updated_at = updated_at, value_updated_by_name = updated_by_name
 where value_updated_at is null;
alter table public.daily_stock_entries enable trigger user;

-- 4. Current update window --------------------------------------------------------
create or replace function public.current_update_slot()
returns table (report_date date, slot_hour smallint, closes_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz text := public.factory_timezone();
  v_local timestamp := now() at time zone v_tz;
  v_open int := public.setting_int('entry_open_hour', 8);
  v_close int := public.setting_int('entry_close_hour', 20);
  v_int int := greatest(public.setting_int('entry_interval_hours', 1), 1);
  v_h int := extract(hour from v_local)::int;
  v_slot int; v_end int;
begin
  if v_h < v_open or v_h >= v_close then return; end if;
  v_slot := v_open + ((v_h - v_open) / v_int) * v_int;
  v_end := least(v_slot + v_int, v_close);
  report_date := v_local::date;
  slot_hour := v_slot;
  closes_at := (v_local::date + make_interval(hours => v_end)) at time zone v_tz;
  return next;
end $$;

create or replace function public.is_current_update(r public.daily_reports)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.current_update_slot() c
                     where c.report_date = r.report_date and c.slot_hour = r.slot_hour) $$;

create or replace function public.current_update_label()
returns text language sql stable security definer set search_path = public
as $$ select coalesce((select lpad(slot_hour::text, 2, '0') || ':00' from public.current_update_slot()), 'entry closed') $$;

-- 5. Stamp + audit triggers (carry-forward aware) ---------------------------------
create or replace function public.stamp_stock_entry()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), new.updated_by);
  v_name text;
  v_report public.daily_reports;
  v_item public.zoho_items;
  v_op text := coalesce(current_setting('app.operation', true), '');
begin
  select * into v_report from public.daily_reports where id = new.report_id;
  if v_report.status <> 'draft' and v_op <> 'amendment' then
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
    if v_op = 'carry_forward' then
      new.value_updated_at := coalesce(new.value_updated_at, now());
    else
      new.carried_from_report_id := null;
      new.value_updated_at := now();
      new.value_updated_by_name := v_name;
    end if;
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
      new.value_updated_at := now();
      new.value_updated_by_name := v_name;
      new.carried_from_report_id := null;
    else
      new.updated_at := old.updated_at;
      new.updated_by := old.updated_by;
      new.updated_by_name := old.updated_by_name;
      new.revision := old.revision;
      new.value_updated_at := old.value_updated_at;
      new.value_updated_by_name := old.value_updated_by_name;
      new.carried_from_report_id := old.carried_from_report_id;
    end if;
  end if;
  return new;
end $$;

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
  if tg_op = 'INSERT' and v_op = 'carry_forward' then
    return null;  -- one summary line is written per new update instead
  end if;
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
                       'item_name', new.item_name_snapshot,
                       'slot', (select slot_hour from public.daily_reports where id = new.report_id)),
    new.updated_at);
  return null;
end $$;

-- 6. Create an update (internal) and get the current one (RPC) ---------------------
create or replace function public.ensure_update(p_date date, p_slot smallint, p_actor uuid)
returns public.daily_reports language plpgsql security definer set search_path = public
as $$
declare r public.daily_reports; v_src public.daily_reports; v_n int := 0;
begin
  insert into public.daily_reports(report_date, slot_hour, created_by, status, last_modified_by)
  values (p_date, p_slot, p_actor, 'draft', p_actor)
  on conflict (report_date, slot_hour) do nothing
  returning * into r;
  if r.id is null then
    select * into r from public.daily_reports where report_date = p_date and slot_hour = p_slot;
    return r;
  end if;

  select * into v_src from public.daily_reports
   where report_date = p_date and slot_hour < p_slot and status in ('published', 'amended')
   order by slot_hour desc limit 1;
  if v_src.id is not null then
    perform set_config('app.operation', 'carry_forward', true);
    insert into public.daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by,
                                           carried_from_report_id, value_updated_at, value_updated_by_name)
    select r.id, e.zoho_item_id, e.available_quantity, e.unit_snapshot, p_actor, v_src.id,
           coalesce(e.value_updated_at, e.updated_at), coalesce(e.value_updated_by_name, e.updated_by_name)
      from public.daily_stock_entries e
      join public.zoho_items i on i.zoho_item_id = e.zoho_item_id
     where e.report_id = v_src.id and public.is_reportable(i);
    get diagnostics v_n = row_count;
    perform set_config('app.operation', '', true);
  end if;

  perform public.write_audit('report_created', 'report_created', 'daily_report', r.id::text,
    jsonb_build_object('report_date', p_date, 'slot', p_slot, 'carried_forward', v_n, 'carried_from_slot', v_src.slot_hour),
    r.id, p_date, null, null, null, p_actor);
  return r;
end $$;

create or replace function public.get_or_create_today_report()
returns public.daily_reports language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin', 'operator'); c record;
begin
  select * into c from public.current_update_slot();
  if not found then
    raise exception 'Stock entry is closed now. Entry hours are %:00–%:00 factory time.',
      lpad(public.setting_int('entry_open_hour', 8)::text, 2, '0'), lpad(public.setting_int('entry_close_hour', 20)::text, 2, '0')
      using errcode = 'P0001';
  end if;
  return public.ensure_update(c.report_date, c.slot_hour, v_uid);
end $$;

-- 7. Operator functions restricted to the current update --------------------------
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
  if v_role = 'operator' and not public.is_current_update(r) then
    raise exception 'This update is closed. Operators can only edit the current update (%).', public.current_update_label()
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
        'revision', s.revision, 'updated_at', s.updated_at, 'updated_by_name', s.updated_by_name,
        'value_updated_at', s.value_updated_at, 'value_updated_by_name', s.value_updated_by_name,
        'carried', s.carried_from_report_id is not null))
      from public.daily_stock_entries s where s.report_id = r.id), '[]'::jsonb));
end $$;

create or replace function public.submit_report(p_report_id uuid, p_expected_version integer)
returns public.daily_reports language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_role text := public.current_app_role();
  r public.daily_reports;
  v_count int; v_reportable int;
begin
  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status <> 'draft' then
    raise exception 'The official report for % has already been published', r.report_date using errcode = 'P0001';
  end if;
  if v_role = 'operator' and not public.is_current_update(r) then
    raise exception 'This update is closed. Operators can only edit the current update (%).', public.current_update_label()
      using errcode = 'P0001';
  end if;
  if r.version <> p_expected_version then
    raise exception 'The report was changed by another user since you loaded it. Reload and review before submitting.'
      using errcode = '40001';
  end if;

  select count(*) into v_count from public.daily_stock_entries where report_id = r.id;
  if v_count = 0 then
    raise exception 'Cannot publish an empty report: save at least one quantity first.' using errcode = 'P0001';
  end if;
  select count(*) into v_reportable from public.zoho_items i where public.is_reportable(i);

  update public.daily_reports
    set status = 'published', submitted_by = v_uid, submitted_at = now(),
        version = version + 1, last_modified_by = v_uid, published_item_count = v_count
    where id = r.id returning * into r;

  perform public.write_audit('report_published', 'report_published', 'daily_report', r.id::text,
    jsonb_build_object('report_date', r.report_date, 'slot', r.slot_hour, 'item_count', v_count,
                       'catalogue_items', v_reportable, 'left_empty', greatest(v_reportable - v_count, 0)),
    r.id, r.report_date);
  return r;
end $$;

create or replace function public.add_manual_item(p_report_id uuid, p_name text, p_part_code text,
                                                  p_unit text, p_quantity text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_role text := public.current_app_role();
  r public.daily_reports;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(btrim(coalesce(p_part_code, '')), '');
  v_unit text := btrim(coalesce(p_unit, ''));
  v_parsed record;
  v_dup public.zoho_items;
  v_id text;
  v_user text;
  e public.daily_stock_entries;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 200 then
    raise exception 'Enter the part name (2–200 characters)' using errcode = 'P0001';
  end if;
  if v_code is not null and char_length(v_code) > 100 then
    raise exception 'Part code is too long (max 100 characters)' using errcode = 'P0001';
  end if;
  if v_unit = '' or char_length(v_unit) > 20 then
    raise exception 'Enter the unit (e.g. pcs, kg)' using errcode = 'P0001';
  end if;
  select * into v_parsed from public.parse_quantity(to_jsonb(p_quantity));
  if v_parsed.error is not null then raise exception '%', v_parsed.error using errcode = 'P0001'; end if;

  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if r.status <> 'draft' then
    raise exception 'The report for % has already been published', r.report_date using errcode = 'P0001';
  end if;
  if v_role = 'operator' and not public.is_current_update(r) then
    raise exception 'This update is closed. Operators can only edit the current update (%).', public.current_update_label()
      using errcode = 'P0001';
  end if;

  select * into v_dup from public.zoho_items
   where product_type = 'goods'
     and (lower(item_name) = lower(v_name) or (v_code is not null and lower(part_code) = lower(v_code)))
   limit 1;
  if found then
    raise exception 'This part already exists in the catalogue as "%"%. Search for it instead of adding it again.',
      v_dup.item_name,
      case when not public.is_reportable(v_dup) then ' (currently excluded from the daily report — ask the administrator)' else '' end
      using errcode = 'P0001';
  end if;

  select display_name into v_user from public.profiles where id = v_uid;
  v_id := 'MANUAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.zoho_items(zoho_item_id, item_name, description, part_code, unit, unit_source, unit_needs_review,
                                product_type, zoho_status, include_in_stock, item_source, created_by, created_by_name)
  values (v_id, v_name, v_code, v_code, v_unit, 'manual', false, 'goods', 'Active', true, 'manual', v_uid, v_user);

  insert into public.daily_stock_entries(report_id, zoho_item_id, available_quantity, unit_snapshot, updated_by)
  values (r.id, v_id, v_parsed.quantity, v_unit, v_uid)
  returning * into e;

  update public.daily_reports set version = version + 1, last_modified_by = v_uid where id = r.id returning * into r;

  perform public.write_audit('manual_item_added', 'manual_item', 'zoho_item', v_id,
    jsonb_build_object('item_name', v_name, 'part_code', v_code, 'unit', v_unit), r.id, r.report_date, v_id,
    null, v_parsed.quantity);

  return jsonb_build_object(
    'item', jsonb_build_object('zoho_item_id', v_id, 'item_name', v_name, 'part_code', v_code, 'sku', null,
                               'description', v_code, 'unit', v_unit, 'unit_needs_review', false),
    'entry', jsonb_build_object('zoho_item_id', v_id, 'available_quantity', e.available_quantity, 'revision', e.revision,
                                'updated_at', e.updated_at, 'updated_by_name', e.updated_by_name,
                                'value_updated_at', e.value_updated_at, 'value_updated_by_name', e.value_updated_by_name, 'carried', false),
    'report_version', r.version);
end $$;

-- 8. Admin: entry hours ------------------------------------------------------------
create or replace function public.admin_set_entry_hours(p_open int, p_close int, p_interval int)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_old jsonb;
begin
  if p_open is null or p_close is null or p_interval is null
     or p_open < 0 or p_close > 24 or p_open >= p_close or p_interval < 1 or p_interval > 12 then
    raise exception 'Invalid hours: opening must be before closing (0–24) and the interval 1–12 hours' using errcode = 'P0001';
  end if;
  v_old := jsonb_build_object('open', public.setting_int('entry_open_hour', 8), 'close', public.setting_int('entry_close_hour', 20),
                              'interval', public.setting_int('entry_interval_hours', 1));
  insert into public.app_settings(key, value, updated_at, updated_by) values
    ('entry_open_hour', p_open::text, now(), v_uid), ('entry_close_hour', p_close::text, now(), v_uid),
    ('entry_interval_hours', p_interval::text, now(), v_uid)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_uid;
  perform public.write_audit('settings_changed', 'settings', 'app_settings', 'entry_hours',
    jsonb_build_object('previous', v_old, 'new', jsonb_build_object('open', p_open, 'close', p_close, 'interval', p_interval)));
  return jsonb_build_object('open', p_open, 'close', p_close, 'interval', p_interval);
end $$;

-- 9. Customer/portal read functions --------------------------------------------------
drop function if exists public.published_reports(integer);
create function public.published_reports(p_limit integer default 200)
returns table (report_id uuid, report_date date, slot_hour smallint, status text, submitted_at timestamptz,
               amended_at timestamptz, item_count integer, amendment_count integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select r.id, r.report_date, r.slot_hour, r.status, r.submitted_at, r.amended_at,
           coalesce(r.published_item_count, 0), r.amendment_count
    from public.daily_reports r
    where r.status in ('published', 'amended')
    order by r.report_date desc, r.slot_hour desc
    limit least(greatest(coalesce(p_limit, 200), 1), 2000);
end $$;

create or replace function public.published_update_stock(p_report_id uuid)
returns table (zoho_item_id text, item_name text, part_code text, sku text, description text,
               unit text, available_quantity numeric, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select e.zoho_item_id, coalesce(e.item_name_snapshot, i.item_name), coalesce(e.part_code_snapshot, i.part_code),
           i.sku, i.description, e.unit_snapshot, e.available_quantity, coalesce(e.value_updated_at, e.updated_at)
    from public.daily_reports r
    join public.daily_stock_entries e on e.report_id = r.id
    left join public.zoho_items i on i.zoho_item_id = e.zoho_item_id
    where r.id = p_report_id and r.status in ('published', 'amended')
    order by 2;
end $$;

-- latest published update of a date (kept for compatibility)
create or replace function public.published_report_stock(p_report_date date)
returns table (zoho_item_id text, item_name text, part_code text, sku text, description text,
               unit text, available_quantity numeric, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.require_role('admin', 'operator', 'customer');
  select id into v_id from public.daily_reports
   where report_date = p_report_date and status in ('published', 'amended')
   order by slot_hour desc limit 1;
  if v_id is null then return; end if;
  return query select * from public.published_update_stock(v_id);
end $$;

drop function if exists public.published_item_history(text, integer);
create function public.published_item_history(p_zoho_item_id text, p_limit integer default 48)
returns table (report_date date, slot_hour smallint, available_quantity numeric, unit text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select r.report_date, r.slot_hour, e.available_quantity, e.unit_snapshot, coalesce(e.value_updated_at, e.updated_at)
    from public.daily_stock_entries e
    join public.daily_reports r on r.id = e.report_id
    where e.zoho_item_id = p_zoho_item_id and r.status in ('published', 'amended')
    order by r.report_date desc, r.slot_hour desc
    limit least(greatest(coalesce(p_limit, 48), 1), 500);
end $$;

create or replace function public.portal_summary()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_latest record; c record;
begin
  perform public.require_role('admin', 'operator', 'customer');
  select id, report_date, slot_hour, submitted_at, amended_at into v_latest
    from public.daily_reports where status in ('published', 'amended')
    order by report_date desc, slot_hour desc limit 1;
  select * into c from public.current_update_slot();
  return jsonb_build_object(
    'factory_timezone', public.factory_timezone(),
    'factory_today', public.factory_today(),
    'reportable_items', (select count(*) from public.zoho_items i where public.is_reportable(i)),
    'items_missing_unit', (select count(*) from public.zoho_items i
                           where public.is_reportable(i) and (i.unit is null or i.unit_needs_review)),
    'latest_published_id', v_latest.id,
    'latest_published_date', v_latest.report_date,
    'latest_published_slot', v_latest.slot_hour,
    'latest_published_at', v_latest.submitted_at,
    'latest_amended_at', v_latest.amended_at,
    'entry_open_hour', public.setting_int('entry_open_hour', 8),
    'entry_close_hour', public.setting_int('entry_close_hour', 20),
    'entry_interval_hours', public.setting_int('entry_interval_hours', 1),
    'current_slot_date', c.report_date,
    'current_slot_hour', c.slot_hour,
    'current_slot_closes_at', c.closes_at);
end $$;

-- 10. Privileges ----------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.published_reports(integer)', 'public.published_update_stock(uuid)', 'public.published_report_stock(date)',
    'public.published_item_history(text, integer)', 'public.portal_summary()', 'public.get_or_create_today_report()',
    'public.save_draft_entries(uuid, jsonb)', 'public.submit_report(uuid, integer)',
    'public.add_manual_item(uuid, text, text, text, text)', 'public.admin_set_entry_hours(integer, integer, integer)',
    'public.current_update_slot()', 'public.is_current_update(public.daily_reports)', 'public.current_update_label()',
    'public.setting_int(text, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke all on function public.ensure_update(date, smallint, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.ensure_update(date, smallint, uuid) to service_role';
end $$;
