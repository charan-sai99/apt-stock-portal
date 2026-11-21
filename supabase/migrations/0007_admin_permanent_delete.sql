-- =============================================================================
-- APT Stock Portal — 0007 admin permanent delete
-- Decision (owner, 21 Nov 2026): the admin can PERMANENTLY delete
--   * a whole daily report (draft or published) with all its lines and amendments,
--   * a single part line from a report,
--   * a manually added part (with its lines in all reports).
-- Only one audit line per deletion is kept (who, when, what, reason). The audit
-- log itself remains append-only and can never be deleted.
-- Deletes are only possible through the admin_delete_* functions below, which set
-- a transaction-local flag that the protective triggers check.
-- Schema change: audit_logs.report_id no longer has a foreign key, so audit lines
-- can outlive a deleted report (the id is kept as a plain reference).
-- =============================================================================

alter table public.audit_logs drop constraint if exists audit_logs_report_id_fkey;

create or replace function public.admin_delete_allowed()
returns boolean language sql stable
as $$ select coalesce(current_setting('app.operation', true), '') = 'admin_delete' $$;

create or replace function public.prevent_entry_delete()
returns trigger language plpgsql set search_path = public
as $$
begin
  if public.admin_delete_allowed() then return old; end if;
  raise exception 'Stock entries are permanent records and cannot be deleted';
end $$;

create or replace function public.prevent_published_report_delete()
returns trigger language plpgsql
as $$
begin
  if old.status <> 'draft' and not public.admin_delete_allowed() then
    raise exception 'Published reports are permanent records and cannot be deleted';
  end if;
  return old;
end $$;

create or replace function public.prevent_amendment_mutation()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.admin_delete_allowed() then return old; end if;
  raise exception 'Amendment records are append-only';
end $$;
drop trigger if exists report_amendments_append_only on public.report_amendments;
create trigger report_amendments_append_only before update or delete on public.report_amendments
  for each row execute function public.prevent_amendment_mutation();

create or replace function public.check_delete_reason(p_reason text)
returns text language plpgsql immutable
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    raise exception 'A reason of at least 5 characters is required to delete data' using errcode = 'P0001';
  end if;
  return btrim(p_reason);
end $$;

-- 1. Whole report --------------------------------------------------------------
create or replace function public.admin_delete_report(p_report_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin');
  v_reason text := public.check_delete_reason(p_reason);
  r public.daily_reports;
  v_lines int; v_amend int;
begin
  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  perform set_config('app.operation', 'admin_delete', true);
  delete from public.report_amendments where report_id = r.id;
  get diagnostics v_amend = row_count;
  delete from public.daily_stock_entries where report_id = r.id;
  get diagnostics v_lines = row_count;
  delete from public.daily_reports where id = r.id;
  perform set_config('app.operation', '', true);
  perform public.write_audit('report_deleted', 'admin_delete', 'daily_report', r.id::text,
    jsonb_build_object('report_date', r.report_date, 'status', r.status, 'lines_deleted', v_lines,
                       'amendments_deleted', v_amend, 'reason', v_reason),
    r.id, r.report_date);
  return jsonb_build_object('report_date', r.report_date, 'lines_deleted', v_lines);
end $$;

-- 2. Single line ---------------------------------------------------------------
create or replace function public.admin_delete_entry(p_report_id uuid, p_zoho_item_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin');
  v_reason text := public.check_delete_reason(p_reason);
  r public.daily_reports;
  e public.daily_stock_entries;
begin
  select * into r from public.daily_reports where id = p_report_id for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  select * into e from public.daily_stock_entries where report_id = r.id and zoho_item_id = p_zoho_item_id;
  if not found then raise exception 'This part has no quantity in the report' using errcode = 'P0002'; end if;
  perform set_config('app.operation', 'admin_delete', true);
  delete from public.report_amendments where report_id = r.id and zoho_item_id = p_zoho_item_id;
  delete from public.daily_stock_entries where id = e.id;
  perform set_config('app.operation', '', true);
  update public.daily_reports
     set version = version + 1, last_modified_by = v_uid,
         published_item_count = case when status = 'draft' then published_item_count
                                     else (select count(*) from public.daily_stock_entries where report_id = r.id) end
   where id = r.id;
  perform public.write_audit('entry_deleted', 'admin_delete', 'daily_stock_entry', e.id::text,
    jsonb_build_object('item_name', e.item_name_snapshot, 'part_code', e.part_code_snapshot, 'unit', e.unit_snapshot,
                       'report_status', r.status, 'reason', v_reason),
    r.id, r.report_date, p_zoho_item_id, e.available_quantity, null);
  return jsonb_build_object('deleted', true);
end $$;

-- 3. Manually added part -------------------------------------------------------
create or replace function public.admin_delete_manual_item(p_zoho_item_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.require_role('admin');
  v_reason text := public.check_delete_reason(p_reason);
  i public.zoho_items;
  v_lines int;
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
  delete from public.zoho_items where zoho_item_id = p_zoho_item_id;
  perform set_config('app.operation', '', true);
  update public.daily_reports r
     set published_item_count = (select count(*) from public.daily_stock_entries e where e.report_id = r.id)
   where r.status <> 'draft';
  perform public.write_audit('manual_item_deleted', 'admin_delete', 'zoho_item', p_zoho_item_id,
    jsonb_build_object('item_name', i.item_name, 'part_code', i.part_code, 'unit', i.unit,
                       'lines_deleted', v_lines, 'reason', v_reason),
    null, null, p_zoho_item_id);
  return jsonb_build_object('lines_deleted', v_lines);
end $$;

-- Read-only helper for the UI: how many report lines a manual part has.
create or replace function public.manual_item_usage(p_zoho_item_id text)
returns integer language sql stable security definer set search_path = public
as $$ select case when public.current_app_role() = 'admin'
                  then (select count(*)::int from public.daily_stock_entries where zoho_item_id = p_zoho_item_id) end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_delete_report(uuid, text)', 'public.admin_delete_entry(uuid, text, text)',
    'public.admin_delete_manual_item(text, text)', 'public.manual_item_usage(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
