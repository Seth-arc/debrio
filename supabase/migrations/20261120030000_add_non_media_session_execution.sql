-- Title: Add non media session execution
-- Execution is separate from the existing admission lifecycle. No hosted
-- capacity or eligibility is granted by this migration.
create table public.session_execution (
  session_id uuid primary key references public.sessions(id),
  version_id uuid not null references public.workshop_versions(id),
  prepare_operation uuid not null unique,
  state text not null default 'ready' check (state in ('ready','live','paused','completed')),
  revision integer not null default 1 check (revision > 0),
  current_index integer not null default -1 check (current_index >= -1),
  completed_count integer not null default 0 check (completed_count >= 0),
  started_at timestamptz,
  deadline timestamptz,
  activity_due_at timestamptz,
  paused_seconds double precision,
  end_reason text check (end_reason in ('manual','deadline')),
  check ((started_at is null) = (deadline is null)),
  check (deadline is null or deadline = started_at + interval '4 hours')
);
create index session_execution_deadlines on public.session_execution(deadline)
  where state in ('live','paused');
create table public.execution_commands (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id),
  actor_id uuid not null references auth.users(id),
  request jsonb not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.execution_capacity (
  singleton boolean primary key default true check (singleton),
  max_live integer not null check (max_live > 0),
  valid_until timestamptz not null
);
create table public.execution_eligibility (
  workspace_id uuid primary key references public.workspaces(id),
  valid_until timestamptz not null
);
alter table public.session_execution enable row level security;
alter table public.execution_commands enable row level security;
alter table public.execution_capacity enable row level security;
alter table public.execution_eligibility enable row level security;
revoke all on public.session_execution, public.execution_commands,
  public.execution_capacity, public.execution_eligibility from public, anon, authenticated, service_role;

create function public.guard_execution_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.session_id,new.version_id,new.prepare_operation) is distinct from
     (old.session_id,old.version_id,old.prepare_operation)
     or (old.started_at is not null and (new.started_at,new.deadline) is distinct from (old.started_at,old.deadline)) then
    raise exception 'execution_identity_frozen';
  end if;
  return new;
end;
$$;
create trigger execution_identity_frozen before update on public.session_execution
  for each row execute function public.guard_execution_identity();

create function public.execution_problems(p_content jsonb) returns text[]
language plpgsql set search_path = '' as $$
declare v_problems text[] := public.workshop_problems(p_content); v_item record;
begin
  for v_item in select value, ordinality from jsonb_array_elements(p_content->'activities') with ordinality loop
    if v_item.value->>'scope' <> 'individual' then
      v_problems := array_append(v_problems, format('Activity %s needs group assignment, which is not available yet.',v_item.ordinality));
    end if;
    if v_item.value->'input' <> 'null'::jsonb then
      v_problems := array_append(v_problems, format('Activity %s needs a saved earlier answer, which is not available yet.',v_item.ordinality));
    end if;
  end loop;
  return v_problems;
end;
$$;

-- The effective end is authoritative even when the scheduled sweep is delayed.
create function public.effective_session(p_row public.sessions) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_deadline timestamptz;
begin
  select e.deadline into v_deadline from public.session_execution e where e.session_id = p_row.id;
  if v_deadline <= clock_timestamp() and (p_row.ended_at is null or p_row.ended_at > v_deadline) then
    p_row.state := 'ended'; p_row.ended_at := v_deadline;
  end if;
  return p_row;
end;
$$;
create or replace function public.require_owned_session(p_session uuid) returns public.sessions
language plpgsql volatile security definer set search_path = '' as $$
declare v_session public.sessions;
begin
  select s.* into v_session from public.sessions s where s.id = p_session;
  if not found or not public.owns_workspace(v_session.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return public.effective_session(v_session);
end;
$$;

create function public.prepare_execution(p_version uuid, p_operation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_version public.workshop_versions; v_workshop public.workshops; v_session uuid; v_existing public.session_execution; v_problems text[];
begin
  select v.* into v_version from public.workshop_versions v where v.id = p_version;
  select w.* into v_workshop from public.workshops w where w.id = v_version.workshop_id;
  if v_workshop.id is null or not public.owns_workspace(v_workshop.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_operation is null then raise exception 'invalid_operation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  select e.* into v_existing from public.session_execution e where e.prepare_operation = p_operation;
  if found then
    perform public.require_owned_session(v_existing.session_id);
    if v_existing.version_id <> p_version then raise exception 'operation_reused'; end if;
    return v_existing.session_id;
  end if;
  if v_version.state <> 'ready' then raise exception 'version_not_ready'; end if;
  v_problems := public.execution_problems(v_version.content);
  if cardinality(v_problems) > 0 then
    raise exception 'unsupported_agenda' using detail = array_to_string(v_problems,E'\n');
  end if;
  insert into public.sessions(workspace_id,title) values(v_workshop.workspace_id,v_workshop.title) returning id into v_session;
  insert into public.session_execution(session_id,version_id,prepare_operation) values(v_session,p_version,p_operation);
  return v_session;
end;
$$;

create function public.execution_start_problems(p_workspace uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_capacity public.execution_capacity; v_problems text[] := '{}'; v_now timestamptz := clock_timestamp();
begin
  select c.* into v_capacity from public.execution_capacity c where singleton;
  if not exists(select 1 from public.execution_eligibility g where g.workspace_id=p_workspace and g.valid_until>v_now) then
    v_problems := array_append(v_problems,'Hosting eligibility is unavailable. This session cannot start yet.');
  end if;
  if v_capacity.valid_until is null or v_capacity.valid_until <= v_now then
    v_problems := array_append(v_problems,'Verified hosting capacity is unavailable. Try again after it is restored.');
  elsif (select count(*) from public.session_execution e where e.state in ('live','paused') and e.deadline>v_now) >= v_capacity.max_live then
    v_problems := array_append(v_problems,'Hosting capacity is full. Existing sessions can continue.');
  end if;
  if (select count(*) from public.session_execution e join public.sessions s on s.id=e.session_id
      where s.workspace_id=p_workspace and e.state in ('live','paused') and e.deadline>v_now) >= 3 then
    v_problems := array_append(v_problems,'Three sessions are already live in this workspace. End one before starting another.');
  end if;
  return v_problems;
end;
$$;

-- Caller owns the session lock. Closing never rewrites a prior effective end.
create function public.close_execution(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_end timestamptz; v_deadline timestamptz;
begin
  select e.deadline into v_deadline from public.session_execution e where e.session_id=p_session;
  v_end := least(clock_timestamp(),v_deadline);
  update public.sessions set state='ended', ended_at=least(coalesce(ended_at,v_end),v_end)
    where id=p_session;
  update public.session_execution set state='completed', revision=revision+1,
    end_reason=case when v_deadline <= clock_timestamp() then 'deadline' else p_reason end
    where session_id=p_session and state<>'completed';
  update public.session_participants set state='denied', decided_at=v_end, decided_by=auth.uid()
    where session_id=p_session and state='waiting' and not is_return;
end;
$$;

create function public.execution_command(p_session uuid, p_operation uuid, p_revision integer, p_command text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.sessions; v_execution public.session_execution; v_content jsonb;
  v_request jsonb := jsonb_build_object('command',p_command,'revision',p_revision);
  v_previous public.execution_commands; v_result jsonb; v_problems text[]; v_now timestamptz;
begin
  perform public.require_owned_session(p_session);
  if p_operation is null or p_revision is null or p_revision < 1 or p_command is null
     or p_command not in ('start','pause','resume','next','end') then raise exception 'invalid_command'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  -- One global admission lock; count and admission commit in the same transaction.
  if p_command='start' then
    perform pg_advisory_xact_lock(748,202);
    perform 1 from public.execution_capacity where singleton for update;
  end if;
  perform 1 from public.sessions where id=p_session for update;
  v_session := public.require_owned_session(p_session);
  select * into v_previous from public.execution_commands where operation_id=p_operation;
  if found then
    if v_previous.session_id<>p_session or v_previous.actor_id<>auth.uid() or v_previous.request<>v_request then
      raise exception 'operation_reused';
    end if;
    return v_previous.receipt;
  end if;
  select * into v_execution from public.session_execution where session_id=p_session for update;
  if not found then raise exception 'execution_unavailable'; end if;
  v_now := clock_timestamp();
  if v_session.state='ended' or v_execution.deadline <= v_now then
    perform public.close_execution(p_session,'deadline');
    v_result := jsonb_build_object('ended',true);
    insert into public.execution_commands(operation_id,session_id,actor_id,request,receipt)
      values(p_operation,p_session,auth.uid(),v_request,v_result);
    return v_result;
  end if;
  if v_execution.revision<>p_revision then raise exception 'stale_execution'; end if;
  select content into v_content from public.workshop_versions where id=v_execution.version_id and state='ready';
  if v_content is null then raise exception 'version_not_ready'; end if;
  if p_command in ('start','next') then
    v_problems := public.execution_problems(v_content);
    if cardinality(v_problems)>0 then raise exception 'unsupported_agenda' using detail=array_to_string(v_problems,E'\n'); end if;
  end if;
  case p_command
    when 'start' then
      if v_execution.state<>'ready' then raise exception 'invalid_transition'; end if;
      v_problems := public.execution_start_problems(v_session.workspace_id);
      if cardinality(v_problems)>0 then raise exception 'start_blocked' using detail=array_to_string(v_problems,E'\n'); end if;
      update public.session_execution set state='live',started_at=v_now,deadline=v_now+interval '4 hours',current_index=0,
        activity_due_at=v_now+make_interval(mins => (v_content->'activities'->0->>'minutes')::integer)
        where session_id=p_session;
    when 'pause' then
      if v_execution.state<>'live' then raise exception 'invalid_transition'; end if;
      update public.session_execution set state='paused',paused_seconds=extract(epoch from activity_due_at-v_now),activity_due_at=null where session_id=p_session;
    when 'resume' then
      if v_execution.state<>'paused' then raise exception 'invalid_transition'; end if;
      update public.session_execution set state='live',activity_due_at=v_now+make_interval(secs => paused_seconds),paused_seconds=null where session_id=p_session;
    when 'next' then
      if v_execution.state<>'live' or v_execution.current_index+1>=jsonb_array_length(v_content->'activities') then raise exception 'invalid_transition'; end if;
      update public.session_execution set current_index=current_index+1,completed_count=completed_count+1,
        activity_due_at=v_now+make_interval(mins => (v_content->'activities'->(v_execution.current_index+1)->>'minutes')::integer)
        where session_id=p_session;
    when 'end' then perform public.close_execution(p_session,'manual');
  end case;
  if p_command<>'end' then update public.session_execution set revision=revision+1 where session_id=p_session; end if;
  select jsonb_build_object('revision',revision,'state',state) into v_result from public.session_execution where session_id=p_session;
  insert into public.execution_commands(operation_id,session_id,actor_id,request,receipt)
    values(p_operation,p_session,auth.uid(),v_request,v_result);
  return v_result;
end;
$$;

-- Bounded, repeatable sweep. No browser or host session is needed.
create function public.expire_executions() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_row record; v_count integer := 0;
begin
  for v_row in select s.id from public.sessions s join public.session_execution e on e.session_id=s.id
    where e.state in ('live','paused') and e.deadline<=clock_timestamp()
    order by e.deadline limit 100 for update of s skip locked loop
    perform public.close_execution(v_row.id,'deadline'); v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;

create function public.execution_snapshot(p_session uuid, p_host boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_e public.session_execution; v_s public.sessions; v_content jsonb; v_number integer; v_current jsonb; v_next jsonb; v_problems text[] := '{}'; v_now timestamptz := clock_timestamp();
begin
  select * into v_e from public.session_execution where session_id=p_session;
  if not found then return null; end if;
  select e.* into v_s from public.sessions s cross join lateral public.effective_session(s) e where s.id=p_session;
  select content,number into v_content,v_number from public.workshop_versions where id=v_e.version_id;
  if v_s.state='ended' then v_e.state:='completed'; end if;
  if v_e.state in ('live','paused') then v_current:=v_content->'activities'->v_e.current_index; end if;
  if p_host and v_e.state<>'completed' then
    v_next:=v_content->'activities'->(v_e.current_index+1);
    if v_e.state='ready' then v_problems:=public.execution_start_problems(v_s.workspace_id); end if;
  end if;
  return jsonb_build_object('session_id',p_session,'state',v_e.state,'revision',v_e.revision,'version_number',v_number,
    'current',v_current,'next',v_next,'started_at',v_e.started_at,'deadline',v_e.deadline,'ended_at',v_s.ended_at,
    'remaining_seconds',case when v_e.state='paused' then v_e.paused_seconds else extract(epoch from v_e.activity_due_at-v_now) end,
    'session_seconds',extract(epoch from v_e.deadline-v_now),'elapsed_seconds',extract(epoch from least(v_now,coalesce(v_s.ended_at,v_now))-v_e.started_at),
    'planned_before_minutes',(select coalesce(sum((a.value->>'minutes')::integer),0) from jsonb_array_elements(v_content->'activities') with ordinality a where a.ordinality<=v_e.current_index),
    'planned_minutes',(select sum((a->>'minutes')::integer) from jsonb_array_elements(v_content->'activities') a),
    'completed_count',v_e.completed_count,'activity_count',jsonb_array_length(v_content->'activities'),'blockers',v_problems);
end;
$$;
create function public.host_execution(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_owned_session(p_session);
  return public.execution_snapshot(p_session,true);
end;
$$;
create function public.guest_execution(p_session uuid,p_credential_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.guest_status(p_session,p_credential_hash) where participant_state='admitted') then return null; end if;
  return public.execution_snapshot(p_session,false);
end;
$$;

revoke all on function public.guard_execution_identity(),public.execution_problems(jsonb),public.effective_session(public.sessions),
  public.prepare_execution(uuid,uuid),public.execution_start_problems(uuid),public.close_execution(uuid,text),
  public.execution_command(uuid,uuid,integer,text),public.expire_executions(),public.execution_snapshot(uuid,boolean),
  public.host_execution(uuid),public.guest_execution(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_execution(uuid,uuid),public.execution_command(uuid,uuid,integer,text),public.host_execution(uuid) to authenticated;
grant execute on function public.guest_execution(uuid,text) to anon,authenticated;
grant execute on function public.expire_executions() to service_role;

-- Old admission-only clients can still close their sessions, but cannot bypass
-- revision/confirmation checks for newly bound execution sessions.
create or replace function public.end_session(p_session uuid) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_session public.sessions;
begin
  perform 1 from public.sessions where id=p_session for update;
  v_session := public.require_owned_session(p_session);
  if exists(select 1 from public.session_execution where session_id=p_session) and v_session.state<>'ended' then
    raise exception 'use_execution_controls';
  end if;
  perform public.close_execution(p_session,'manual');
  return public.require_owned_session(p_session);
end;
$$;


-- Preserve admission/recovery while enforcing the effective deadline.
create or replace function public.session_for_join(p_key text)
returns table (id uuid, title text, state text, locked boolean, can_return boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select s.id, s.title, s.state, s.locked, public.within_review_window(s.ended_at)
  from public.sessions raw cross join lateral public.effective_session(raw) s
  where s.join_key = p_key;
$$;

-- Preserve admission/recovery while enforcing the effective deadline.
create or replace function public.request_admission(
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
  v_session := public.effective_session(v_session);
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

-- Preserve admission/recovery while enforcing the effective deadline.
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
  perform 1 from public.sessions where id=v_participant.session_id for update;
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

-- Preserve admission/recovery while enforcing the effective deadline.
create or replace function public.restore_participant(p_request uuid, p_target uuid)
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
  perform 1 from public.sessions where id=(select session_id from public.session_participants where id=p_request) for update;
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

-- Preserve admission/recovery while enforcing the effective deadline.
create or replace function public.guest_status(p_session uuid, p_credential_hash text)
returns table (
  session_title text, session_state text, participant_state text, display_name text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select s.title, s.state, p.state, p.display_name
  from public.session_participants p
  join public.sessions raw on raw.id = p.session_id
  cross join lateral public.effective_session(raw) s
  where p.session_id = p_session
    and p.credential_hash = p_credential_hash
    and public.within_review_window(s.ended_at)
  union all
  select s.title, s.state, 'moved', p.display_name
  from public.participant_retired_credentials r
  join public.session_participants p on p.id = r.participant_id
  join public.sessions raw on raw.id = p.session_id
  cross join lateral public.effective_session(raw) s
  where p.session_id = p_session
    and r.credential_hash = p_credential_hash
    and public.within_review_window(s.ended_at);
$$;

create or replace function public.set_session_locked(p_session uuid, p_locked boolean)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  perform 1 from public.sessions where id=p_session for update;
  v_session := public.require_owned_session(p_session);
  if v_session.state <> 'open' then
    raise exception 'session_ended' using errcode = 'P0001';
  end if;
  update public.sessions set locked = p_locked where id = p_session
  returning * into v_session;
  return v_session;
end;
$$;

create or replace function public.replace_join_key(p_session uuid)
returns public.sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
begin
  perform 1 from public.sessions where id=p_session for update;
  v_session := public.require_owned_session(p_session);
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
