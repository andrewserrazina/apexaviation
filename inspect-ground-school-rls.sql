-- Run this whole block in the Supabase SQL Editor and paste back everything
-- it returns (all four result sets). This is read-only, changes nothing.

-- 1. Column definitions for both tables
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('ground_sessions', 'ground_registrations')
order by table_name, ordinal_position;

-- 2. RLS enabled/disabled status
select schemaname, tablename, rowsecurity, forcerowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('ground_sessions', 'ground_registrations');

-- 3. Every existing policy on both tables
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('ground_sessions', 'ground_registrations')
order by tablename, policyname;

-- 4. Constraints (PK/FK/unique/check) -- helps confirm the token columns,
-- FK to profiles if any, and any existing uniqueness rules
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.ground_sessions'::regclass, 'public.ground_registrations'::regclass)
order by table_name, contype;

-- 5. Grants -- confirms what the anon/authenticated/service_role DB roles
-- can do at the table-privilege level, independent of RLS
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('ground_sessions', 'ground_registrations')
order by table_name, grantee, privilege_type;
