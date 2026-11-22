-- Title: Add session group assignment
-- Group coordination never grants access to individual Evidence or media.
create table public.session_group_state (
  session_id uuid primary key references public.session_execution(session_id),
  revision integer not null default 0 check(revision>=0),
  next_ordinal integer not null default 1 check(next_ordinal>0)
);
create table public.session_groups (
  session_id uuid not null references public.session_execution(session_id),
  id uuid not null default gen_random_uuid(),
  ordinal integer not null check(ordinal>0),
  retired boolean not null default false,
  primary key(session_id,id), unique(session_id,ordinal)
);
create table public.session_group_members (
  session_id uuid not null,
  participant_id uuid not null,
  group_id uuid not null,
  primary key(session_id,participant_id),
  foreign key(session_id,participant_id) references public.session_participants(session_id,id),
  foreign key(session_id,group_id) references public.session_groups(session_id,id)
);
create index session_group_members_group on public.session_group_members(session_id,group_id);
create table public.session_group_changes (
  session_id uuid not null references public.session_execution(session_id),
  revision integer not null,
  actor_id uuid not null,
  source text not null check(source in ('host','removal')),
  reason text not null,
  execution_revision integer not null,
  activity_index integer not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(session_id,revision)
);
create table public.session_group_commands (
  session_id uuid not null references public.session_execution(session_id),
  operation_id uuid not null,
  actor_id uuid not null,
  request_digest text not null,
  receipt jsonb not null,
  primary key(session_id,operation_id)
);
alter table public.session_group_state enable row level security;
alter table public.session_groups enable row level security;
alter table public.session_group_members enable row level security;
alter table public.session_group_changes enable row level security;
alter table public.session_group_commands enable row level security;
revoke all on public.session_group_state,public.session_groups,public.session_group_members,public.session_group_changes,public.session_group_commands from public,anon,authenticated,service_role;
create trigger freeze_group_change before update on public.session_group_changes for each row execute function public.freeze_work_version();
create trigger freeze_group_receipt before update on public.session_group_commands for each row execute function public.freeze_work_version();

-- Internal minimal state; never join individual work, accounts or credentials.
create function public.group_mapping(p_session uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'ordinal',g.ordinal) order by g.ordinal) from public.session_groups g where g.session_id=p_session and not g.retired),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('participant',m.participant_id,'group',m.group_id) order by m.participant_id) from public.session_group_members m where m.session_id=p_session),'[]'::jsonb));
$$;

create function public.read_groups(p_session uuid,p_credential_hash text default null,p_host boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; e public.session_execution; s public.sessions; roster jsonb; result jsonb; own_group uuid;
begin
  actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
  select * into e from public.session_execution where session_id=p_session;
  if not found then return null; end if;
  select * into s from public.sessions where id=p_session;
  s:=public.effective_session(s);
  result:=jsonb_build_object('session',p_session,'version',e.version_id,'execution_revision',e.revision,
    'activity_index',e.current_index,'state',case when s.state='ended' then 'completed' else e.state end,
    'revision',coalesce((select revision from public.session_group_state where session_id=p_session),0));
  if p_host then
    select coalesce(jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'group',m.group_id) order by p.id),'[]'::jsonb) into roster
    from public.session_participants p left join public.session_group_members m on m.session_id=p_session and m.participant_id=p.id
    where p.session_id=p_session and p.state='admitted';
    return result||jsonb_build_object('members',roster,'roster',encode(extensions.digest((select coalesce(jsonb_agg(jsonb_build_object('participant',v->'participant','name',v->'name') order by v->>'participant'),'[]'::jsonb)::text from jsonb_array_elements(roster) v),'sha256'),'hex'),
      'groups',public.group_mapping(p_session)->'groups',
      'next_ordinal',coalesce((select next_ordinal from public.session_group_state where session_id=p_session),1),
      'history',coalesce((select jsonb_agg(to_jsonb(c) order by c.revision desc) from public.session_group_changes c where c.session_id=p_session),'[]'::jsonb));
  end if;
  select group_id into own_group from public.session_group_members where session_id=p_session and participant_id=actor;
  return result||jsonb_build_object('group',(select jsonb_build_object('id',id,'ordinal',ordinal) from public.session_groups where session_id=p_session and id=own_group and not retired),
    'members',coalesce((select jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name) order by p.id)
      from public.session_group_members m join public.session_participants p on p.session_id=m.session_id and p.id=m.participant_id
      where m.session_id=p_session and m.group_id=own_group and p.state='admitted'),'[]'::jsonb));
end;
$$;

-- Legacy admission callers get identical atomic cleanup without an app upgrade.
create function public.clear_removed_group_member() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_value jsonb; rev integer; e public.session_execution;
begin
  if old.state='admitted' and new.state<>'admitted' and exists(select 1 from public.session_group_members where session_id=old.session_id and participant_id=old.id) then
    before_value:=public.group_mapping(old.session_id);
    delete from public.session_group_members where session_id=old.session_id and participant_id=old.id;
    update public.session_group_state set revision=revision+1 where session_id=old.session_id returning revision into rev;
    select * into e from public.session_execution where session_id=old.session_id;
    insert into public.session_group_changes values(old.session_id,rev,coalesce(auth.uid(),new.decided_by),'removal','Participant removed',e.revision,e.current_index,before_value,public.group_mapping(old.session_id),clock_timestamp());
  end if;
  return new;
end;
$$;
create trigger clear_removed_group_member before update of state on public.session_participants for each row execute function public.clear_removed_group_member();

create function public.group_command(p_session uuid,p_operation uuid,p_request jsonb) returns jsonb
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
  delete from public.session_group_members where session_id=p_session;
  insert into public.session_group_members(session_id,participant_id,group_id)
    select p_session,(v->>'participant')::uuid,(mapping->>(v->>'group'))::uuid from jsonb_array_elements(p_request->'members') v where v->>'group' is not null;
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
  return result;
end;
$$;
revoke all on function public.group_mapping(uuid),public.clear_removed_group_member(),public.read_groups(uuid,text,boolean),public.group_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_groups(uuid,text,boolean) to anon,authenticated;
grant execute on function public.group_command(uuid,uuid,jsonb) to authenticated;

create or replace function public.execution_problems(p_content jsonb) returns text[]
language plpgsql set search_path = '' as $$
declare v_problems text[] := public.workshop_problems(p_content); v_item record;
begin
  for v_item in select value, ordinality from jsonb_array_elements(p_content->'activities') with ordinality loop
    if v_item.value->>'scope' <> 'individual' then
      v_problems := array_append(v_problems, format('Activity %s needs group-work support, which is not available yet.',v_item.ordinality));
    end if;
    if v_item.value->'input' <> 'null'::jsonb then
      v_problems := array_append(v_problems, format('Activity %s needs a saved earlier answer, which is not available yet.',v_item.ordinality));
    end if;
  end loop;
  return v_problems;
end;
$$;
