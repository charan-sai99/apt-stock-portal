-- =============================================================================
-- APT Stock Portal — 0005 allow partial reports
-- Decision (owner, 21 Nov 2026): operators may leave quantities empty. A report
-- can be published once at least one quantity is saved. Parts left empty are
-- simply not part of that day's published report (customers do not see them).
-- Parts without a configured unit can still not receive quantities, but they no
-- longer block publication.
-- NON-DESTRUCTIVE: replaces one function only.
-- =============================================================================
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
  if v_role = 'operator' and r.report_date <> public.factory_today() then
    raise exception 'Operators can only submit the report for today (%)', public.factory_today() using errcode = 'P0001';
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
    jsonb_build_object('report_date', r.report_date, 'item_count', v_count,
                       'catalogue_items', v_reportable, 'left_empty', greatest(v_reportable - v_count, 0)),
    r.id, r.report_date);
  return r;
end $$;

revoke all on function public.submit_report(uuid, integer) from public, anon;
grant execute on function public.submit_report(uuid, integer) to authenticated, service_role;
