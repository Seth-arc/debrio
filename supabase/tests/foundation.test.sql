-- Disposable database harness only; this is not an application migration.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select has_schema('auth', 'Supabase auth schema is available');
select has_role('anon', 'Supabase anonymous role is available');
select has_role('authenticated', 'Supabase authenticated role is available');
select * from finish();
rollback;
