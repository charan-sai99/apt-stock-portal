-- =============================================================================
-- APT Stock Portal — 0004 explicit table privileges
-- Newer Supabase projects do not automatically grant the API roles access to
-- tables created by SQL migrations. Without these grants every read fails with
-- "permission denied for table ...".
--
-- NON-DESTRUCTIVE: only GRANT statements. Signed-in users get SELECT only —
-- all writes still go through the role-checked functions from 0003, and RLS
-- policies still decide which rows each role can see.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Read access for signed-in users (rows filtered by RLS).
grant select on table
  public.profiles, public.zoho_items, public.daily_reports, public.daily_stock_entries,
  public.audit_logs, public.app_settings, public.report_amendments, public.zoho_sync_runs
to authenticated;

-- Server-side service role (user admin, Zoho sync). Bypasses RLS but still needs privileges.
grant select, insert, update, delete on table
  public.profiles, public.zoho_items, public.daily_reports, public.daily_stock_entries,
  public.audit_logs, public.app_settings, public.report_amendments, public.zoho_sync_runs,
  public.zoho_oauth_tokens
to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Helpers evaluated inside RLS policies and functions.
grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.is_reportable(public.zoho_items) to authenticated, service_role;
grant execute on function public.role_label(text, smallint) to authenticated, service_role;
grant execute on function public.first_line(text) to authenticated, service_role;
grant execute on function public.parse_quantity(jsonb) to authenticated, service_role;
grant execute on function public.require_role(text[]) to authenticated, service_role;

-- Never directly readable by browser roles.
revoke all on table public.zoho_oauth_tokens from anon, authenticated;
