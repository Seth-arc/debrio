-- Title: Enforce current work host session
-- Auth revocation serializes with work; absolute host expiry is checked after lock waits.
-- A nullable composite foreign key alone cannot require a predecessor ordinal.
alter table public.work_attempts add constraint work_attempt_predecessor_required
  check(ordinal=1 or preceding_ordinal is not null);

create or replace function public.authorize_work(p_session uuid,p_participant uuid,p_hash text,p_host boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.sessions; person public.session_participants;
begin
  select * into s from public.sessions where id=p_session for share;
  if not found then raise exception 'not_allowed' using errcode='42501'; end if;
  s:=public.effective_session(s);
  if s.ended_at is not null and s.ended_at<=clock_timestamp()-interval '90 days' then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if p_host then
    perform 1 from public.workspaces where id=s.workspace_id for share;
    if not public.owns_workspace(s.workspace_id) then raise exception 'not_allowed' using errcode='42501'; end if;

    select * into person from public.session_participants where session_id=p_session and id=p_participant for share;
  else
    select * into person from public.session_participants where session_id=p_session and credential_hash=p_hash for share;
  end if;
  if not (p_host and p_participant is null) and (person.id is null or person.state<>'admitted' or (p_participant is not null and person.id<>p_participant)) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if p_host then
    perform 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid for share;
  end if;
  s:=public.effective_session(s);
  if (s.ended_at is not null and s.ended_at<=clock_timestamp()-interval '90 days') or (p_host and (not public.owns_workspace(s.workspace_id) or not exists (
    select 1 from auth.sessions a where a.id=nullif(auth.jwt()->>'session_id','')::uuid and a.user_id=auth.uid() and a.aal='aal2'
      and (a.not_after is null or a.not_after>clock_timestamp())
      and (auth.jwt()->>'exp')::numeric>extract(epoch from clock_timestamp())
  ))) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  return case when p_host then auth.uid() else person.id end;
end;
$$;
