-- Minimal, self-contained local harness for validating v149's SQL in
-- isolation -- stubs only the pre-existing objects v149 assumes already
-- exist (profiles, is_admin(), auth.uid()), matching the same convention
-- as test/sql/v146_revenue_funnel_harness.sql. Not the full 149-migration
-- history, given this migration's scope (three brand-new, independent
-- tables with no dependency on any other feature's schema).
drop schema if exists public cascade;
create schema public;
create extension if not exists pgcrypto;

drop schema if exists auth cascade;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select current_setting('app.current_uid', true)::uuid $$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  role text not null default 'student'
);

create or replace function public.is_admin(p_uid uuid default null)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.current_is_admin', true), 'false') = 'true';
$$;
