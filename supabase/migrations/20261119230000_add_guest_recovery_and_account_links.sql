-- Title: Add guest recovery and account links
-- P2-01d. A returning person asks through the lobby; the host verifies them and
-- restores their existing identity onto the new device, retiring the old
-- credential. Joining while signed in records the account, which grants nothing.

alter table public.session_participants
  add column is_return boolean not null default false,
  add column account_id uuid references auth.users (id) on delete set null,
  add column restored_into uuid references public.session_participants (id),
  alter column credential_hash drop not null,
  drop constraint session_participants_state_check,
  add constraint session_participants_state_check
    check (state in ('waiting', 'admitted', 'denied', 'removed', 'restored')),
  -- Only a restored request has no credential (it was handed over) and a target.
  add constraint session_participants_credential_check
    check ((state = 'restored') = (credential_hash is null)),
  add constraint session_participants_restored_into_check
    check ((state = 'restored') = (restored_into is not null));

-- Credentials replaced by a restore. Never accepted again; recognised only so the
-- old device can be told its place moved.
create table public.participant_retired_credentials (
  credential_hash text primary key check (credential_hash ~ '^[0-9a-f]{64}$'),
  participant_id uuid not null references public.session_participants (id),
  retired_at timestamptz not null default now()
);
alter table public.participant_retired_credentials enable row level security;
revoke all on public.participant_retired_credentials from public, anon, authenticated;

-- One definition of the review period after a session ends (PRD session retention).
create function public.within_review_window(p_ended_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_ended_at is null or p_ended_at > now() - interval '90 days';
$$;

-- Joining is reachable by a returning person while the lobby is closed and
-- after the session ends (within its review window); new people are not.
drop function public.session_for_join(text);
create function public.session_for_join(p_key text)
returns table (id uuid, title text, state text, locked boolean, can_return boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.title, s.state, s.locked, public.within_review_window(s.ended_at)
  from public.sessions s
  where s.join_key = p_key;
$$;

drop function public.request_admission(text, text, text);
-- shortcut: flood control is the per-session waiting cap only (hosts can close the
-- lobby or replace the link); add per-client rate limiting at the edge before join
-- links are shared publicly at scale. The cap also bounds returning requests on
-- ended sessions.
create function public.request_admission(
  p_key text, p_display_name text, p_credential_hash text,
  p_returning boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  -- Every request carries a fresh credential; a retired one is never accepted again.
  if p_credential_hash is null or exists (
    select 1 from public.participant_retired_credentials r
    where r.credential_hash = p_credential_hash
  ) then
    raise exception 'invalid_credential' using errcode = '22023';
  end if;
  select s.* into v_session from public.sessions s where s.join_key = p_key for update;
  if not found then
    raise exception 'unknown_link' using errcode = 'P0001';
  end if;
  if v_session.state <> 'open'
    and not (p_returning and public.within_review_window(v_session.ended_at)) then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  if v_session.locked and not p_returning then
    raise exception 'session_locked' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.session_participants p
    where p.session_id = v_session.id and p.state = 'waiting'
  ) >= 100 then
    raise exception 'lobby_full' using errcode = 'P0001';
  end if;
  -- auth.uid() is null for guests and comes from a verified token otherwise.
  insert into public.session_participants (
    session_id, display_name, credential_hash, is_return, account_id
  )
  values (v_session.id, p_display_name, p_credential_hash, p_returning, auth.uid());
  return v_session.id;
end;
$$;

-- Ending a session turns away anyone still waiting to be let in as new; only
-- returning requests may still be decided afterwards.
create or replace function public.end_session(p_session uuid)
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
  -- Ending twice is a no-op that returns the already-ended session.
  if not found then
    return public.require_owned_session(p_session);
  end if;
  update public.session_participants
  set state = 'denied', decided_at = now(), decided_by = auth.uid()
  where session_id = p_session and state = 'waiting' and not is_return;
  return v_session;
end;
$$;

-- Ended sessions accept only one decision: denying a returning request within
-- the review window.
create or replace function public.decide_participant(p_participant uuid, p_decision text)
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
  if v_session.state <> 'open' and not (
    p_decision = 'deny' and v_participant.is_return
    and public.within_review_window(v_session.ended_at)
  ) then
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
  raise exception 'invalid_transition'
    using errcode = 'P0001', detail = v_participant.state;
end;
$$;

-- The host moves a returning request's credential onto an admitted identity.
create function public.restore_participant(p_request uuid, p_target uuid)
returns public.session_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.session_participants;
  v_target public.session_participants;
  v_session public.sessions;
  v_credential text;
begin
  -- Lock both rows in a fixed order so concurrent restores cannot deadlock.
  perform 1 from public.session_participants p
  where p.id in (p_request, p_target) order by p.id for update;
  select p.* into v_request from public.session_participants p where p.id = p_request;
  select p.* into v_target from public.session_participants p where p.id = p_target;
  if v_request.id is null or v_target.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_session := public.require_owned_session(v_request.session_id);
  if v_target.session_id <> v_request.session_id then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not public.within_review_window(v_session.ended_at) then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  if v_request.state <> 'waiting' or not v_request.is_return then
    raise exception 'not_a_return_request' using errcode = 'P0001', detail = v_request.state;
  end if;
  if v_target.state <> 'admitted' then
    raise exception 'cannot_restore_into' using errcode = 'P0001', detail = v_target.state;
  end if;
  v_credential := v_request.credential_hash;
  insert into public.participant_retired_credentials (credential_hash, participant_id)
  values (v_target.credential_hash, v_target.id);
  update public.session_participants
  set state = 'restored', credential_hash = null, restored_into = v_target.id,
      decided_at = now(), decided_by = auth.uid()
  where id = v_request.id;
  update public.session_participants
  set credential_hash = v_credential
  where id = v_target.id
  returning * into v_target;
  return v_target;
end;
$$;

-- A retired credential sees only that its place moved, never the place itself;
-- neither answers after the review window.
drop function public.guest_status(uuid, text);
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
    and public.within_review_window(s.ended_at)
  union all
  select s.title, s.state, 'moved', p.display_name
  from public.participant_retired_credentials r
  join public.session_participants p on p.id = r.participant_id
  join public.sessions s on s.id = p.session_id
  where p.session_id = p_session
    and r.credential_hash = p_credential_hash
    and public.within_review_window(s.ended_at);
$$;

-- The host's lobby and participant list, with a linked account's email as
-- verification evidence. Never returns credential hashes or account IDs.
create function public.session_people(p_session uuid)
returns table (
  id uuid, display_name text, state text, is_return boolean,
  requested_at timestamptz, account_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_owned_session(p_session);
  return query
    select p.id, p.display_name, p.state, p.is_return, p.requested_at, u.email::text
    from public.session_participants p
    left join auth.users u on u.id = p.account_id
    where p.session_id = p_session
    order by p.requested_at;
end;
$$;

revoke all on function
  public.within_review_window(timestamptz),
  public.session_for_join(text),
  public.request_admission(text, text, text, boolean),
  public.end_session(uuid),
  public.decide_participant(uuid, text),
  public.restore_participant(uuid, uuid),
  public.guest_status(uuid, text),
  public.session_people(uuid)
from public, anon, authenticated;
grant execute on function
  public.end_session(uuid),
  public.decide_participant(uuid, text),
  public.restore_participant(uuid, uuid),
  public.session_people(uuid)
to authenticated;
grant execute on function
  public.session_for_join(text),
  public.request_admission(text, text, text, boolean),
  public.guest_status(uuid, text)
to anon, authenticated;
