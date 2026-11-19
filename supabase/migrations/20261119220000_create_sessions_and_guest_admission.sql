-- Title: Create sessions and guest admission
-- P2-01c. Hosts (workspace owner with a live AAL2 session) run sessions through
-- owner-checked functions. Guests have no account: they reach a session only by
-- its join key, and their own state only by the hash of their private credential.

create function public.owns_workspace(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target and w.owner_id = auth.uid()
  ) and public.current_session_has_mfa();
$$;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  title text not null check (
    char_length(title) between 1 and 120 and title !~ '^[[:space:]]|[[:space:]]$'
  ),
  state text not null default 'open' check (state in ('open', 'ended')),
  locked boolean not null default false,
  -- A shareable lobby token, not a credential: the host still admits each person.
  join_key text not null unique
    default encode(extensions.gen_random_bytes(16), 'hex')
    check (join_key ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check ((state = 'ended') = (ended_at is not null))
);
create index sessions_workspace on public.sessions (workspace_id);

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete restrict,
  display_name text not null check (
    char_length(display_name) between 1 and 60
    and display_name !~ '^[[:space:]]|[[:space:]]$'
  ),
  state text not null default 'waiting'
    check (state in ('waiting', 'admitted', 'denied', 'removed')),
  -- SHA-256 of the guest's private credential; the credential itself is never stored.
  credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);
create index session_participants_session_state
  on public.session_participants (session_id, state);

alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;

create policy "Owners with MFA read their sessions"
  on public.sessions for select to authenticated
  using (public.owns_workspace(workspace_id));

create policy "Owners with MFA read their session participants"
  on public.session_participants for select to authenticated
  using (exists (
    select 1 from public.sessions s
    where s.id = session_id and public.owns_workspace(s.workspace_id)
  ));

-- Supabase grants new tables to anon/authenticated by default; reads only, writes via functions.
revoke all on public.sessions, public.session_participants from public, anon, authenticated;
grant select on public.sessions, public.session_participants to authenticated;

-- Host helper: the caller's open-or-ended session, or a permission error that
-- does not reveal whether the session exists.
create function public.require_owned_session(p_session uuid)
returns public.sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  select s.* into v_session from public.sessions s where s.id = p_session;
  if not found or not public.owns_workspace(v_session.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_session;
end;
$$;

create function public.create_session(p_title text)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_session public.sessions;
begin
  select w.id into v_workspace from public.workspaces w where w.owner_id = auth.uid();
  if v_workspace is null or not public.current_session_has_mfa() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.sessions (workspace_id, title)
  values (v_workspace, p_title)
  returning * into v_session;
  return v_session;
end;
$$;

create function public.set_session_locked(p_session uuid, p_locked boolean)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := public.require_owned_session(p_session);
begin
  if v_session.state <> 'open' then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  update public.sessions set locked = p_locked where id = p_session
  returning * into v_session;
  return v_session;
end;
$$;

create function public.replace_join_key(p_session uuid)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := public.require_owned_session(p_session);
begin
  if v_session.state <> 'open' then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  update public.sessions
  set join_key = encode(extensions.gen_random_bytes(16), 'hex')
  where id = p_session
  returning * into v_session;
  return v_session;
end;
$$;

create function public.end_session(p_session uuid)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions := public.require_owned_session(p_session);
begin
  update public.sessions set state = 'ended', ended_at = now()
  where id = p_session and state = 'open'
  returning * into v_session;
  -- Ending twice is a no-op.
  return coalesce(v_session, public.require_owned_session(p_session));
end;
$$;

create function public.decide_participant(p_participant uuid, p_decision text)
returns public.session_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.session_participants;
  v_session public.sessions;
  v_target text := case p_decision
    when 'admit' then 'admitted' when 'deny' then 'denied' when 'remove' then 'removed'
  end;
  v_from text := case p_decision when 'remove' then 'admitted' else 'waiting' end;
begin
  select p.* into v_participant from public.session_participants p where p.id = p_participant;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_session := public.require_owned_session(v_participant.session_id);
  if v_target is null then
    raise exception 'unknown_decision' using errcode = '22023';
  end if;
  if v_session.state <> 'open' then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  update public.session_participants
  set state = v_target, decided_at = now(), decided_by = auth.uid()
  where id = p_participant and state = v_from
  returning * into v_participant;
  if found then
    return v_participant;
  end if;
  -- A repeated or concurrent identical decision is a no-op; anything else is refused.
  select p.* into v_participant from public.session_participants p where p.id = p_participant;
  if v_participant.state = v_target then
    return v_participant;
  end if;
  raise exception 'invalid_transition' using errcode = 'P0001';
end;
$$;

-- Guest: what a join link points at (nothing for an unknown or replaced key).
create function public.session_for_join(p_key text)
returns table (id uuid, title text, state text, locked boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.state, s.locked from public.sessions s where s.join_key = p_key;
$$;

-- Guest: ask to be let in. The session row lock serialises joins, so the
-- waiting limit holds under concurrency.
create function public.request_admission(
  p_key text, p_display_name text, p_credential_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  select s.* into v_session from public.sessions s where s.join_key = p_key for update;
  if not found then
    raise exception 'unknown_link' using errcode = 'P0001';
  end if;
  if v_session.state <> 'open' then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  if v_session.locked then
    raise exception 'session_locked' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.session_participants p
    where p.session_id = v_session.id and p.state = 'waiting'
  ) >= 100 then
    raise exception 'lobby_full' using errcode = 'P0001';
  end if;
  insert into public.session_participants (session_id, display_name, credential_hash)
  values (v_session.id, p_display_name, p_credential_hash);
  return v_session.id;
end;
$$;

-- Guest: their own state in one session, evaluated on every request. Nothing is
-- returned for another session's credential or after the 90-day retention period.
create function public.guest_status(p_session uuid, p_credential_hash text)
returns table (
  session_title text, session_state text, participant_state text, display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.title, s.state, p.state, p.display_name
  from public.session_participants p
  join public.sessions s on s.id = p.session_id
  where p.session_id = p_session
    and p.credential_hash = p_credential_hash
    and (s.ended_at is null or s.ended_at > now() - interval '90 days');
$$;

-- Supabase grants new functions to anon/authenticated by default; narrow them.
revoke all on function
  public.owns_workspace(uuid),
  public.require_owned_session(uuid),
  public.create_session(text),
  public.set_session_locked(uuid, boolean),
  public.replace_join_key(uuid),
  public.end_session(uuid),
  public.decide_participant(uuid, text),
  public.session_for_join(text),
  public.request_admission(text, text, text),
  public.guest_status(uuid, text)
from public, anon, authenticated;

-- Row policies call owns_workspace as the requesting user.
grant execute on function public.owns_workspace(uuid) to authenticated;
grant execute on function
  public.create_session(text),
  public.set_session_locked(uuid, boolean),
  public.replace_join_key(uuid),
  public.end_session(uuid),
  public.decide_participant(uuid, text)
to authenticated;
grant execute on function
  public.session_for_join(text),
  public.request_admission(text, text, text),
  public.guest_status(uuid, text)
to anon, authenticated;
