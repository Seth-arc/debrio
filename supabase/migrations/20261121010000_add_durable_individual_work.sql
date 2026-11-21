-- Title: Add durable individual work
-- Additive Evidence storage; legacy execution and frozen agendas are unchanged.
alter table public.session_participants add constraint participant_session_identity unique(session_id,id);
alter table public.session_execution add constraint execution_version_identity unique(session_id,version_id);

create table public.work_items (
  session_id uuid not null,
  participant_id uuid not null,
  activity_id text not null,
  version_id uuid not null,
  revision integer not null default 0 check(revision>=0),
  content jsonb not null default '{}',
  saved_at timestamptz,
  latest integer not null default 0 check(latest>=0),
  window_revision integer not null default 0 check(window_revision>=0),
  reopened boolean not null default false,
  primary key(session_id,participant_id,activity_id),
  foreign key(session_id,participant_id) references public.session_participants(session_id,id),
  foreign key(session_id,version_id) references public.session_execution(session_id,version_id),
  check(jsonb_typeof(content)='object'),
  check((revision=0)=(saved_at is null))
);
create table public.work_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  participant_id uuid not null,
  activity_id text not null,
  submitted_by uuid not null,
  ordinal integer not null check(ordinal>0),
  preceding_id uuid,
  preceding_ordinal integer,
  draft_revision integer not null check(draft_revision>0),
  content jsonb not null,
  missing text[] not null,
  reason text not null,
  submitted_at timestamptz not null default clock_timestamp(),
  foreign key(session_id,participant_id,activity_id) references public.work_items(session_id,participant_id,activity_id),
  check(submitted_by=participant_id),
  check((ordinal=1 and preceding_id is null and preceding_ordinal is null) or
    (ordinal>1 and preceding_id is not null and preceding_ordinal=ordinal-1)),
  unique(session_id,participant_id,activity_id,ordinal),
  unique(session_id,participant_id,activity_id,ordinal,id),
  foreign key(session_id,participant_id,activity_id,preceding_ordinal,preceding_id)
    references public.work_attempts(session_id,participant_id,activity_id,ordinal,id)
);
create table public.work_partial_acceptances (
  attempt_id uuid primary key references public.work_attempts(id),
  actor_id uuid not null references auth.users(id),
  reason text not null check(char_length(reason) between 1 and 500),
  accepted_at timestamptz not null default clock_timestamp()
);
create table public.work_commands (
  operation_id uuid primary key,
  session_id uuid not null,
  participant_id uuid not null,
  activity_id text not null,
  actor_id uuid not null,
  command text not null,
  request_digest text not null,
  reason text not null,
  receipt jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(session_id,participant_id,activity_id) references public.work_items(session_id,participant_id,activity_id)
);
alter table public.work_items enable row level security;
alter table public.work_attempts enable row level security;
alter table public.work_partial_acceptances enable row level security;
alter table public.work_commands enable row level security;
revoke all on public.work_items,public.work_attempts,public.work_partial_acceptances,public.work_commands from public,anon,authenticated,service_role;

create function public.freeze_work_version() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'submitted_version_frozen'; end;
$$;
create trigger freeze_work_attempt before update on public.work_attempts for each row execute function public.freeze_work_version();
create trigger freeze_partial_acceptance before update on public.work_partial_acceptances for each row execute function public.freeze_work_version();
create trigger freeze_work_receipt before update on public.work_commands for each row execute function public.freeze_work_version();

-- Session-first locking matches execution, removal and verified device recovery.
-- Called only by the narrow projections/commands below, never directly by clients.
create function public.authorize_work(p_session uuid,p_participant uuid,p_hash text,p_host boolean) returns uuid
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
    if p_participant is null then return auth.uid(); end if;
    select * into person from public.session_participants where session_id=p_session and id=p_participant for share;
  else
    select * into person from public.session_participants where session_id=p_session and credential_hash=p_hash for share;
  end if;
  if person.id is null or person.state<>'admitted' or (p_participant is not null and person.id<>p_participant) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  return case when p_host then auth.uid() else person.id end;
end;
$$;

create function public.work_snapshot(p_session uuid,p_participant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.session_execution; s public.sessions; agenda jsonb; result jsonb;
begin
  select * into e from public.session_execution where session_id=p_session;
  select * into s from public.sessions where id=p_session;
  s:=public.effective_session(s);
  if e.session_id is null then return null; end if;
  select content into agenda from public.workshop_versions where id=e.version_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'participant',p.id,'name',p.display_name,'activity',a.value,'index',a.ordinality-1,
    'revision',coalesce(w.revision,0),'content',coalesce(w.content,'{}'::jsonb),'saved_at',w.saved_at,
    'latest',coalesce(w.latest,0),'window_revision',coalesce(w.window_revision,0),'reopened',coalesce(w.reopened,false),
    'writable',s.state='open' and e.state in ('live','paused') and e.deadline>clock_timestamp() and p.state='admitted'
      and (a.ordinality-1=e.current_index or coalesce(w.reopened,false)),
    'attempts',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('acceptance',
      (select to_jsonb(ac) from public.work_partial_acceptances ac where ac.attempt_id=t.id)) order by t.ordinal)
      from public.work_attempts t where t.session_id=p_session and t.participant_id=p.id and t.activity_id=a.value->>'id'),'[]'::jsonb)
  ) order by p.requested_at,p.id,a.ordinality),'[]'::jsonb) into result
  from public.session_participants p cross join lateral jsonb_array_elements(agenda->'activities') with ordinality a
  left join public.work_items w on w.session_id=p_session and w.participant_id=p.id and w.activity_id=a.value->>'id'
  where p.session_id=p_session and (p_participant is null or p.id=p_participant)
    and p.state in ('admitted','removed') and a.ordinality-1<=e.current_index;
  return jsonb_build_object('session',p_session,'version',e.version_id,'current_index',e.current_index,
    'execution_revision',e.revision,'ended',s.state='ended','items',result);
end;
$$;
create function public.read_work(p_session uuid,p_credential_hash text default null,p_host boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
  return public.work_snapshot(p_session,case when p_host then null else actor end);
end;
$$;

create function public.work_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  cmd text:=p_request->>'command'; person uuid; actor uuid; is_host boolean;
  e public.session_execution; s public.sessions; w public.work_items; old public.work_commands;
  activity jsonb; field jsonb; normalized jsonb:='{}'; value text; missing text[]:='{}';
  previous public.work_attempts; attempt public.work_attempts; reason text; digest text; receipt jsonb;
begin
  if p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>262144
    or p_operation is null or cmd is null or cmd not in ('save','submit','submit_incomplete','accept_partial','reopen','close')
    or p_request-ARRAY['command','participant','activity','version','revision','latest','window_revision','content','reason']<>'{}'::jsonb then
    raise exception 'invalid_work';
  end if;
  person:=(p_request->>'participant')::uuid;
  if person is null then raise exception 'not_allowed' using errcode='42501'; end if;
  is_host:=cmd in ('accept_partial','reopen','close');
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  perform 1 from public.sessions where id=p_session for update;
  actor:=public.authorize_work(p_session,person,p_credential_hash,is_host);
  select * into e from public.session_execution where session_id=p_session;
  select * into s from public.sessions where id=p_session;
  s:=public.effective_session(s);
  if e.session_id is null or e.version_id::text is distinct from p_request->>'version' then raise exception 'invalid_work'; end if;
  select a.value into activity from public.workshop_versions v,
    lateral jsonb_array_elements(v.content->'activities') with ordinality a
    where v.id=e.version_id and a.value->>'id'=p_request->>'activity' and a.ordinality-1<=e.current_index;
  if activity is null or activity->>'scope'<>'individual' or activity->'input'<>'null'::jsonb then raise exception 'work_closed'; end if;
  reason:=replace(coalesce(p_request->>'reason',''),E'\r\n',E'\n');
  if char_length(reason)>500 then raise exception 'invalid_work'; end if;
  if cmd='save' then
    if jsonb_typeof(p_request->'content') is distinct from 'object' then raise exception 'invalid_work'; end if;
    if exists(select 1 from jsonb_object_keys(p_request->'content') k where not exists
      (select 1 from jsonb_array_elements(activity->'outputs') f where f->>'id'=k)) then raise exception 'invalid_work'; end if;
    for field in select value from jsonb_array_elements(activity->'outputs') loop
      if p_request->'content' ? (field->>'id') and jsonb_typeof(p_request->'content'->(field->>'id'))<>'string' then raise exception 'invalid_work'; end if;
      value:=replace(coalesce(p_request->'content'->>(field->>'id'),''),E'\r\n',E'\n');
      if char_length(value)>(case when field->>'kind'='short' then 500 else 5000 end) then raise exception 'invalid_work'; end if;
      normalized:=normalized||jsonb_build_object(field->>'id',value);
    end loop;
    p_request:=jsonb_set(p_request,'{content}',normalized);
  elsif p_request ? 'content' then raise exception 'invalid_work'; end if;
  p_request:=jsonb_set(p_request,'{reason}',to_jsonb(reason));
  digest:=encode(extensions.digest(p_request::text,'sha256'),'hex');
  select * into old from public.work_commands where operation_id=p_operation;
  if found then
    if (old.session_id,old.participant_id,old.actor_id,old.request_digest) is distinct from (p_session,person,actor,digest) then raise exception 'operation_reused'; end if;
    return old.receipt;
  end if;
  if s.state<>'open' or e.state not in ('live','paused') or e.deadline<=clock_timestamp() then raise exception 'work_closed'; end if;
  insert into public.work_items(session_id,participant_id,activity_id,version_id)
    values(p_session,person,activity->>'id',e.version_id) on conflict do nothing;
  select * into w from public.work_items where session_id=p_session and participant_id=person and activity_id=activity->>'id' for update;
  if w.window_revision is distinct from (p_request->>'window_revision')::integer then raise exception 'work_conflict'; end if;
  if cmd in ('reopen','close') then
    if activity->>'id'=(select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id)
      or reason !~ '[^[:space:]]' then raise exception 'invalid_work'; end if;
    update public.work_items set reopened=cmd='reopen',window_revision=window_revision+1
      where session_id=p_session and participant_id=person and activity_id=w.activity_id;
  else
    if not w.reopened and activity->>'id'<>(select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id) then raise exception 'work_closed'; end if;
    if cmd='save' then
      if w.revision is distinct from (p_request->>'revision')::integer then raise exception 'work_conflict'; end if;
      update public.work_items set content=normalized,revision=revision+1,saved_at=clock_timestamp()
        where session_id=p_session and participant_id=person and activity_id=w.activity_id;
    else
      if w.latest is distinct from (p_request->>'latest')::integer then raise exception 'work_conflict'; end if;
      select * into previous from public.work_attempts where session_id=p_session and participant_id=person and activity_id=w.activity_id and ordinal=w.latest;
      if cmd='accept_partial' then
        if previous.id is null or cardinality(previous.missing)=0 or reason !~ '[^[:space:]]'
          or exists(select 1 from public.work_partial_acceptances where attempt_id=previous.id) then raise exception 'invalid_work'; end if;
        insert into public.work_partial_acceptances(attempt_id,actor_id,reason) values(previous.id,actor,reason);
      else
        if w.revision=0 or w.revision is distinct from (p_request->>'revision')::integer then raise exception 'work_conflict'; end if;
        if w.latest>0 and reason !~ '[^[:space:]]' then raise exception 'invalid_work'; end if;
        select coalesce(array_agg(f->>'id'),'{}') into missing from jsonb_array_elements(activity->'outputs') f where coalesce(w.content->>(f->>'id'),'') !~ '[^[:space:]]';
        if cardinality(missing)=jsonb_array_length(activity->'outputs') or
          (cmd='submit' and cardinality(missing)>0) or (cmd='submit_incomplete' and cardinality(missing)=0) then raise exception 'incomplete_work'; end if;
        insert into public.work_attempts(session_id,participant_id,activity_id,submitted_by,ordinal,preceding_id,preceding_ordinal,draft_revision,content,missing,reason)
          values(p_session,person,w.activity_id,person,w.latest+1,previous.id,previous.ordinal,w.revision,w.content,missing,reason) returning * into attempt;
        update public.work_items set latest=latest+1 where session_id=p_session and participant_id=person and activity_id=w.activity_id;
      end if;
    end if;
  end if;
  select jsonb_build_object('revision',revision,'latest',latest,'window_revision',window_revision,'attempt',attempt.id) into receipt
    from public.work_items where session_id=p_session and participant_id=person and activity_id=w.activity_id;
  insert into public.work_commands(operation_id,session_id,participant_id,activity_id,actor_id,command,request_digest,reason,receipt)
    values(p_operation,p_session,person,w.activity_id,actor,cmd,digest,reason,receipt);
  return receipt;
end;
$$;
revoke all on function public.freeze_work_version(),public.authorize_work(uuid,uuid,text,boolean),public.work_snapshot(uuid,uuid),
  public.read_work(uuid,text,boolean),public.work_command(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.read_work(uuid,text,boolean),public.work_command(uuid,uuid,jsonb,text) to anon,authenticated;
