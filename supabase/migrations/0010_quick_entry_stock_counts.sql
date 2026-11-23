-- =============================================================================
-- APT Stock Portal — 0010 quick entry (live stock counts)
-- Decision (owner, 23 Nov 2026): no time-limited entry while the team moves from
-- paper to the portal. Operators pick a part, enter the counted quantity and save;
-- it is visible to the customer immediately with its count time.
--   * Every count is a permanent row in stock_counts (who, what, when).
--   * Current stock = latest count per part. "Stock as of" any time is derived.
--   * An operator can correct their OWN count within 10 minutes; afterwards only
--     the admin can amend (with a reason) or delete it. All changes are audited.
--   * If someone else counted the same part in the last 10 minutes, the save asks
--     for confirmation instead of silently replacing it.
-- NON-DESTRUCTIVE: adds a table and functions. The earlier daily/hourly report
-- tables and their data stay untouched (kept as history).
-- =============================================================================

create table if not exists public.stock_counts (
  id bigint generated always as identity primary key,
  zoho_item_id text not null references public.zoho_items(zoho_item_id),
  quantity numeric(14,3) not null check (quantity >= 0),
  unit text not null,
  item_name_snapshot text,
  part_code_snapshot text,
  counted_at timestamptz not null default now(),
  counted_by uuid not null references public.profiles(id),
  counted_by_name text,
  corrected_at timestamptz,
  corrected_by_name text,
  correction_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists stock_counts_item_time_idx on public.stock_counts(zoho_item_id, counted_at desc, id desc);
create index if not exists stock_counts_time_idx on public.stock_counts(counted_at desc);
create index if not exists stock_counts_user_idx on public.stock_counts(counted_by);

alter table public.stock_counts enable row level security;
drop policy if exists "staff read stock counts" on public.stock_counts;
create policy "staff read stock counts" on public.stock_counts
  for select to authenticated using (public.current_app_role() in ('admin', 'operator'));
grant select on table public.stock_counts to authenticated;
grant select, insert, update, delete on table public.stock_counts to service_role;

-- Rows change only through the functions below (they set a transaction-local flag).
create or replace function public.protect_stock_counts()
returns trigger language plpgsql
as $$
begin
  if coalesce(current_setting('app.operation', true), '') in ('count_fn', 'admin_delete', 'maintenance') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Stock counts can only be changed through the portal (correction or admin amendment)';
end $$;
drop trigger if exists stock_counts_protect on public.stock_counts;
create trigger stock_counts_protect before update or delete on public.stock_counts
  for each row execute function public.protect_stock_counts();

-- -----------------------------------------------------------------------------
-- Writing
-- -----------------------------------------------------------------------------
create or replace function public.record_count(p_zoho_item_id text, p_quantity text,
                                               p_seen_count_id bigint default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_name text;
  v_item public.zoho_items;
  v_parsed record;
  v_last public.stock_counts;
  c public.stock_counts;
begin
  select * into v_item from public.zoho_items where zoho_item_id = p_zoho_item_id;
  if not found or not public.is_reportable(v_item) then
    raise exception 'This part is not in the stock catalogue' using errcode = 'P0001';
  end if;
  if v_item.unit is null or v_item.unit_needs_review then
    raise exception 'This part has no unit yet; the administrator must set it first' using errcode = 'P0001';
  end if;
  select * into v_parsed from public.parse_quantity(to_jsonb(p_quantity));
  if v_parsed.error is not null then raise exception '%', v_parsed.error using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('stock_count:' || p_zoho_item_id));
  select * into v_last from public.stock_counts where zoho_item_id = p_zoho_item_id
   order by counted_at desc, id desc limit 1;

  if not coalesce(p_force, false) and v_last.id is not null
     and v_last.id is distinct from p_seen_count_id
     and v_last.counted_by <> v_uid
     and v_last.counted_at > now() - interval '10 minutes' then
    return jsonb_build_object('status', 'confirm', 'latest', jsonb_build_object(
      'id', v_last.id, 'quantity', v_last.quantity, 'unit', v_last.unit,
      'counted_at', v_last.counted_at, 'counted_by_name', v_last.counted_by_name));
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.stock_counts(zoho_item_id, quantity, unit, item_name_snapshot, part_code_snapshot, counted_by, counted_by_name)
  values (p_zoho_item_id, v_parsed.quantity, v_item.unit, v_item.item_name, v_item.part_code, v_uid, v_name)
  returning * into c;

  perform public.write_audit('count_recorded', 'stock_count', 'stock_count', c.id::text,
    jsonb_build_object('item_name', v_item.item_name, 'unit', v_item.unit),
    null, (c.counted_at at time zone public.factory_timezone())::date, p_zoho_item_id,
    v_last.quantity, c.quantity);

  return jsonb_build_object('status', 'saved', 'count', jsonb_build_object(
    'id', c.id, 'zoho_item_id', c.zoho_item_id, 'quantity', c.quantity, 'unit', c.unit,
    'counted_at', c.counted_at, 'counted_by', c.counted_by, 'counted_by_name', c.counted_by_name,
    'previous_quantity', v_last.quantity));
end $$;

-- Operator: own count within 10 minutes. Admin: any count, reason required.
create or replace function public.correct_count(p_count_id bigint, p_quantity text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_role text := public.current_app_role();
  v_name text;
  v_parsed record;
  c public.stock_counts;
  v_old numeric;
  v_own_window boolean;
begin
  select * into c from public.stock_counts where id = p_count_id for update;
  if not found then raise exception 'Count not found' using errcode = 'P0002'; end if;
  select * into v_parsed from public.parse_quantity(to_jsonb(p_quantity));
  if v_parsed.error is not null then raise exception '%', v_parsed.error using errcode = 'P0001'; end if;
  if v_parsed.quantity = c.quantity then
    raise exception 'The new quantity is the same as the recorded one' using errcode = 'P0001';
  end if;

  v_own_window := c.counted_by = v_uid and c.created_at > now() - interval '10 minutes';
  if v_role = 'operator' and not v_own_window then
    raise exception 'You can only correct your own entry within 10 minutes. Ask the administrator to amend it.'
      using errcode = 'P0001';
  end if;
  if v_role = 'admin' and not v_own_window and (p_reason is null or char_length(btrim(p_reason)) < 5) then
    raise exception 'A reason of at least 5 characters is required for an amendment' using errcode = 'P0001';
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  v_old := c.quantity;
  perform set_config('app.operation', 'count_fn', true);
  update public.stock_counts
     set quantity = v_parsed.quantity, corrected_at = now(), corrected_by_name = v_name,
         correction_count = correction_count + 1
   where id = c.id returning * into c;
  perform set_config('app.operation', '', true);

  perform public.write_audit(case when v_own_window then 'count_corrected' else 'count_amended' end,
    case when v_own_window then 'count_correction' else 'amendment' end,
    'stock_count', c.id::text,
    jsonb_build_object('item_name', c.item_name_snapshot, 'unit', c.unit, 'counted_at', c.counted_at,
                       'counted_by_name', c.counted_by_name, 'reason', nullif(btrim(coalesce(p_reason, '')), '')),
    null, (c.counted_at at time zone public.factory_timezone())::date, c.zoho_item_id, v_old, c.quantity);

  return jsonb_build_object('id', c.id, 'quantity', c.quantity, 'corrected_at', c.corrected_at);
end $$;

create or replace function public.admin_delete_count(p_count_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_reason text := public.check_delete_reason(p_reason);
        c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count_id for update;
  if not found then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform set_config('app.operation', 'admin_delete', true);
  delete from public.stock_counts where id = c.id;
  perform set_config('app.operation', '', true);
  perform public.write_audit('count_deleted', 'admin_delete', 'stock_count', c.id::text,
    jsonb_build_object('item_name', c.item_name_snapshot, 'unit', c.unit, 'counted_at', c.counted_at,
                       'counted_by_name', c.counted_by_name, 'reason', v_reason),
    null, (c.counted_at at time zone public.factory_timezone())::date, c.zoho_item_id, c.quantity, null);
  return jsonb_build_object('deleted', true);
end $$;

-- New part that is not in the catalogue, counted straight away.
create or replace function public.add_manual_item_count(p_name text, p_part_code text, p_unit text, p_quantity text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin', 'operator');
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := nullif(btrim(coalesce(p_part_code, '')), '');
  v_unit text := btrim(coalesce(p_unit, ''));
  v_parsed record;
  v_dup public.zoho_items;
  v_id text;
  v_user text;
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

  select * into v_dup from public.zoho_items
   where product_type = 'goods'
     and (lower(item_name) = lower(v_name) or (v_code is not null and lower(part_code) = lower(v_code)))
   limit 1;
  if found then
    raise exception 'This part already exists in the catalogue as "%"%. Search for it instead of adding it again.',
      v_dup.item_name,
      case when not public.is_reportable(v_dup) then ' (currently excluded from stock reporting — ask the administrator)' else '' end
      using errcode = 'P0001';
  end if;

  select display_name into v_user from public.profiles where id = v_uid;
  v_id := 'MANUAL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.zoho_items(zoho_item_id, item_name, description, part_code, unit, unit_source, unit_needs_review,
                                product_type, zoho_status, include_in_stock, item_source, created_by, created_by_name)
  values (v_id, v_name, v_code, v_code, v_unit, 'manual', false, 'goods', 'Active', true, 'manual', v_uid, v_user);
  perform public.write_audit('manual_item_added', 'manual_item', 'zoho_item', v_id,
    jsonb_build_object('item_name', v_name, 'part_code', v_code, 'unit', v_unit), null, null, v_id);

  return public.record_count(v_id, p_quantity, null, true) || jsonb_build_object('zoho_item_id', v_id);
end $$;

-- -----------------------------------------------------------------------------
-- Reading
-- -----------------------------------------------------------------------------
-- Staff board: every reportable part with its latest count (incl. who counted).
create or replace function public.stock_board()
returns table (zoho_item_id text, item_name text, part_code text, sku text, description text, unit text,
               unit_needs_review boolean, item_source text, count_id bigint, quantity numeric,
               counted_at timestamptz, counted_by uuid, counted_by_name text, counted_created_at timestamptz,
               corrected_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator');
  return query
    select i.zoho_item_id, i.item_name, i.part_code, i.sku, i.description, i.unit, i.unit_needs_review, i.item_source,
           l.id, l.quantity, l.counted_at, l.counted_by, l.counted_by_name, l.created_at, l.corrected_at
    from public.zoho_items i
    left join lateral (
      select c.* from public.stock_counts c where c.zoho_item_id = i.zoho_item_id
      order by c.counted_at desc, c.id desc limit 1) l on true
    where public.is_reportable(i)
    order by i.item_name;
end $$;

-- Customer stock (no staff identities). Latest count per part at or before p_as_of.
create or replace function public.customer_stock(p_as_of timestamptz default null)
returns table (zoho_item_id text, item_name text, part_code text, sku text, description text, unit text,
               quantity numeric, counted_at timestamptz, counted_today boolean)
language plpgsql stable security definer set search_path = public
as $$
declare v_at timestamptz := coalesce(p_as_of, now()); v_tz text := public.factory_timezone();
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select i.zoho_item_id, coalesce(l.item_name_snapshot, i.item_name), coalesce(l.part_code_snapshot, i.part_code),
           i.sku, i.description, l.unit, l.quantity, l.counted_at,
           (l.counted_at at time zone v_tz)::date = (v_at at time zone v_tz)::date
    from public.zoho_items i
    join lateral (
      select c.* from public.stock_counts c
      where c.zoho_item_id = i.zoho_item_id and c.counted_at <= v_at
      order by c.counted_at desc, c.id desc limit 1) l on true
    where i.product_type = 'goods' and (public.is_reportable(i) or p_as_of is not null)
    order by 2;
end $$;

create or replace function public.count_history(p_zoho_item_id text, p_limit integer default 60)
returns table (counted_at timestamptz, quantity numeric, unit text, corrected boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('admin', 'operator', 'customer');
  return query
    select c.counted_at, c.quantity, c.unit, c.correction_count > 0
    from public.stock_counts c where c.zoho_item_id = p_zoho_item_id
    order by c.counted_at desc, c.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 500);
end $$;

-- Staff count log for one factory day.
create or replace function public.counts_on_day(p_date date default null)
returns table (id bigint, zoho_item_id text, item_name text, part_code text, quantity numeric, unit text,
               counted_at timestamptz, counted_by uuid, counted_by_name text, created_at timestamptz,
               corrected_at timestamptz, corrected_by_name text, correction_count integer)
language plpgsql stable security definer set search_path = public
as $$
declare v_tz text := public.factory_timezone(); v_day date := coalesce(p_date, public.factory_today());
begin
  perform public.require_role('admin', 'operator');
  return query
    select c.id, c.zoho_item_id, c.item_name_snapshot, c.part_code_snapshot, c.quantity, c.unit, c.counted_at,
           c.counted_by, c.counted_by_name, c.created_at, c.corrected_at, c.corrected_by_name, c.correction_count
    from public.stock_counts c
    where (c.counted_at at time zone v_tz)::date = v_day
    order by c.counted_at desc, c.id desc;
end $$;

create or replace function public.portal_summary()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_tz text := public.factory_timezone(); v_today date := public.factory_today(); v_latest record; v_slot record;
begin
  perform public.require_role('admin', 'operator', 'customer');
  -- legacy fields (hourly updates, kept as history)
  select id, report_date, slot_hour, submitted_at, amended_at into v_latest
    from public.daily_reports where status in ('published', 'amended')
    order by report_date desc, slot_hour desc limit 1;
  select * into v_slot from public.current_update_slot();
  return jsonb_build_object(
    'latest_published_id', v_latest.id, 'latest_published_date', v_latest.report_date,
    'latest_published_slot', v_latest.slot_hour, 'latest_published_at', v_latest.submitted_at,
    'latest_amended_at', v_latest.amended_at,
    'entry_open_hour', public.setting_int('entry_open_hour', 8),
    'entry_close_hour', public.setting_int('entry_close_hour', 20),
    'entry_interval_hours', public.setting_int('entry_interval_hours', 1),
    'current_slot_date', v_slot.report_date, 'current_slot_hour', v_slot.slot_hour, 'current_slot_closes_at', v_slot.closes_at
  ) || jsonb_build_object(
    'factory_timezone', v_tz,
    'factory_today', v_today,
    'reportable_items', (select count(*) from public.zoho_items i where public.is_reportable(i)),
    'items_missing_unit', (select count(*) from public.zoho_items i
                           where public.is_reportable(i) and (i.unit is null or i.unit_needs_review)),
    'parts_counted_today', (select count(distinct c.zoho_item_id) from public.stock_counts c
                            join public.zoho_items i on i.zoho_item_id = c.zoho_item_id
                            where public.is_reportable(i) and (c.counted_at at time zone v_tz)::date = v_today),
    'parts_ever_counted', (select count(distinct c.zoho_item_id) from public.stock_counts c
                           join public.zoho_items i on i.zoho_item_id = c.zoho_item_id where public.is_reportable(i)),
    'counts_today', (select count(*) from public.stock_counts c where (c.counted_at at time zone v_tz)::date = v_today),
    'last_count_at', (select max(counted_at) from public.stock_counts));
end $$;

-- -----------------------------------------------------------------------------
-- Keep existing admin features consistent with the new table
-- -----------------------------------------------------------------------------
create or replace function public.admin_delete_manual_item(p_zoho_item_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin');
  v_reason text := public.check_delete_reason(p_reason);
  i public.zoho_items;
  v_lines int; v_counts int;
begin
  select * into i from public.zoho_items where zoho_item_id = p_zoho_item_id for update;
  if not found then raise exception 'Unknown item' using errcode = 'P0002'; end if;
  if i.item_source <> 'manual' then
    raise exception 'Only manually added parts can be deleted. Zoho parts can be excluded from the stock report instead.'
      using errcode = 'P0001';
  end if;
  perform set_config('app.operation', 'admin_delete', true);
  delete from public.report_amendments where zoho_item_id = p_zoho_item_id;
  with gone as (delete from public.daily_stock_entries where zoho_item_id = p_zoho_item_id returning report_id)
  select count(*) into v_lines from gone;
  with gone as (delete from public.stock_counts where zoho_item_id = p_zoho_item_id returning id)
  select count(*) into v_counts from gone;
  delete from public.zoho_items where zoho_item_id = p_zoho_item_id;
  perform set_config('app.operation', '', true);
  update public.daily_reports r
     set published_item_count = (select count(*) from public.daily_stock_entries e where e.report_id = r.id)
   where r.status <> 'draft';
  perform public.write_audit('manual_item_deleted', 'admin_delete', 'zoho_item', p_zoho_item_id,
    jsonb_build_object('item_name', i.item_name, 'part_code', i.part_code, 'unit', i.unit,
                       'lines_deleted', v_lines + v_counts, 'reason', v_reason),
    null, null, p_zoho_item_id);
  return jsonb_build_object('lines_deleted', v_lines + v_counts);
end $$;

create or replace function public.manual_item_usage(p_zoho_item_id text)
returns integer language sql stable security definer set search_path = public
as $$ select case when public.current_app_role() = 'admin'
                  then (select count(*)::int from public.daily_stock_entries where zoho_item_id = p_zoho_item_id)
                     + (select count(*)::int from public.stock_counts where zoho_item_id = p_zoho_item_id) end $$;

create or replace function public.admin_user_history(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_entries int; v_reports int; v_amend int; v_counts int;
begin
  perform public.require_role('admin');
  select count(*) into v_entries from public.daily_stock_entries where updated_by = p_user_id or created_by = p_user_id;
  select count(*) into v_reports from public.daily_reports where created_by = p_user_id or submitted_by = p_user_id;
  select count(*) into v_amend from public.report_amendments where amended_by = p_user_id;
  select count(*) into v_counts from public.stock_counts where counted_by = p_user_id;
  return jsonb_build_object('entries', v_entries + v_counts, 'reports', v_reports, 'amendments', v_amend,
                            'can_delete', v_entries + v_reports + v_amend + v_counts = 0 and p_user_id <> auth.uid());
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.record_count(text, text, bigint, boolean)', 'public.correct_count(bigint, text, text)',
    'public.admin_delete_count(bigint, text)', 'public.add_manual_item_count(text, text, text, text)',
    'public.stock_board()', 'public.customer_stock(timestamptz)', 'public.count_history(text, integer)',
    'public.counts_on_day(date)', 'public.portal_summary()', 'public.admin_delete_manual_item(text, text)',
    'public.manual_item_usage(text)', 'public.admin_user_history(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
