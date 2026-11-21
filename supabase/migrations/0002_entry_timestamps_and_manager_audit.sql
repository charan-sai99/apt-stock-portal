-- APT Stock Portal — entry timestamps and manager audit visibility
-- Apply after 0001_initial_schema.sql.

-- Every stock row already has updated_at and updated_by. This migration
-- guarantees server-side timestamps and records each create/change.
create or replace function public.capture_stock_entry_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_action text;
  v_details jsonb;
begin
  v_actor := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  if v_actor is not null then
    new.updated_by := v_actor;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'stock_entry_created';
    v_details := jsonb_build_object(
      'available_quantity', new.available_quantity,
      'unit', new.unit_snapshot,
      'entry_timestamp', new.updated_at
    );
  else
    v_action := 'stock_entry_updated';
    v_details := jsonb_build_object(
      'previous_quantity', old.available_quantity,
      'new_quantity', new.available_quantity,
      'unit', new.unit_snapshot,
      'entry_timestamp', new.updated_at
    );
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details, created_at)
  values (v_actor, v_action, 'daily_stock_entry', new.id::text, v_details, new.updated_at);

  return new;
end;
$$;

drop trigger if exists daily_stock_entry_audit on public.daily_stock_entries;
create trigger daily_stock_entry_audit
before insert or update on public.daily_stock_entries
for each row execute function public.capture_stock_entry_audit();

-- Keep report submission timestamps server-generated.
create or replace function public.capture_report_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.status in ('published','amended') and old.status = 'draft' then
    new.submitted_at := now();
    new.submitted_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists daily_report_timestamps on public.daily_reports;
create trigger daily_report_timestamps
before update on public.daily_reports
for each row execute function public.capture_report_timestamps();

-- Admin is the manager role in this version: managers can inspect all entry
-- audit events, including the actor, timestamp and quantity changes.
drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "managers read audit logs" on public.audit_logs
for select to authenticated using (public.current_app_role() = 'admin');

create index if not exists daily_stock_entries_updated_at_idx
  on public.daily_stock_entries(updated_at desc);

-- Note: the manager UI must query daily_stock_entries joined to profiles
-- (updated_by -> profiles.id) and audit_logs. Do not expose audit_logs to customers.
