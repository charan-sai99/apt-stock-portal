-- =============================================================================
-- APT Stock Portal — 0008 admin can delete users
-- Decision (owner, 21 Nov 2026): the admin (CEO) can delete user accounts.
-- Rule: a user who has stock history (report lines, reports they created or
-- published, amendments) cannot be deleted — deactivate them instead — so that
-- every official record stays attributable. Audit-log lines keep the user's name
-- (actor_name) and survive the deletion.
-- Schema: relaxes non-essential foreign keys to profiles (audit actor -> no FK;
-- catalogue/sync/settings references -> ON DELETE SET NULL). No data is deleted.
-- =============================================================================
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;

do $$
declare c record;
begin
  for c in
    select tc.table_name, kcu.column_name, tc.constraint_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
      and (tc.table_name, kcu.column_name) in (
        ('zoho_items', 'created_by'), ('zoho_items', 'unit_configured_by'), ('zoho_sync_runs', 'triggered_by'),
        ('app_settings', 'updated_by'), ('daily_reports', 'last_modified_by'), ('daily_reports', 'amended_by'))
  loop
    execute format('alter table public.%I drop constraint %I', c.table_name, c.constraint_name);
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on delete set null',
                   c.table_name, c.constraint_name, c.column_name);
  end loop;
end $$;

create or replace function public.admin_user_history(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_entries int; v_reports int; v_amend int;
begin
  perform public.require_role('admin');
  select count(*) into v_entries from public.daily_stock_entries where updated_by = p_user_id or created_by = p_user_id;
  select count(*) into v_reports from public.daily_reports where created_by = p_user_id or submitted_by = p_user_id;
  select count(*) into v_amend from public.report_amendments where amended_by = p_user_id;
  return jsonb_build_object('entries', v_entries, 'reports', v_reports, 'amendments', v_amend,
                            'can_delete', v_entries + v_reports + v_amend = 0 and p_user_id <> auth.uid());
end $$;

create or replace function public.admin_delete_profile(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := public.require_role('admin'); v_p public.profiles; v_h jsonb;
begin
  if p_user_id = v_uid then raise exception 'You cannot delete your own account' using errcode = 'P0001'; end if;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  v_h := public.admin_user_history(p_user_id);
  if not (v_h->>'can_delete')::boolean then
    raise exception 'This user has stock history (% line(s), % report(s), % amendment(s)) and cannot be deleted. Deactivate the account instead.',
      v_h->>'entries', v_h->>'reports', v_h->>'amendments' using errcode = 'P0001';
  end if;
  delete from public.profiles where id = p_user_id;
  perform public.write_audit('user_deleted', 'user_admin', 'profile', p_user_id::text,
    jsonb_build_object('email', v_p.email, 'display_name', v_p.display_name,
                       'role', public.role_label(v_p.role, v_p.operator_slot)));
  return jsonb_build_object('deleted', true, 'email', v_p.email);
end $$;

revoke all on function public.admin_user_history(uuid) from public, anon;
revoke all on function public.admin_delete_profile(uuid) from public, anon;
grant execute on function public.admin_user_history(uuid) to authenticated, service_role;
grant execute on function public.admin_delete_profile(uuid) to authenticated, service_role;
grant delete on table public.profiles to service_role;
