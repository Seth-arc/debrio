-- Title: Add durable group Evidence and recorder execution
-- One atomic feature migration; deployed prerequisite migrations are unchanged.

-- Existing individual keys and payloads remain valid during a rolling upgrade.
alter table public.work_items add column group_id uuid;
alter table public.work_attempts add column group_id uuid;
alter table public.work_commands add column group_id uuid;
alter table public.work_attempts alter column participant_id drop not null;
alter table public.work_commands alter column participant_id drop not null;
alter table public.work_items add column owner_id uuid generated always as (coalesce(participant_id,group_id)) stored;
alter table public.work_attempts add column owner_id uuid generated always as (coalesce(participant_id,group_id)) stored;
alter table public.work_commands add column owner_id uuid generated always as (coalesce(participant_id,group_id)) stored;
alter table public.work_items add column owner_kind text generated always as (case when participant_id is not null then 'individual' else 'group' end) stored;
alter table public.work_attempts add column owner_kind text generated always as (case when participant_id is not null then 'individual' else 'group' end) stored;
alter table public.work_items add constraint work_owner_xor check ((participant_id is null)<>(group_id is null));
alter table public.work_attempts add constraint attempt_owner_xor check ((participant_id is null)<>(group_id is null));
alter table public.work_commands add constraint command_owner_xor check ((participant_id is null)<>(group_id is null));
alter table public.work_items add foreign key(session_id,group_id) references public.session_groups(session_id,id);
alter table public.work_attempts add foreign key(session_id,group_id) references public.session_groups(session_id,id);
alter table public.work_commands add foreign key(session_id,group_id) references public.session_groups(session_id,id);
do $$ declare c record; begin
  for c in select conrelid::regclass as tbl,conname from pg_constraint where contype='f' and confrelid='public.work_items'::regclass loop
    execute format('alter table %s drop constraint %I',c.tbl,c.conname);
  end loop;
end $$;
alter table public.work_items drop constraint work_items_pkey;
alter table public.work_items alter column participant_id drop not null;
alter table public.work_items add primary key(session_id,owner_id,activity_id);
alter table public.work_items add unique(session_id,participant_id,activity_id);
alter table public.work_items add unique(session_id,group_id,activity_id);
alter table public.work_attempts add foreign key(session_id,participant_id,activity_id) references public.work_items(session_id,participant_id,activity_id);
alter table public.work_commands add foreign key(session_id,participant_id,activity_id) references public.work_items(session_id,participant_id,activity_id);
alter table public.work_attempts add foreign key(session_id,group_id,activity_id) references public.work_items(session_id,group_id,activity_id);
alter table public.work_commands add foreign key(session_id,group_id,activity_id) references public.work_items(session_id,group_id,activity_id);
alter table public.work_attempts add unique(session_id,owner_id,activity_id,ordinal);
alter table public.work_attempts add unique(session_id,owner_id,activity_id,ordinal,id);
alter table public.work_attempts add foreign key(session_id,owner_id,activity_id,preceding_ordinal,preceding_id)
  references public.work_attempts(session_id,owner_id,activity_id,ordinal,id);
alter table public.work_attempts add foreign key(session_id,submitted_by) references public.session_participants(session_id,id);
alter table public.work_items add column group_token uuid not null default gen_random_uuid();
alter table public.work_items add column lineage jsonb not null default '{}';
alter table public.work_attempts add column snapshot jsonb;
alter table public.work_attempts add column audience uuid[];

create table public.group_work_capability (singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into public.group_work_capability default values;
create table public.group_recorders (
  session_id uuid not null, group_id uuid not null, participant_id uuid, revision integer not null default 0,
  primary key(session_id,group_id), foreign key(session_id,group_id) references public.session_groups(session_id,id),
  foreign key(session_id,participant_id) references public.session_participants(session_id,id)
);
create table public.group_recorder_changes (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, group_id uuid not null,
  actor_id uuid not null, old_recorder uuid, new_recorder uuid, reason text not null,
  revision integer not null, context jsonb not null, created_at timestamptz not null default clock_timestamp(),
  foreign key(session_id,group_id) references public.session_groups(session_id,id), unique(session_id,group_id,revision)
);
create table public.group_recorder_commands (
  session_id uuid not null references public.sessions(id), operation_id uuid not null,
  actor_id uuid not null, request_digest text not null, receipt jsonb not null, primary key(session_id,operation_id)
);
create table public.group_membership_intervals (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, group_id uuid not null, participant_id uuid not null,
  started_at timestamptz not null default clock_timestamp(), ended_at timestamptz,
  foreign key(session_id,group_id) references public.session_groups(session_id,id),
  foreign key(session_id,participant_id) references public.session_participants(session_id,id),
  unique(id,session_id,group_id,participant_id)
);
create unique index group_current_interval on public.group_membership_intervals(session_id,participant_id) where ended_at is null;
insert into public.group_membership_intervals(session_id,group_id,participant_id) select session_id,group_id,participant_id from public.session_group_members;
create table public.group_draft_grants (
  session_id uuid not null, group_id uuid not null, activity_id text not null, participant_id uuid not null, interval_id uuid not null,
  window_revision integer not null default 0, baseline uuid references public.work_attempts(id),
  primary key(session_id,group_id,activity_id,interval_id,window_revision),
  foreign key(session_id,group_id,activity_id) references public.work_items(session_id,group_id,activity_id),
  foreign key(interval_id,session_id,group_id,participant_id) references public.group_membership_intervals(id,session_id,group_id,participant_id)
);
create table public.group_contribution_versions (
  id uuid primary key default gen_random_uuid(), session_id uuid not null, group_id uuid not null, activity_id text not null,
  author_id uuid not null, field_id text not null, revision integer not null check(revision>0), content text not null,
  saved_at timestamptz not null default clock_timestamp(),
  foreign key(session_id,group_id,activity_id) references public.work_items(session_id,group_id,activity_id),
  foreign key(session_id,author_id) references public.session_participants(session_id,id),
  unique(session_id,group_id,activity_id,author_id,field_id,revision)
);
create table public.group_answer_versions (
  session_id uuid not null, group_id uuid not null, activity_id text not null, revision integer not null,
  editor_id uuid not null, content jsonb not null, lineage jsonb not null, reason text not null, saved_at timestamptz not null default clock_timestamp(),
  primary key(session_id,group_id,activity_id,revision),
  foreign key(session_id,group_id,activity_id) references public.work_items(session_id,group_id,activity_id),
  foreign key(session_id,editor_id) references public.session_participants(session_id,id)
);
do $$ declare n text; begin
  foreach n in array array['group_work_capability','group_recorders','group_recorder_changes','group_recorder_commands','group_membership_intervals','group_draft_grants','group_contribution_versions','group_answer_versions'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  end loop;
  foreach n in array array['group_recorder_changes','group_recorder_commands','group_contribution_versions','group_answer_versions'] loop
    execute format('create trigger freeze_version before update on public.%I for each row execute function public.freeze_work_version()',n);
  end loop;
end $$;

create function public.check_group_work_owner() returns trigger language plpgsql set search_path='' as $$
declare a jsonb;
begin
  if tg_op='UPDATE' and (new.session_id,new.participant_id,new.group_id,new.activity_id,new.version_id) is distinct from
    (old.session_id,old.participant_id,old.group_id,old.activity_id,old.version_id) then raise exception 'work_owner_frozen'; end if;
  if new.group_id is not null then
    select v.value into a from public.workshop_versions w cross join lateral jsonb_array_elements(w.content->'activities') v where w.id=new.version_id and v.value->>'id'=new.activity_id;
    if a is null or a->>'scope'<>'group' or a->'input'<>'null'::jsonb then raise exception 'invalid_group_work'; end if;
    if tg_op='INSERT' and not exists(select 1 from public.session_groups where session_id=new.session_id and id=new.group_id and not retired) then raise exception 'invalid_group_work'; end if;
  end if;
  return new;
end $$;
create trigger check_group_work_owner before insert or update on public.work_items for each row execute function public.check_group_work_owner();
create function public.check_group_attempt() returns trigger language plpgsql set search_path='' as $$
begin
  if new.group_id is not null and (new.snapshot is null or new.audience is null or not exists(
    select 1 from public.group_recorders r join public.session_group_members m on m.session_id=r.session_id and m.group_id=r.group_id and m.participant_id=r.participant_id
    join public.session_participants p on p.session_id=m.session_id and p.id=m.participant_id
    where r.session_id=new.session_id and r.group_id=new.group_id and r.participant_id=new.submitted_by and p.state='admitted'
  )) then raise exception 'not_allowed' using errcode='42501'; end if;
  return new;
end $$;
create trigger check_group_attempt before insert on public.work_attempts for each row execute function public.check_group_attempt();
revoke all on function public.check_group_work_owner(),public.check_group_attempt() from public;

create function public.group_work_enabled() returns boolean language sql security definer set search_path='' as $$
  select enabled from public.group_work_capability where singleton;
$$;
create function public.group_work_context(p_session uuid) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('execution',e.revision,'assignment',coalesce((select revision from public.session_group_state where session_id=p_session),0),
    'roster',coalesce((select jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'group',m.group_id) order by p.id)
      from public.session_participants p left join public.session_group_members m on m.session_id=p.session_id and m.participant_id=p.id
      where p.session_id=p_session and p.state='admitted'),'[]'::jsonb),
    'recorders',coalesce((select jsonb_agg(jsonb_build_object('group',g.id,'ordinal',g.ordinal,'recorder',r.participant_id,'revision',coalesce(r.revision,0)) order by g.ordinal)
      from public.session_groups g left join public.group_recorders r on r.session_id=g.session_id and r.group_id=g.id where g.session_id=p_session and not g.retired),'[]'::jsonb))
  from public.session_execution e where e.session_id=p_session;
$$;
create function public.group_context_token(p_session uuid) returns text language sql security definer set search_path='' as $$
  select encode(extensions.digest(public.group_work_context(p_session)::text,'sha256'),'hex');
$$;
create function public.group_readiness(p_session uuid) returns text[] language plpgsql security definer set search_path='' as $$
declare problems text[]:='{}';
begin
  if not public.group_work_enabled() then problems:=array_append(problems,'Group work is temporarily unavailable.'); end if;
  if not exists(select 1 from public.session_group_members where session_id=p_session) then problems:=array_append(problems,'Assign at least one admitted participant to a group.'); end if;
  if exists(select 1 from public.session_participants p where p.session_id=p_session and p.state='admitted' and not exists(select 1 from public.session_group_members m where m.session_id=p_session and m.participant_id=p.id)) then problems:=array_append(problems,'Assign every admitted participant before entering this group activity.'); end if;
  if exists(select 1 from public.session_group_members m where m.session_id=p_session and not exists(
    select 1 from public.group_recorders r join public.session_group_members rm on rm.session_id=r.session_id and rm.group_id=r.group_id and rm.participant_id=r.participant_id
    join public.session_participants p on p.session_id=rm.session_id and p.id=rm.participant_id
    where r.session_id=m.session_id and r.group_id=m.group_id and p.state='admitted'
  )) then problems:=array_append(problems,'Choose a current recorder for each nonempty group.'); end if;
  return problems;
end $$;
create or replace function public.group_draft_allowed(p_session uuid,p_group uuid,p_activity text,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.group_draft_grants g join public.group_membership_intervals i on i.id=g.interval_id
    join public.work_items w on w.session_id=g.session_id and w.group_id=g.group_id and w.activity_id=g.activity_id
    where g.session_id=p_session and g.group_id=p_group and g.activity_id=p_activity and g.participant_id=p_actor and i.ended_at is null
      and (g.window_revision=0 or (w.reopened and exists(select 1 from public.sessions s cross join lateral public.effective_session(s) effective where s.id=p_session and effective.state='open') and g.window_revision=w.window_revision)));
$$;
create or replace function public.group_attempt_allowed(p_attempt uuid,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.work_attempts t where t.id=p_attempt and (p_actor=any(t.audience) or exists(
    select 1 from public.group_draft_grants g join public.group_membership_intervals i on i.id=g.interval_id
    join public.work_items w on w.session_id=g.session_id and w.group_id=g.group_id and w.activity_id=g.activity_id
    where g.baseline=t.id and g.participant_id=p_actor and i.ended_at is null and w.reopened and exists(select 1 from public.sessions s cross join lateral public.effective_session(s) effective where s.id=t.session_id and effective.state='open') and g.window_revision=w.window_revision)));
$$;
create function public.ensure_current_group_work(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.session_execution; a jsonb;
begin
  select * into e from public.session_execution where session_id=p_session;
  if e.state not in ('live','paused') then return; end if;
  select content->'activities'->e.current_index into a from public.workshop_versions where id=e.version_id;
  if a->>'scope' is distinct from 'group' then return; end if;
  insert into public.work_items(session_id,group_id,activity_id,version_id)
    select distinct p_session,m.group_id,a->>'id',e.version_id from public.session_group_members m join public.session_groups g on g.session_id=m.session_id and g.id=m.group_id
    where m.session_id=p_session and not g.retired on conflict do nothing;
  insert into public.group_draft_grants(session_id,group_id,activity_id,participant_id,interval_id)
    select p_session,i.group_id,a->>'id',i.participant_id,i.id from public.group_membership_intervals i
    where i.session_id=p_session and i.ended_at is null on conflict do nothing;
end $$;
create function public.group_membership_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.group_recorders; sid uuid; gid uuid; pid uuid;
begin
  sid:=coalesce(new.session_id,old.session_id);
  if tg_op in ('DELETE','UPDATE') then
    gid:=old.group_id; pid:=old.participant_id;
    update public.group_membership_intervals set ended_at=clock_timestamp() where session_id=sid and participant_id=pid and ended_at is null;
    update public.group_recorders set participant_id=null,revision=revision+1 where session_id=sid and group_id=gid and participant_id=pid returning * into r;
    if found then
      insert into public.group_recorder_changes(session_id,group_id,actor_id,old_recorder,new_recorder,reason,revision,context)
        values(sid,gid,coalesce(auth.uid(),pid),pid,null,'Recorder membership ended',r.revision,public.group_work_context(sid));
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    insert into public.group_membership_intervals(session_id,group_id,participant_id) values(sid,new.group_id,new.participant_id);
  end if;
  perform public.ensure_current_group_work(sid);
  return coalesce(new,old);
end $$;
create trigger group_membership_changed after insert or update or delete on public.session_group_members for each row execute function public.group_membership_changed();
create function public.group_activity_entered() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.ensure_current_group_work(new.session_id); return new; end $$;
create trigger group_activity_entered after update of state,current_index on public.session_execution for each row execute function public.group_activity_entered();

create or replace function public.recorder_command(p_session uuid,p_operation uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; gid uuid; candidate uuid; s public.sessions; e public.session_execution; r public.group_recorders; prior uuid;
  digest text; saved public.group_recorder_commands; result jsonb; reason text;
begin
  if p_operation is null or p_request is null or not extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,"required":["group","recorder","context","reason"],"properties":{
      "group":{"type":"string","format":"uuid"},"recorder":{"type":["string","null"],"format":"uuid"},"context":{"type":"string","pattern":"^[a-f0-9]{64}$"},"reason":{"type":"string","maxLength":500}}}'::json,p_request) then raise exception 'invalid_group_work'; end if;
  perform 1 from public.sessions where id=p_session for update;
  actor:=public.authorize_work(p_session,null,null,true);
  gid:=(p_request->>'group')::uuid; candidate:=(p_request->>'recorder')::uuid;
  reason:=replace(p_request->>'reason',E'\r\n',E'\n'); p_request:=jsonb_set(p_request,'{reason}',to_jsonb(reason));
  digest:=encode(extensions.digest(p_request::text,'sha256'),'hex');
  select * into saved from public.group_recorder_commands where session_id=p_session and operation_id=p_operation;
  if found then
    if saved.actor_id<>actor or saved.request_digest<>digest then raise exception 'operation_reused'; end if;
    return saved.receipt;
  end if;
  select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
  select * into e from public.session_execution where session_id=p_session;
  if s.state='ended' or not public.lock_group_capability() then raise exception 'group_work_closed'; end if;
  if p_request->>'context'<>public.group_context_token(p_session) then raise exception 'group_work_conflict'; end if;
  if not exists(select 1 from public.session_groups where session_id=p_session and id=gid and not retired) or
    (candidate is not null and not exists(select 1 from public.session_group_members m join public.session_participants p on p.session_id=m.session_id and p.id=m.participant_id
      where m.session_id=p_session and m.group_id=gid and m.participant_id=candidate and p.state='admitted')) then raise exception 'invalid_group_work'; end if;
  if e.state in ('live','paused') and not public.work_nonblank(reason) then raise exception 'invalid_group_work'; end if;
  insert into public.group_recorders(session_id,group_id) values(p_session,gid) on conflict do nothing;
  select * into r from public.group_recorders where session_id=p_session and group_id=gid; prior:=r.participant_id;
  if prior is distinct from candidate then
    update public.group_recorders set participant_id=candidate,revision=revision+1 where session_id=p_session and group_id=gid returning * into r;
    insert into public.group_recorder_changes(session_id,group_id,actor_id,old_recorder,new_recorder,reason,revision,context)
      values(p_session,gid,actor,prior,candidate,reason,r.revision,public.group_work_context(p_session));
  end if;
  result:=jsonb_build_object('revision',r.revision,'changed',prior is distinct from candidate,'confirmed_at',clock_timestamp());
  insert into public.group_recorder_commands values(p_session,p_operation,actor,digest,result);
  perform public.authorize_work(p_session,null,null,true);
  s:=public.effective_session(s); if s.state='ended' then raise exception 'group_work_closed'; end if;
  return result;
end $$;
revoke all on function public.group_work_enabled(),public.group_work_context(uuid),public.group_context_token(uuid),public.group_readiness(uuid),
  public.group_draft_allowed(uuid,uuid,text,uuid),public.group_attempt_allowed(uuid,uuid),public.ensure_current_group_work(uuid),public.group_membership_changed(),public.group_activity_entered(),public.recorder_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.recorder_command(uuid,uuid,jsonb) to authenticated;

-- Preserve continuous membership for unchanged assignments, including legacy callers.
create or replace function public.group_command(p_session uuid,p_operation uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; current_value jsonb; old_value jsonb; final_value jsonb; normalized jsonb; digest_value text; saved public.session_group_commands;
  entry jsonb; mapping jsonb:='{}'; new_id uuid; next_label integer; rev integer; changed boolean; result jsonb; s public.sessions;
begin
  perform 1 from public.sessions where id=p_session for update;
  actor:=public.authorize_work(p_session,null,null,true);
  current_value:=public.read_groups(p_session,null,true);
  if current_value is null then raise exception 'group_closed'; end if;
  if p_operation is null or p_request is null or octet_length(p_request::text)>262144 or not extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,
    "required":["version","execution_revision","activity_index","revision","roster","groups","retire","members","reason"],
    "properties":{
      "version":{"type":"string","format":"uuid"},"execution_revision":{"type":"integer","minimum":1},"activity_index":{"type":"integer","minimum":-1},"revision":{"type":"integer","minimum":0},
      "roster":{"type":"string","pattern":"^[a-f0-9]{64}$"},"reason":{"type":"string","maxLength":500},
      "groups":{"type":"array","maxItems":8,"items":{"type":"object","additionalProperties":false,"required":["key","create"],"properties":{"key":{"type":"string","format":"uuid"},"create":{"type":"boolean"}}}},
      "retire":{"type":"array","maxItems":8,"items":{"type":"string","format":"uuid"}},
      "members":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["participant","group"],"properties":{"participant":{"type":"string","format":"uuid"},"group":{"type":["string","null"],"format":"uuid"}}}}
    }}'::json,p_request) then raise exception 'invalid_group_plan'; end if;
  normalized:=p_request||jsonb_build_object(
    'groups',(select coalesce(jsonb_agg(v order by v->>'key'),'[]'::jsonb) from jsonb_array_elements(p_request->'groups') v),
    'retire',(select coalesce(jsonb_agg(v order by v),'[]'::jsonb) from jsonb_array_elements(p_request->'retire') v),
    'members',(select coalesce(jsonb_agg(v order by v->>'participant'),'[]'::jsonb) from jsonb_array_elements(p_request->'members') v));
  digest_value:=encode(extensions.digest(normalized::text,'sha256'),'hex');
  select * into saved from public.session_group_commands where session_id=p_session and operation_id=p_operation;
  if found then
    if saved.actor_id<>actor or saved.request_digest<>digest_value then raise exception 'operation_reused'; end if;
    return saved.receipt;
  end if;
  if exists(select 1 from public.session_execution e join public.workshop_versions v on v.id=e.version_id cross join lateral jsonb_array_elements(v.content->'activities') a where e.session_id=p_session and a->>'scope'='group') and not public.lock_group_capability() then raise exception 'group_closed'; end if;
  if current_value->>'state'='completed' then raise exception 'group_closed'; end if;
  if exists(select 1 from unnest(array['version','execution_revision','activity_index','revision','roster']) k where p_request->k is distinct from current_value->k) then raise exception 'group_conflict'; end if;
  if (select count(*)<>count(distinct v->>'key') from jsonb_array_elements(p_request->'groups') v)
    or (select count(*)<>count(distinct v) from jsonb_array_elements(p_request->'retire') v)
    or (select count(*)<>count(distinct v->>'participant') from jsonb_array_elements(p_request->'members') v)
    or (select jsonb_agg(v->>'participant' order by v->>'participant') from jsonb_array_elements(p_request->'members') v) is distinct from
       (select jsonb_agg(v->>'participant' order by v->>'participant') from jsonb_array_elements(current_value->'members') v)
    then raise exception 'invalid_group_plan'; end if;
  -- Every existing group appears exactly once, retained or explicitly retired.
  if exists(select 1 from public.session_groups g where g.session_id=p_session and not g.retired and
    ((select count(*) from jsonb_array_elements(p_request->'groups') v where not (v->>'create')::boolean and (v->>'key')::uuid=g.id)+
     (select count(*) from jsonb_array_elements_text(p_request->'retire') v where v::uuid=g.id))<>1)
    or exists(select 1 from jsonb_array_elements_text(p_request->'retire') v where not exists(select 1 from public.session_groups where session_id=p_session and id=v::uuid and not retired))
    or exists(select 1 from jsonb_array_elements(p_request->'groups') v where
      case when (v->>'create')::boolean then exists(select 1 from public.session_groups where session_id=p_session and id=(v->>'key')::uuid)
      else not exists(select 1 from public.session_groups where session_id=p_session and id=(v->>'key')::uuid and not retired) end)
    or exists(select 1 from jsonb_array_elements(p_request->'members') m where m->>'group' is not null and not exists(select 1 from jsonb_array_elements(p_request->'groups') g where g->>'key'=m->>'group'))
    then raise exception 'invalid_group_plan'; end if;
  old_value:=public.group_mapping(p_session);
  if current_value->>'state' in ('live','paused') and not public.work_nonblank(p_request->>'reason') and exists(
    select 1 from jsonb_array_elements(p_request->'members') m join jsonb_array_elements(current_value->'members') c on m->>'participant'=c->>'participant' where m->'group' is distinct from c->'group'
  ) then raise exception 'invalid_group_plan'; end if;
  insert into public.session_group_state(session_id) values(p_session) on conflict do nothing;
  select next_ordinal,revision into next_label,rev from public.session_group_state where session_id=p_session;
  for entry in select v from jsonb_array_elements(p_request->'groups') v order by v->>'key' loop
    if (entry->>'create')::boolean then
      insert into public.session_groups(session_id,ordinal) values(p_session,next_label) returning id into new_id;
      next_label:=next_label+1;
    else new_id:=(entry->>'key')::uuid; end if;
    mapping:=mapping||jsonb_build_object(entry->>'key',new_id);
  end loop;
  update public.session_groups set retired=true where session_id=p_session and id in (select v::uuid from jsonb_array_elements_text(p_request->'retire') v);
  delete from public.session_group_members m where m.session_id=p_session and not exists(
    select 1 from jsonb_array_elements(p_request->'members') v where (v->>'participant')::uuid=m.participant_id and (mapping->>(v->>'group'))::uuid=m.group_id);
  insert into public.session_group_members(session_id,participant_id,group_id)
    select p_session,(v->>'participant')::uuid,(mapping->>(v->>'group'))::uuid from jsonb_array_elements(p_request->'members') v where v->>'group' is not null on conflict (session_id,participant_id) do nothing;
  final_value:=public.group_mapping(p_session); changed:=old_value<>final_value;
  if changed then
    rev:=rev+1;
    update public.session_group_state set revision=rev,next_ordinal=next_label where session_id=p_session;
    insert into public.session_group_changes values(p_session,rev,actor,'host',p_request->>'reason',(current_value->>'execution_revision')::integer,(current_value->>'activity_index')::integer,old_value,final_value,clock_timestamp());
  end if;
  -- Recheck real time/current authority after all potentially blocking work.
  perform public.authorize_work(p_session,null,null,true);
  select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
  if s.state='ended' then raise exception 'group_closed'; end if;
  result:=jsonb_build_object('revision',rev,'changed',changed,'groups',mapping,'confirmed_at',clock_timestamp());
  insert into public.session_group_commands values(p_session,p_operation,actor,digest_value,result);
  perform public.authorize_work(p_session,null,null,true);
  s:=public.effective_session(s); if s.state='ended' then raise exception 'group_closed'; end if;
  return result;
end;
$$;

-- Legacy clients must never synthesize individual work for a group activity.
create or replace function public.work_snapshot(p_session uuid,p_participant uuid) returns jsonb
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
    and a.value->>'scope'='individual' and p.state in ('admitted','removed') and a.ordinality-1<=e.current_index;
  return jsonb_build_object('session',p_session,'version',e.version_id,'current_index',e.current_index,
    'execution_revision',e.revision,'ended',s.state='ended','items',result);
end;
$$;

create function public.group_write_allowed(p_session uuid,p_group uuid,p_activity text,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.group_draft_grants g join public.group_membership_intervals i on i.id=g.interval_id
    join public.work_items w on w.session_id=g.session_id and w.group_id=g.group_id and w.activity_id=g.activity_id
    join public.session_execution e on e.session_id=w.session_id join public.workshop_versions v on v.id=e.version_id
    where g.session_id=p_session and g.group_id=p_group and g.activity_id=p_activity and g.participant_id=p_actor and i.ended_at is null
      and ((g.window_revision=0 and p_activity=v.content->'activities'->e.current_index->>'id') or (w.reopened and g.window_revision=w.window_revision)));
$$;
revoke all on function public.group_write_allowed(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.group_current_contributions(p_session uuid,p_group uuid,p_activity text) returns jsonb
language sql security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by author_id,field_id),'[]'::jsonb) from (
    select distinct on (author_id,field_id) id,author_id,field_id,revision,content,saved_at
    from public.group_contribution_versions where session_id=p_session and group_id=p_group and activity_id=p_activity
    order by author_id,field_id,revision desc
  ) x;
$$;
create function public.group_attempt_projection(p_attempt uuid,p_actor uuid,p_host boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.work_attempts; result jsonb;
begin
  select * into t from public.work_attempts where id=p_attempt;
  if not p_host and not public.group_attempt_allowed(p_attempt,p_actor) then return null; end if;
  result:=to_jsonb(t)||jsonb_build_object('acceptance',(select to_jsonb(a) from public.work_partial_acceptances a where a.attempt_id=t.id));
  if t.preceding_id is not null and not p_host and not public.group_attempt_allowed(t.preceding_id,p_actor) then
    result:=result-'preceding_id'-'preceding_ordinal'||jsonb_build_object('restricted_predecessor',true);
  end if;
  return result;
end $$;
create or replace function public.read_group_work(p_session uuid,p_credential_hash text default null,p_host boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; e public.session_execution; s public.sessions; agenda jsonb; w public.work_items; a jsonb; draft boolean; attempts jsonb; items jsonb:='[]'; item jsonb; sources jsonb;
begin
  actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
  select * into e from public.session_execution where session_id=p_session;
  if not found then return null; end if;
  select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
  select content into agenda from public.workshop_versions where id=e.version_id;
  for w in select * from public.work_items where session_id=p_session and group_id is not null order by group_id,activity_id loop
    draft:=p_host or public.group_draft_allowed(p_session,w.group_id,w.activity_id,actor);
    select coalesce(jsonb_agg(public.group_attempt_projection(t.id,actor,p_host) order by t.ordinal),'[]'::jsonb) into attempts
      from public.work_attempts t where t.session_id=p_session and t.group_id=w.group_id and t.activity_id=w.activity_id and (p_host or public.group_attempt_allowed(t.id,actor));
    if not draft and attempts='[]'::jsonb then continue; end if;
    select v into a from jsonb_array_elements(agenda->'activities') v where v->>'id'=w.activity_id;
    item:=jsonb_build_object('group',w.group_id,'group_ordinal',(select ordinal from public.session_groups where session_id=p_session and id=w.group_id),'activity',a,'attempts',attempts,'draft_access',draft);
    if draft then
      select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) into sources from public.group_contribution_versions c where c.id in (
        select v::uuid from jsonb_each(w.lineage) f cross join lateral jsonb_array_elements_text(f.value->'sources') v);
      item:=item||jsonb_build_object('revision',w.revision,'token',w.group_token,'content',w.content,'lineage',w.lineage,'sources',sources,'saved_at',w.saved_at,
        'window_revision',w.window_revision,'reopened',w.reopened and s.state='open','contributions',public.group_current_contributions(p_session,w.group_id,w.activity_id),
        'recorder',(select participant_id from public.group_recorders where session_id=p_session and group_id=w.group_id),
        'writable',public.group_work_enabled() and s.state='open' and e.state in ('live','paused') and
          (a->>'id'=agenda->'activities'->e.current_index->>'id' or w.reopened) and
          (p_host or public.group_write_allowed(p_session,w.group_id,w.activity_id,actor)) and
          (p_host or exists(select 1 from public.session_group_members where session_id=p_session and group_id=w.group_id and participant_id=actor)),
        'predecessor',case when not p_host and not exists(select 1 from public.work_attempts t where t.session_id=p_session and t.group_id=w.group_id and t.activity_id=w.activity_id and t.ordinal=w.latest and public.group_attempt_allowed(t.id,actor)) then jsonb_build_object('restricted',true) when w.latest=0 then null else (select case when p_host or public.group_attempt_allowed(t.id,actor) then jsonb_build_object('id',t.id,'ordinal',t.ordinal) else jsonb_build_object('restricted',true) end
          from public.work_attempts t where t.session_id=p_session and t.group_id=w.group_id and t.activity_id=w.activity_id and t.ordinal=w.latest) end);
    end if;
    items:=items||jsonb_build_array(item);
  end loop;
  perform public.authorize_work(p_session,null,p_credential_hash,p_host);
  if s.state='open' and e.deadline<=clock_timestamp() then raise exception 'group_work_closed'; end if;
  return jsonb_build_object('session',p_session,'version',e.version_id,'actor',case when p_host then null else actor end,
    'enabled',public.group_work_enabled(),'context',public.group_context_token(p_session),'state',case when s.state='ended' then 'completed' else e.state end,
    'current',case when s.state='open' and e.state in ('live','paused') then agenda->'activities'->e.current_index else null end,'items',items,
    'group',(select group_id from public.session_group_members where session_id=p_session and participant_id=actor),
    'coordination',case when p_host then public.group_work_context(p_session) else null end,
    'members',coalesce((select jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'group',m.group_id) order by p.id)
      from public.session_participants p join public.session_group_members m on m.session_id=p.session_id and m.participant_id=p.id
      where p.session_id=p_session and p.state='admitted' and (p_host or m.group_id=(select group_id from public.session_group_members where session_id=p_session and participant_id=actor))),'[]'::jsonb),
    'recorder_history',case when p_host then coalesce((select jsonb_agg(to_jsonb(r) order by created_at) from public.group_recorder_changes r where r.session_id=p_session),'[]'::jsonb) else null end);
end $$;

create or replace function public.group_work_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cmd text; actor uuid; is_host boolean; gid uuid; aid text; e public.session_execution; s public.sessions; w public.work_items;
  a jsonb; f jsonb; value text; reason text; digest text; saved public.work_commands; result jsonb; previous public.work_attempts; attempt public.work_attempts;
  slot public.group_contribution_versions; normalized jsonb:='{}'; new_lineage jsonb; field_lineage jsonb; selected jsonb; authors jsonb; refs jsonb;
  contributions jsonb; roster jsonb; sources jsonb; audience_ids uuid[]; missing text[]; rev integer; expected_keys text[];
begin
  if p_operation is null or p_request is null or octet_length(p_request::text)>262144 or not extensions.jsonb_matches_schema('{
    "type":"object","additionalProperties":false,"required":["command","group","activity","version","context","token","window_revision","reason"],"properties":{
      "command":{"enum":["contribute","answer","replace_field","submit","submit_incomplete","accept_partial","reopen","close"]},
      "group":{"type":"string","format":"uuid"},"activity":{"type":"string","minLength":1,"maxLength":100},"version":{"type":"string","format":"uuid"},
      "context":{"type":"string","pattern":"^[a-f0-9]{64}$"},"token":{"type":"string","format":"uuid"},"window_revision":{"type":"integer","minimum":0},
      "reason":{"type":"string","maxLength":500},"revision":{"type":"integer","minimum":0},"field":{"type":"string","minLength":1,"maxLength":100},
      "value":{"type":"string","maxLength":5000},"content":{"type":"object"},"sources":{"type":"object"},
      "audience":{"type":"array","uniqueItems":true,"items":{"type":"string","format":"uuid"}},"baseline":{"type":["string","null"],"format":"uuid"}}}'::json,p_request) then raise exception 'invalid_group_work'; end if;
  cmd:=p_request->>'command'; gid:=(p_request->>'group')::uuid; aid:=p_request->>'activity';
  is_host:=cmd in ('accept_partial','reopen','close');
  expected_keys:=case cmd when 'contribute' then array['revision','field','value'] when 'answer' then array['revision','content','sources']
    when 'replace_field' then array['revision','field','value','sources'] when 'reopen' then array['audience','baseline'] else array[]::text[] end;
  if p_request-(array['command','group','activity','version','context','token','window_revision','reason']||expected_keys)<>'{}'::jsonb or not p_request ?& expected_keys then raise exception 'invalid_group_work'; end if;
  perform 1 from public.sessions where id=p_session for update;
  actor:=public.authorize_work(p_session,null,p_credential_hash,is_host);
  select * into e from public.session_execution where session_id=p_session;
  select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
  select * into w from public.work_items where session_id=p_session and group_id=gid and activity_id=aid for update;
  if w.group_id is null or w.version_id::text<>p_request->>'version' then raise exception 'not_allowed' using errcode='42501'; end if;
  if not is_host and not public.group_draft_allowed(p_session,gid,aid,actor) then
    -- A departed author can resolve only their exact permitted submitted snapshot.
    select * into saved from public.work_commands where operation_id=p_operation and actor_id=actor and session_id=p_session and group_id=gid and activity_id=aid;
    if saved.receipt->>'attempt' is null or not public.group_attempt_allowed((saved.receipt->>'attempt')::uuid,actor) then raise exception 'not_allowed' using errcode='42501'; end if;
  end if;
  reason:=replace(p_request->>'reason',E'\r\n',E'\n'); p_request:=jsonb_set(p_request,'{reason}',to_jsonb(reason));
  if cmd in ('contribute','replace_field') then p_request:=jsonb_set(p_request,'{value}',to_jsonb(replace(p_request->>'value',E'\r\n',E'\n'))); end if;
  select v.value into a from public.workshop_versions x cross join lateral jsonb_array_elements(x.content->'activities') with ordinality v where x.id=e.version_id and v.value->>'id'=aid and v.ordinality-1<=e.current_index;
  if a is null then raise exception 'group_work_closed'; end if;
  if cmd='answer' then
    if exists(select 1 from jsonb_object_keys(p_request->'content') k where not exists(select 1 from jsonb_array_elements(a->'outputs') field_entry where field_entry->>'id'=k)) then raise exception 'invalid_group_work'; end if;
    for f in select v from jsonb_array_elements(a->'outputs') v loop
      if p_request->'content' ? (f->>'id') and jsonb_typeof(p_request->'content'->(f->>'id'))<>'string' then raise exception 'invalid_group_work'; end if;
      value:=replace(coalesce(p_request->'content'->>(f->>'id'),''),E'\r\n',E'\n');
      if char_length(value)>(case when f->>'kind'='short' then 500 else 5000 end) then raise exception 'invalid_group_work'; end if;
      normalized:=normalized||jsonb_build_object(f->>'id',value);
    end loop;
    p_request:=jsonb_set(p_request,'{content}',normalized);
  end if;
  digest:=encode(extensions.digest(p_request::text,'sha256'),'hex');
  select * into saved from public.work_commands where operation_id=p_operation;
  if found then
    if (saved.session_id,saved.group_id,saved.activity_id,saved.actor_id,saved.request_digest) is distinct from (p_session,gid,aid,actor,digest) then raise exception 'operation_reused'; end if;
    perform public.authorize_work(p_session,null,p_credential_hash,is_host);
    return saved.receipt;
  end if;
  if not is_host and not public.group_draft_allowed(p_session,gid,aid,actor) then raise exception 'not_allowed' using errcode='42501'; end if;
  if not public.lock_group_capability() or s.state<>'open' or e.state not in ('live','paused') or e.deadline<=clock_timestamp() then raise exception 'group_work_closed'; end if;
  if not exists(select 1 from public.session_groups where session_id=p_session and id=gid and not retired) then raise exception 'group_work_closed'; end if;
  if p_request->>'context'<>public.group_context_token(p_session) or w.window_revision<>(p_request->>'window_revision')::integer then raise exception 'group_work_conflict'; end if;
  if cmd<>'contribute' and w.group_token<>(p_request->>'token')::uuid then raise exception 'group_work_conflict'; end if;
  if cmd in ('answer','replace_field','submit','submit_incomplete') and not exists(select 1 from public.group_recorders where session_id=p_session and group_id=gid and participant_id=actor) then raise exception 'not_allowed' using errcode='42501'; end if;
  if not is_host and not public.group_write_allowed(p_session,gid,aid,actor) then raise exception 'group_work_closed'; end if;
  if cmd not in ('reopen','close','accept_partial') and not w.reopened and aid is distinct from (select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id) then raise exception 'group_work_closed'; end if;
  select * into previous from public.work_attempts where session_id=p_session and group_id=gid and activity_id=aid and ordinal=w.latest;
  if cmd in ('reopen','close') then
    if aid=(select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id) or not public.work_nonblank(reason) then raise exception 'invalid_group_work'; end if;
    if cmd='reopen' then
      if (p_request->>'baseline')::uuid is distinct from previous.id or not exists(select 1 from public.group_recorders r where r.session_id=p_session and r.group_id=gid and p_request->'audience' ? r.participant_id::text)
        or exists(select 1 from jsonb_array_elements_text(p_request->'audience') v where not exists(select 1 from public.session_group_members m join public.session_participants p on p.session_id=m.session_id and p.id=m.participant_id
          where m.session_id=p_session and m.group_id=gid and m.participant_id=v::uuid and p.state='admitted')) then raise exception 'invalid_group_work'; end if;
      insert into public.group_draft_grants(session_id,group_id,activity_id,participant_id,interval_id,window_revision,baseline)
        select p_session,gid,aid,i.participant_id,i.id,w.window_revision+1,previous.id from public.group_membership_intervals i
        where i.session_id=p_session and i.group_id=gid and i.ended_at is null and p_request->'audience' ? i.participant_id::text;
    end if;
    update public.work_items set reopened=cmd='reopen',window_revision=window_revision+1 where session_id=p_session and group_id=gid and activity_id=aid;
  elsif cmd='contribute' then
    select v into f from jsonb_array_elements(a->'outputs') v where v->>'id'=p_request->>'field'; value:=p_request->>'value';
    if f is null or char_length(value)>(case when f->>'kind'='short' then 500 else 5000 end) then raise exception 'invalid_group_work'; end if;
    select * into slot from public.group_contribution_versions where session_id=p_session and group_id=gid and activity_id=aid and author_id=actor and field_id=f->>'id' order by revision desc limit 1;
    if coalesce(slot.revision,0)<>(p_request->>'revision')::integer then raise exception 'group_work_conflict'; end if;
    insert into public.group_contribution_versions(session_id,group_id,activity_id,author_id,field_id,revision,content)
      values(p_session,gid,aid,actor,f->>'id',coalesce(slot.revision,0)+1,value) returning * into slot;
  elsif cmd in ('answer','replace_field') then
    if w.revision<>(p_request->>'revision')::integer then raise exception 'group_work_conflict'; end if;
    if exists(select 1 from jsonb_each(p_request->'sources') x where not exists(select 1 from jsonb_array_elements(a->'outputs') field_entry where field_entry->>'id'=x.key)
      or jsonb_typeof(x.value)<>'array') then raise exception 'invalid_group_work'; end if;
    if cmd='replace_field' then
      if not public.work_nonblank(reason) or (p_request->'sources') - (p_request->>'field')<>'{}'::jsonb then raise exception 'invalid_group_work'; end if;
      select v into f from jsonb_array_elements(a->'outputs') v where v->>'id'=p_request->>'field';
      if f is null or char_length(p_request->>'value')>(case when f->>'kind'='short' then 500 else 5000 end) then raise exception 'invalid_group_work'; end if;
      normalized:=w.content||jsonb_build_object(p_request->>'field',p_request->>'value');
    end if;
    new_lineage:=w.lineage;
    for f in select v from jsonb_array_elements(a->'outputs') v loop
      selected:=coalesce(p_request->'sources'->(f->>'id'),'[]'::jsonb);
      if exists(select 1 from jsonb_array_elements(selected) v where jsonb_typeof(v)<>'string') then raise exception 'invalid_group_work'; end if;
      if exists(select 1 from jsonb_array_elements_text(selected) v where not exists(select 1 from public.group_contribution_versions c where c.id=v::uuid and c.session_id=p_session and c.group_id=gid and c.activity_id=aid
        and (c.id in (select (x->>'id')::uuid from jsonb_array_elements(public.group_current_contributions(p_session,gid,aid)) x) or c.id in
          (select x::uuid from jsonb_each(w.lineage) l cross join lateral jsonb_array_elements_text(l.value->'sources') x)))) then raise exception 'invalid_group_work'; end if;
      if cmd='replace_field' and f->>'id'<>p_request->>'field' then continue; end if;
      if cmd='answer' and coalesce(normalized->>(f->>'id'),'')=coalesce(w.content->>(f->>'id'),'') then
        if selected<>'[]'::jsonb and exists(select 1 from jsonb_array_elements_text(selected) v where not coalesce(w.lineage->(f->>'id')->'sources','[]'::jsonb) ? v) then raise exception 'invalid_group_work'; end if;
        continue;
      end if;
      if not public.work_nonblank(normalized->>(f->>'id')) and cmd='answer' and public.work_nonblank(w.content->>(f->>'id')) then raise exception 'field_reset_required'; end if;
      field_lineage:=case when cmd='replace_field' then '{}'::jsonb else coalesce(w.lineage->(f->>'id'),'{}'::jsonb) end;
      if public.work_nonblank(normalized->>(f->>'id')) then
        select coalesce(jsonb_agg(distinct v),'[]'::jsonb) into refs from jsonb_array_elements(coalesce(field_lineage->'sources','[]'::jsonb)||selected) v;
        select jsonb_agg(distinct v) into authors from jsonb_array_elements(coalesce(field_lineage->'authors','[]'::jsonb)||jsonb_build_array(actor)||
          coalesce((select jsonb_agg(author_id) from public.group_contribution_versions where id in (select x::uuid from jsonb_array_elements_text(refs) x)),'[]'::jsonb)) v;
        new_lineage:=new_lineage||jsonb_build_object(f->>'id',jsonb_build_object('revision',w.revision+1,'editor',actor,'authors',authors,'sources',refs));
      else new_lineage:=new_lineage||jsonb_build_object(f->>'id',jsonb_build_object('revision',w.revision+1,'editor',actor,'authors','[]'::jsonb,'sources','[]'::jsonb)); end if;
    end loop;
    update public.work_items set content=normalized,lineage=new_lineage,revision=revision+1,saved_at=clock_timestamp() where session_id=p_session and group_id=gid and activity_id=aid;
    insert into public.group_answer_versions(session_id,group_id,activity_id,revision,editor_id,content,lineage,reason) values(p_session,gid,aid,w.revision+1,actor,normalized,new_lineage,reason);
  elsif cmd='accept_partial' then
    if previous.id is null or cardinality(previous.missing)=0 or not public.work_nonblank(reason) or exists(select 1 from public.work_partial_acceptances where attempt_id=previous.id) then raise exception 'invalid_group_work'; end if;
    insert into public.work_partial_acceptances(attempt_id,actor_id,reason) values(previous.id,actor,reason);
  else
    if w.revision=0 then raise exception 'incomplete_work'; end if;
    select coalesce(array_agg(field_entry->>'id'),'{}') into missing from jsonb_array_elements(a->'outputs') field_entry where not public.work_nonblank(coalesce(w.content->>(field_entry->>'id'),''));
    if cardinality(missing)=jsonb_array_length(a->'outputs') or (cmd='submit' and cardinality(missing)>0) or (cmd='submit_incomplete' and cardinality(missing)=0) then raise exception 'incomplete_work'; end if;
    if (w.latest>0 or cmd='submit_incomplete') and not public.work_nonblank(reason) then raise exception 'invalid_group_work'; end if;
    select coalesce(jsonb_agg(x),'[]'::jsonb) into contributions from jsonb_array_elements(public.group_current_contributions(p_session,gid,aid)) x where public.work_nonblank(x->>'content');
    select jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name) order by p.id) into roster from public.session_group_members m join public.session_participants p on p.session_id=m.session_id and p.id=m.participant_id
      where m.session_id=p_session and m.group_id=gid and p.state='admitted';
    select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]'::jsonb) into sources from public.group_contribution_versions c where c.id in (
      select v::uuid from jsonb_each(w.lineage) l cross join lateral jsonb_array_elements_text(l.value->'sources') v);
    select array_agg(distinct id order by id) into audience_ids from (
      select (x->>'participant')::uuid id from jsonb_array_elements(roster) x union select (x->>'author_id')::uuid from jsonb_array_elements(contributions) x
      union select v::uuid from jsonb_each(w.lineage) l cross join lateral jsonb_array_elements_text(l.value->'authors') v) ids;
    insert into public.work_attempts(session_id,group_id,activity_id,submitted_by,ordinal,preceding_id,preceding_ordinal,draft_revision,content,missing,reason,snapshot,audience)
      values(p_session,gid,aid,actor,w.latest+1,previous.id,previous.ordinal,w.revision,w.content,missing,reason,
        jsonb_build_object('version',e.version_id,'schema',a->'outputs','lineage',w.lineage,'sources',sources,'contributions',contributions,'roster',roster,
          'context',jsonb_build_object('execution',e.revision,'assignment',coalesce((select revision from public.session_group_state where session_id=p_session),0),'roster',roster,'recorders',jsonb_build_array((select jsonb_build_object('group',gid,'recorder',participant_id,'revision',revision) from public.group_recorders where session_id=p_session and group_id=gid))),'window_revision',w.window_revision),audience_ids) returning * into attempt;
    update public.work_items set latest=latest+1 where session_id=p_session and group_id=gid and activity_id=aid;
  end if;
  update public.work_items set group_token=gen_random_uuid() where session_id=p_session and group_id=gid and activity_id=aid;
  result:=jsonb_build_object('committed',true,'attempt',attempt.id,'contribution',slot.id,'confirmed_at',clock_timestamp());
  insert into public.work_commands(operation_id,session_id,group_id,activity_id,actor_id,command,request_digest,reason,receipt)
    values(p_operation,p_session,gid,aid,actor,cmd,digest,reason,result);
  perform public.authorize_work(p_session,null,p_credential_hash,is_host);
  s:=public.effective_session(s); if s.state='ended' or e.deadline<=clock_timestamp() then raise exception 'group_work_closed'; end if;
  return result;
end $$;
revoke all on function public.group_current_contributions(uuid,uuid,text),public.group_attempt_projection(uuid,uuid,boolean),public.read_group_work(uuid,text,boolean),public.group_work_command(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.read_group_work(uuid,text,boolean),public.group_work_command(uuid,uuid,jsonb,text) to anon,authenticated;

create or replace function public.execution_problems_v2(p_content jsonb) returns text[] language plpgsql security definer set search_path='' as $$
declare problems text[]:=public.workshop_problems(p_content); a record;
begin
  for a in select value,ordinality from jsonb_array_elements(p_content->'activities') with ordinality loop
    if a.value->'input'<>'null'::jsonb then problems:=array_append(problems,format('Activity %s needs a saved earlier answer, which is not available yet.',a.ordinality)); end if;
  end loop;
  return problems;
end $$;
create or replace function public.prepare_execution_v2(p_version uuid, p_operation uuid) returns uuid
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
    perform public.authorize_work(v_existing.session_id,null,null,true);
    if v_existing.version_id <> p_version then raise exception 'operation_reused'; end if;
    return v_existing.session_id;
  end if;
  if v_version.state <> 'ready' then raise exception 'version_not_ready'; end if;
  if exists(select 1 from jsonb_array_elements(v_version.content->'activities') a where a->>'scope'='group') and not public.lock_group_capability() then raise exception 'unsupported_agenda'; end if;
  v_problems := public.execution_problems_v2(v_version.content);
  if cardinality(v_problems) > 0 then
    raise exception 'unsupported_agenda' using detail = array_to_string(v_problems,E'\n');
  end if;
  insert into public.sessions(workspace_id,title) values(v_workshop.workspace_id,v_workshop.title) returning id into v_session;
  insert into public.session_execution(session_id,version_id,prepare_operation) values(v_session,p_version,p_operation);
  perform public.authorize_work(v_session,null,null,true);
  return v_session;
end;
$$;

create or replace function public.execution_command_core(p_session uuid, p_operation uuid, p_revision integer, p_command text, p_protocol boolean, p_context text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.sessions; v_execution public.session_execution; v_content jsonb;
  v_request jsonb := jsonb_build_object('command',p_command,'revision',p_revision);
  v_previous public.execution_commands; v_result jsonb; v_problems text[]; v_now timestamptz;
begin
  if p_protocol then v_request:=v_request||jsonb_build_object('context',p_context); end if;
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
  perform public.authorize_work(p_session,null,null,true);
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
    perform public.authorize_work(p_session,null,null,true);
  return v_result;
  end if;
  if v_execution.revision<>p_revision then raise exception 'stale_execution'; end if;
  select content into v_content from public.workshop_versions where id=v_execution.version_id and state='ready';
  if v_content is null then raise exception 'version_not_ready'; end if;
  if p_command in ('start','next') then
    v_problems := case when p_protocol then public.execution_problems_v2(v_content) else public.execution_problems(v_content) end;
    if p_protocol and p_context is distinct from public.group_context_token(p_session) then raise exception 'stale_execution'; end if;
    if p_protocol and v_content->'activities'->(v_execution.current_index+1)->>'scope'='group' then
      if not public.lock_group_capability() then raise exception 'unsupported_agenda'; end if;
      v_problems:=v_problems||public.group_readiness(p_session);
    end if;
    if cardinality(v_problems)>0 then raise exception 'unsupported_agenda' using detail=array_to_string(v_problems,E'\n'); end if;
  end if;
  v_now:=clock_timestamp();
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
  perform public.authorize_work(p_session,null,null,true);
  if p_command<>'end' and v_execution.deadline<=clock_timestamp() then raise exception 'execution_unavailable'; end if;
  select jsonb_build_object('revision',revision,'state',state) into v_result from public.session_execution where session_id=p_session;
  insert into public.execution_commands(operation_id,session_id,actor_id,request,receipt)
    values(p_operation,p_session,auth.uid(),v_request,v_result);
  perform public.authorize_work(p_session,null,null,true);
  if p_command<>'end' and v_execution.deadline<=clock_timestamp() then raise exception 'execution_unavailable'; end if;
  return v_result;
end;
$$;

create or replace function public.execution_command(p_session uuid,p_operation uuid,p_revision integer,p_command text) returns jsonb language sql security definer set search_path='' as $$
  select public.execution_command_core(p_session,p_operation,p_revision,p_command,false,null);
$$;
create function public.execution_command_v2(p_session uuid,p_operation uuid,p_revision integer,p_command text,p_context text) returns jsonb language sql security definer set search_path='' as $$
  select public.execution_command_core(p_session,p_operation,p_revision,p_command,true,p_context);
$$;
create or replace function public.host_execution_v2(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; problems text[]; source_id text;
begin
  perform public.authorize_work(p_session,null,null,true);
  result:=public.execution_snapshot(p_session,true);
  if result is null then return null; end if;
  problems:=case when result->'next'->>'scope'='group' then public.group_readiness(p_session) else '{}'::text[] end;
  source_id:=result->'current'->>'id';
  return result||jsonb_build_object('context',public.group_context_token(p_session),'coordination',public.group_work_context(p_session),'group_blockers',problems,
    'unfinished',coalesce((select jsonb_agg(jsonb_build_object('group',g.id,'ordinal',g.ordinal) order by g.ordinal) from public.session_groups g
      where result->'current'->>'scope'='group' and g.session_id=p_session and not g.retired and exists(select 1 from public.session_group_members where session_id=p_session and group_id=g.id)
      and not exists(select 1 from public.work_attempts where session_id=p_session and group_id=g.id and activity_id=source_id)),'[]'::jsonb));
end $$;
revoke all on function public.execution_problems_v2(jsonb),public.prepare_execution_v2(uuid,uuid),public.execution_command_core(uuid,uuid,integer,text,boolean,text),public.execution_command_v2(uuid,uuid,integer,text,text),public.host_execution_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_execution_v2(uuid,uuid),public.execution_command_v2(uuid,uuid,integer,text,text),public.host_execution_v2(uuid) to authenticated;

create function public.lock_group_capability() returns boolean language plpgsql security definer set search_path='' as $$
declare enabled_value boolean;
begin select enabled into enabled_value from public.group_work_capability where singleton for share; return enabled_value; end $$;
revoke all on function public.lock_group_capability() from public,anon,authenticated,service_role;

-- Preparation checks the capability and execution checks the target activity.
