-- =============================================================================
-- APT Stock Portal — 0006 manually added items
-- Decision (owner, 21 Nov 2026): if a part is not in the catalogue, an operator
-- can add it (name, part code, unit, quantity) while preparing the daily draft.
-- The item gets a temporary ID "MANUAL-…", is marked item_source = 'manual',
-- stays in the catalogue for later days, and is listed for the admin to review
-- (e.g. exclude it once the real item exists in Zoho Books).
-- NON-DESTRUCTIVE: adds columns, widens one check constraint, adds one function.
-- =============================================================================
alter table public.zoho_items add column if not exists item_source text not null default 'zoho';
alter table public.zoho_items add column if not exists created_by uuid references public.profiles(id);
alter table public.zoho_items add column if not exists created_by_name text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'zoho_items_item_source_chk') then
    alter table public.zoho_items add constraint zoho_items_item_source_chk check (item_source in ('zoho', 'manual'));
  end if;
  -- allow unit_source = 'manual' (unit typed by the operator who added the item)
  alter table public.zoho_items drop constraint if exists zoho_items_unit_source_chk;
  alter table public.zoho_items add constraint zoho_items_unit_source_chk
    check (unit_source is null or unit_source in ('zoho', 'admin', 'manual'));
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
  if v_role = 'operator' and r.report_date <> public.factory_today() then
    raise exception 'Operators can only edit the report for today (%)', public.factory_today() using errcode = 'P0001';
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
                                'updated_at', e.updated_at, 'updated_by_name', e.updated_by_name),
    'report_version', r.version);
end $$;

revoke all on function public.add_manual_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_manual_item(uuid, text, text, text, text) to authenticated, service_role;
