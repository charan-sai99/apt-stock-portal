-- READ-ONLY. Run in the Supabase SQL editor BEFORE applying migration 0003 to see
-- what already exists in the remote project. Changes nothing.

-- 1. Which portal tables exist and how many rows they hold
select t.table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text::int as row_count
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_name in ('profiles','zoho_items','daily_reports','daily_stock_entries','audit_logs',
                       'app_settings','report_amendments','zoho_sync_runs','zoho_oauth_tokens')
order by 1;

-- 2. Is 0002 applied? (trigger name from 0002 — 0003 replaces it with two new triggers)
select tgname from pg_trigger where tgrelid = 'public.daily_stock_entries'::regclass and not tgisinternal;

-- 3. Is 0003 already applied?
select exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='daily_reports' and column_name='version') as has_0003;

-- 4. Existing RLS policies
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2;

-- 5. Supabase CLI migration history (empty/absent if migrations were pasted into the SQL editor)
select * from supabase_migrations.schema_migrations order by version;
