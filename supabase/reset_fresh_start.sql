-- =============================================================================
-- APT Stock Portal — FRESH START (run once, in the Supabase SQL editor)
-- PERMANENTLY DELETES: all stock counts (quick entry), all daily/hourly reports, all quantity lines,
-- all amendments, and the whole audit & activity log.
-- KEEPS: catalogue parts (incl. manually added), configured units, user accounts,
-- Zoho sync log and settings.
-- Requires migration 0007 (or later). Runs as one transaction: all or nothing.
-- There is NO undo. Read the lines above before clicking Run.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.admin_delete_allowed()') is null then
    raise exception 'Apply migration 0007_admin_permanent_delete.sql first.';
  end if;
end $$;

select set_config('app.operation', 'admin_delete', true);
delete from public.report_amendments;
delete from public.daily_stock_entries;
delete from public.daily_reports;
do $$ begin
  if to_regclass('public.stock_counts') is not null then delete from public.stock_counts; end if;
end $$;

alter table public.audit_logs disable trigger audit_logs_append_only;
delete from public.audit_logs;
alter table public.audit_logs enable trigger audit_logs_append_only;

insert into public.audit_logs(actor_id, actor_name, action, operation, entity_type, details)
values (null, 'System', 'data_reset', 'admin_delete', 'system',
        jsonb_build_object('note', 'Fresh start: test reports, quantities, amendments and audit history removed before go-live'));

select set_config('app.operation', '', true);
commit;

-- Check (all should be 0 except audit_logs = 1 and zoho_items unchanged):
select (select count(*) from public.daily_reports)       as reports,
       (select count(*) from public.stock_counts)        as stock_counts,
       (select count(*) from public.daily_stock_entries) as lines,
       (select count(*) from public.report_amendments)   as amendments,
       (select count(*) from public.audit_logs)          as audit_lines,
       (select count(*) from public.zoho_items)          as catalogue_items,
       (select count(*) from public.profiles)            as users;
