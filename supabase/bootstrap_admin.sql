-- Create the FIRST administrator (run once in the Supabase SQL editor).
-- 1. Supabase Dashboard > Authentication > Users > "Add user" > "Create new user":
--    enter the manager's email + a strong password, tick "Auto Confirm User".
-- 2. Replace the email and name below, then run this script.
-- After this, all other users (operators, customer) are created from the portal: Admin > Users & access.
insert into public.profiles (id, display_name, role, email, is_active)
select id, 'Factory Manager', 'admin', email, true
from auth.users
where email = 'manager@example.com'
on conflict (id) do update set role = 'admin', is_active = true, operator_slot = null;

-- Check:
select id, display_name, role, email, is_active from public.profiles where role = 'admin';
