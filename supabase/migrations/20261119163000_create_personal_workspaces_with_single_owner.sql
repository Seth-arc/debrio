-- Title: Create personal workspaces with single owner
-- P2-01a. Owners need an Auth session that still exists at AAL2 (TOTP).

create function public.current_session_has_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and s.aal = 'aal2'
        and (s.not_after is null or s.not_after > now())
    );
$$;

revoke all on function public.current_session_has_mfa() from public, anon;
grant execute on function public.current_session_has_mfa() to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Exactly one primary owner per workspace; an owner account cannot be deleted out from under it.
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

-- shortcut: one owned workspace per account, which makes create idempotent; drop when the multi-workspace switcher lands.
create unique index workspaces_one_per_owner on public.workspaces (owner_id);

alter table public.workspaces enable row level security;

create policy "Owners with MFA read their workspace"
  on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.current_session_has_mfa()));

create policy "Owners with MFA create their workspace"
  on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.current_session_has_mfa()));

-- Supabase grants new public tables to anon/authenticated by default; allow only these.
revoke all on public.workspaces from public, anon, authenticated;
grant select on public.workspaces to authenticated;
grant insert (name) on public.workspaces to authenticated;
