-- Title: Add fixed prior-output inputs
-- Evidence owns exact-field delivery; execution and access retain their existing authority.
create table public.input_capability(singleton boolean primary key default true check(singleton), enabled boolean not null default false, generation uuid not null default gen_random_uuid());
insert into public.input_capability(singleton) values(true);
create function public.input_capability_changed() returns trigger language plpgsql set search_path='' as $$
begin
  new.generation:=case when new.enabled is distinct from old.enabled then gen_random_uuid() else old.generation end;
  return new;
end $$;
create trigger input_capability_changed before update on public.input_capability for each row execute function public.input_capability_changed();
create table public.input_bindings(
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.sessions(id),
  version_id uuid not null references public.workshop_versions(id), activity_id text not null,
  owner_id uuid not null, owner_kind text not null check(owner_kind in ('individual','group')),
  participant_id uuid generated always as (case when owner_kind='individual' then owner_id end) stored,
  group_id uuid generated always as (case when owner_kind='group' then owner_id end) stored,
  source_activity text not null, field_id text not null, attempt_id uuid not null, ordinal integer not null,
  acceptance_id uuid, actor_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  unique(session_id,version_id,activity_id,owner_id),
  foreign key(session_id,version_id) references public.session_execution(session_id,version_id),
  foreign key(session_id,participant_id) references public.session_participants(session_id,id),
  foreign key(session_id,group_id) references public.session_groups(session_id,id)
);
-- No source FK: authorized erasure must leave a non-content tombstone, never a fallback copy.
create table public.input_grants(
  id uuid primary key default gen_random_uuid(), binding_id uuid not null references public.input_bindings(id),
  participant_id uuid not null, interval_id uuid, actor_id uuid not null, reason text not null,
  created_at timestamptz not null default clock_timestamp(), revoked_at timestamptz,
  revoked_by uuid, revocation_reason text
);
create unique index active_input_grant on public.input_grants(binding_id,participant_id) where revoked_at is null;
create table public.input_commands(
  operation_id uuid primary key, session_id uuid not null references public.sessions(id), actor_id uuid not null,
  request_digest text not null, receipt jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.work_attempts add column input_binding_id uuid references public.input_bindings(id);
do $$ declare n text; begin
  foreach n in array array['input_capability','input_bindings','input_grants','input_commands'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
  end loop;
end $$;
create trigger freeze_input_binding before update on public.input_bindings for each row execute function public.freeze_work_version();
create trigger freeze_input_receipt before update on public.input_commands for each row execute function public.freeze_work_version();

create function public.lock_input_capability() returns boolean language plpgsql security definer set search_path='' as $$
declare result boolean; begin select enabled into result from public.input_capability where singleton for share; return result; end $$;

create function public.input_grant_valid(p_grant uuid) returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.input_grants g join public.input_bindings b on b.id=g.binding_id
    join public.session_participants p on p.session_id=b.session_id and p.id=g.participant_id
    join public.work_attempts t on t.id=b.attempt_id and t.session_id=b.session_id and t.owner_id=b.owner_id and t.activity_id=b.source_activity
    where g.id=p_grant and g.revoked_at is null and p.state='admitted' and
      ((b.owner_kind='individual' and g.participant_id=b.owner_id and g.interval_id is null) or
       (b.owner_kind='group' and exists(select 1 from public.group_membership_intervals i join public.session_groups sg on sg.id=i.group_id and sg.session_id=i.session_id
         where i.id=g.interval_id and i.session_id=b.session_id and i.group_id=b.owner_id and i.participant_id=g.participant_id and i.ended_at is null and not sg.retired))));
$$;
create function public.input_write_allowed(p_session uuid,p_owner uuid,p_activity text,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
  select case when a->'input'='null'::jsonb then true else
    coalesce((select enabled from public.input_capability where singleton),false) and exists(
      select 1 from public.input_bindings b join public.input_grants g on g.binding_id=b.id
      where b.session_id=p_session and b.version_id=e.version_id and b.activity_id=p_activity and b.owner_id=p_owner
        and g.participant_id=p_actor and public.input_grant_valid(g.id)) end
  from public.session_execution e join public.workshop_versions v on v.id=e.version_id cross join lateral jsonb_array_elements(v.content->'activities') a
  where e.session_id=p_session and a->>'id'=p_activity;
$$;
create function public.require_input_write(p_session uuid,p_owner uuid,p_activity text,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.session_execution e join public.workshop_versions v on v.id=e.version_id cross join lateral jsonb_array_elements(v.content->'activities') a
    where e.session_id=p_session and a->>'id'=p_activity and a->'input'<>'null'::jsonb) then
    perform 1 from public.work_attempts t join public.input_bindings b on b.attempt_id=t.id where b.session_id=p_session and b.owner_id=p_owner and b.activity_id=p_activity for share of t;
    if not public.lock_input_capability() or not coalesce(public.input_write_allowed(p_session,p_owner,p_activity,p_actor),false) then raise exception 'input_access_required' using errcode='42501'; end if;
  end if;
end $$;

create function public.input_field_projection(p_attempt uuid,p_field text) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('attempt',t.id,'ordinal',t.ordinal,'source_activity',a->>'id','source_title',a->>'title',
    'field',f,'value',t.content->>p_field,'owner',t.owner_id,'kind',t.owner_kind,'submitter',t.submitted_by,
    'authors',case when t.group_id is null then jsonb_build_array(t.submitted_by) else coalesce(t.snapshot->'lineage'->p_field->'authors','[]'::jsonb) end,
    'acceptance',(select jsonb_build_object('attempt',ac.attempt_id,'actor',ac.actor_id,'reason',ac.reason,'accepted_at',ac.accepted_at) from public.work_partial_acceptances ac where ac.attempt_id=t.id))
  from public.work_attempts t join public.work_items w on w.session_id=t.session_id and w.owner_id=t.owner_id and w.activity_id=t.activity_id
  join public.workshop_versions v on v.id=w.version_id cross join lateral jsonb_array_elements(v.content->'activities') a cross join lateral jsonb_array_elements(a->'outputs') f
  where t.id=p_attempt and a->>'id'=t.activity_id and f->>'id'=p_field for share of t;
$$;

-- Called only behind host authorization and a session lock. The digest includes changes
-- that invalidate confirmation but contains no retrievable source content itself.
create function public.input_preview(p_session uuid,p_index integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.session_execution; a jsonb; who record; b public.input_bindings; t public.work_attempts;
  candidates jsonb:='[]'; recipients jsonb; selected jsonb; problems text[]:='{}'; preview_state jsonb; latest uuid; token text;
begin
  select * into e from public.session_execution where session_id=p_session;
  select content->'activities'->p_index into a from public.workshop_versions where id=e.version_id;
  if a is null or a->'input'='null'::jsonb then return null; end if;
  if not (select enabled from public.input_capability where singleton) then problems:=array_append(problems,'Fixed inputs are temporarily unavailable.'); end if;
  if a->>'scope'='group' then problems:=problems||public.group_readiness(p_session); end if;
  for who in
    select p.id owner_id,p.display_name label from public.session_participants p where a->>'scope'='individual' and p.session_id=p_session and p.state='admitted'
    union all
    select g.id,'Group '||g.ordinal from public.session_groups g where a->>'scope'='group' and g.session_id=p_session and not g.retired
      and exists(select 1 from public.session_group_members m join public.session_participants p on p.id=m.participant_id and p.session_id=m.session_id where m.session_id=p_session and m.group_id=g.id and p.state='admitted')
    order by owner_id
  loop
    select * into b from public.input_bindings where session_id=p_session and version_id=e.version_id and activity_id=a->>'id' and owner_id=who.owner_id;
    select id into latest from public.work_attempts where session_id=p_session and owner_id=who.owner_id and activity_id=a->'input'->>'activity' order by ordinal desc limit 1;
    select * into t from public.work_attempts where id=coalesce(b.attempt_id,latest) for share;
    if t.id is null or not public.work_nonblank(t.content->>(a->'input'->>'field')) or
      (cardinality(t.missing)>0 and not exists(select 1 from public.work_partial_acceptances where attempt_id=t.id)) then
      problems:=array_append(problems,who.label||' needs a nonempty, submitted source field and acceptance of any incomplete submission.');
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'interval',i.id,
      'granted',exists(select 1 from public.input_grants g where g.binding_id=b.id and g.participant_id=p.id and public.input_grant_valid(g.id))) order by p.id),'[]'::jsonb)
      into recipients from public.session_participants p left join public.group_membership_intervals i on i.session_id=p.session_id and i.participant_id=p.id and i.group_id=who.owner_id and i.ended_at is null
      where p.session_id=p_session and p.state='admitted' and ((a->>'scope'='individual' and p.id=who.owner_id) or (a->>'scope'='group' and i.id is not null));
    selected:=public.input_field_projection(t.id,a->'input'->>'field');
    candidates:=candidates||jsonb_build_array(jsonb_build_object('owner',who.owner_id,'label',who.label,'binding',b.id,'source',selected,'latest',latest,'recipients',recipients));
  end loop;
  preview_state:=jsonb_build_object('coordination',public.group_work_context(p_session),'version',e.version_id,'activity',a->>'id','candidates',candidates,'problems',problems,
    'capability',(select to_jsonb(c) from public.input_capability c),'group_enabled',public.group_work_enabled(),
    'endpoints',(select jsonb_agg(jsonb_build_array(id,credential_hash,state) order by id) from public.session_participants where session_id=p_session),
    'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from public.input_grants g join public.input_bindings ib on ib.id=g.binding_id where ib.session_id=p_session));
  token:=encode(extensions.digest(preview_state::text,'sha256'),'hex');
  return jsonb_build_object('token',token,'activity',a->>'id','candidates',candidates,'problems',problems);
end $$;

create function public.consume_inputs(p_session uuid,p_index integer,p_preview jsonb,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare e public.session_execution; a jsonb; c jsonb; r jsonb; bid uuid;
begin
  if p_preview is null then return; end if;
  if not public.lock_input_capability() then raise exception 'input_unavailable'; end if;
  if jsonb_array_length(p_preview->'problems')>0 then raise exception 'input_prerequisite' using detail=(p_preview->'problems')::text; end if;
  select * into e from public.session_execution where session_id=p_session;
  select content->'activities'->p_index into a from public.workshop_versions where id=e.version_id;
  if a->>'scope'='group' and not public.lock_group_capability() then raise exception 'input_unavailable'; end if;
  for c in select value from jsonb_array_elements(p_preview->'candidates') loop
    bid:=(c->>'binding')::uuid;
    if bid is null then
      insert into public.input_bindings(session_id,version_id,activity_id,owner_id,owner_kind,source_activity,field_id,attempt_id,ordinal,acceptance_id,actor_id)
        values(p_session,e.version_id,a->>'id',(c->>'owner')::uuid,a->>'scope',a->'input'->>'activity',a->'input'->>'field',
          (c->'source'->>'attempt')::uuid,(c->'source'->>'ordinal')::integer,(c->'source'->'acceptance'->>'attempt')::uuid,auth.uid()) returning id into bid;
    end if;
    for r in select value from jsonb_array_elements(c->'recipients') where not (value->>'granted')::boolean loop
      update public.input_grants set revoked_at=clock_timestamp(),revoked_by=auth.uid(),revocation_reason='Membership interval ended'
        where binding_id=bid and participant_id=(r->>'participant')::uuid and revoked_at is null;
      insert into public.input_grants(binding_id,participant_id,interval_id,actor_id,reason) values(bid,(r->>'participant')::uuid,(r->>'interval')::uuid,auth.uid(),p_reason);
    end loop;
  end loop;
end $$;

create function public.input_command(p_session uuid,p_operation uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; e public.session_execution; s public.sessions; preview jsonb; saved public.input_commands; digest text; result jsonb;
begin
  if p_operation is null or p_request is null or octet_length(p_request::text)>4096 or not extensions.jsonb_matches_schema('{"type":"object","additionalProperties":false,"required":["command","reason"],"properties":{"command":{"enum":["resolve","revoke"]},"reason":{"type":"string","minLength":1,"maxLength":500},"token":{"type":"string","pattern":"^[a-f0-9]{64}$"},"binding":{"type":"string","format":"uuid"},"grant":{"type":["string","null"],"format":"uuid"}}}'::json,p_request)
    or not public.work_nonblank(p_request->>'reason') then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  perform 1 from public.sessions where id=p_session for update;
  actor:=public.authorize_work(p_session,null,null,true);
  digest:=encode(extensions.digest(p_request::text,'sha256'),'hex');
  select * into saved from public.input_commands where operation_id=p_operation;
  if found then
    if (saved.session_id,saved.actor_id,saved.request_digest) is distinct from (p_session,actor,digest) then raise exception 'operation_reused'; end if;
    perform public.authorize_work(p_session,null,null,true);
    return saved.receipt;
  end if;
  if p_request->>'command'='revoke' then
    if p_request ? 'token' or not exists(select 1 from public.input_bindings where id=(p_request->>'binding')::uuid and session_id=p_session) then raise exception 'invalid_input'; end if;
    if p_request->>'grant' is not null and not exists(select 1 from public.input_grants where id=(p_request->>'grant')::uuid and binding_id=(p_request->>'binding')::uuid) then raise exception 'invalid_input'; end if;
    update public.input_grants set revoked_at=clock_timestamp(),revoked_by=actor,revocation_reason=p_request->>'reason'
      where binding_id=(p_request->>'binding')::uuid and (p_request->>'grant' is null or id=(p_request->>'grant')::uuid) and revoked_at is null;
  else
    if p_request ?| array['binding','grant'] or not public.lock_input_capability() then raise exception 'input_unavailable'; end if;
    select * into e from public.session_execution where session_id=p_session;
    select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
    if s.state<>'open' or e.state not in ('live','paused') or e.deadline<=clock_timestamp() then raise exception 'input_closed'; end if;
    preview:=public.input_preview(p_session,e.current_index);
    if preview is null or p_request->>'token' is distinct from preview->>'token' then raise exception 'stale_input'; end if;
    perform public.consume_inputs(p_session,e.current_index,preview,p_request->>'reason');
  end if;
  perform public.authorize_work(p_session,null,null,true);
  if p_request->>'command'='resolve' and e.deadline<=clock_timestamp() then raise exception 'input_closed'; end if;
  result:=jsonb_build_object('committed',true);
  insert into public.input_commands(operation_id,session_id,actor_id,request_digest,receipt) values(p_operation,p_session,actor,digest,result);
  perform public.authorize_work(p_session,null,null,true);
  if p_request->>'command'='resolve' and e.deadline<=clock_timestamp() then raise exception 'input_closed'; end if;
  return result;
end $$;

create function public.read_inputs(p_session uuid,p_credential_hash text default null,p_host boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; e public.session_execution; s public.sessions; a jsonb; b public.input_bindings; g public.input_grants; items jsonb:='[]'; projection jsonb; preview jsonb; ttl numeric:=5000;
begin
  actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
  select * into e from public.session_execution where session_id=p_session;
  select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
  select content->'activities'->e.current_index into a from public.workshop_versions where id=e.version_id;
  for b in select * from public.input_bindings where session_id=p_session order by created_at,id loop
    select * into g from public.input_grants where binding_id=b.id and participant_id=actor and public.input_grant_valid(id);
    if not p_host and g.id is null then continue; end if;
    projection:=public.input_field_projection(b.attempt_id,b.field_id);
    if projection is null then continue; end if;
    if not p_host and projection->'acceptance'<>'null'::jsonb then
      projection:=jsonb_set(projection,'{acceptance}',jsonb_build_object('attempt',projection->'acceptance'->>'attempt'));
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('binding',b.id,'activity',b.activity_id,'grant',g.id,'interval',g.interval_id,'source',projection,
      'grants',case when p_host then (select coalesce(jsonb_agg(jsonb_build_object('id',ig.id,'participant',ig.participant_id,'interval',ig.interval_id,'valid',public.input_grant_valid(ig.id)) order by ig.created_at),'[]'::jsonb) from public.input_grants ig where ig.binding_id=b.id) else null end));
  end loop;
  if p_host and s.state='open' and e.state in ('live','paused') then preview:=public.input_preview(p_session,e.current_index); end if;
  perform public.authorize_work(p_session,null,p_credential_hash,p_host);
  if s.ended_at is not null then ttl:=least(ttl,extract(epoch from s.ended_at+interval '90 days'-clock_timestamp())*1000); end if;
  if p_host then ttl:=least(ttl,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,
    (select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid)); end if;
  return jsonb_build_object('session',p_session,'actor',actor,'endpoint',encode(extensions.digest(coalesce(p_credential_hash,auth.jwt()->>'session_id'),'sha256'),'hex'),
    'current',a,'items',items,'ttl_ms',greatest(0,ttl),
    'preview',preview);
end $$;

-- Attempts retain the binding, not a second copy of the input content.
create function public.attach_input_binding() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.input_binding_id:=(select b.id from public.input_bindings b where b.session_id=new.session_id and b.owner_id=coalesce(new.participant_id,new.group_id) and b.activity_id=new.activity_id);
  return new;
end $$;
create trigger attach_input_binding before insert on public.work_attempts for each row execute function public.attach_input_binding();

create or replace function public.workshop_problems(p_content jsonb)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_activity jsonb;
  v_position bigint;
  v_target bigint;
  v_objective_ids text[];
  v_activity_ids text[];
  v_minutes numeric;
begin
  if not extensions.jsonb_matches_schema(public.workshop_content_schema(), p_content) then
    return array['The agenda is not in a valid format.'];
  end if;
  select coalesce(array_agg(o ->> 'id'), '{}') into v_objective_ids
  from jsonb_array_elements(p_content -> 'objectives') o;
  select coalesce(array_agg(a ->> 'id' order by n), '{}') into v_activity_ids
  from jsonb_array_elements(p_content -> 'activities') with ordinality as t(a, n);

  if cardinality(v_activity_ids) = 0 then
    v_problems := v_problems || 'Add at least one activity.'::text;
  end if;
  if cardinality(v_objective_ids) <> (select count(distinct x) from unnest(v_objective_ids) x)
    or cardinality(v_activity_ids) <> (select count(distinct x) from unnest(v_activity_ids) x) then
    v_problems := v_problems || 'Objectives and activities need unique identifiers.'::text;
  end if;
  v_problems := v_problems || coalesce((
    select array_agg(format('Objective %s needs text.', n) order by n)
    from jsonb_array_elements(p_content -> 'objectives') with ordinality as t(o, n)
    where o ->> 'text' !~ '[^[:space:]]'
  ), '{}');

  for v_activity, v_position in
    select a, n from jsonb_array_elements(p_content -> 'activities') with ordinality as t(a, n)
  loop
    if v_activity ->> 'title' !~ '[^[:space:]]' then
      v_problems := v_problems || format('Activity %s needs a title.', v_position);
    end if;
    if v_activity ->> 'instructions' !~ '[^[:space:]]' then
      v_problems := v_problems || format('Activity %s needs instructions.', v_position);
    end if;
    if jsonb_array_length(v_activity -> 'outputs') = 0 then
      v_problems := v_problems || format('Activity %s needs at least one answer field.', v_position);
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_activity -> 'outputs') f
      where f ->> 'label' !~ '[^[:space:]]'
    ) then
      v_problems := v_problems || format('Activity %s has an answer field without a label.', v_position);
    end if;
    if (select count(*) <> count(distinct f ->> 'id')
        from jsonb_array_elements(v_activity -> 'outputs') f) then
      v_problems := v_problems || format('Activity %s has duplicate answer fields.', v_position);
    end if;
    if jsonb_typeof(v_activity -> 'input') = 'object' then
      v_target := array_position(v_activity_ids, v_activity -> 'input' ->> 'activity');
      if v_target is not null and p_content->'activities'->(v_target::integer-1)->>'scope' is distinct from v_activity->>'scope' then
        v_problems:=array_append(v_problems,format('Activity %s requires input with the same individual or group ownership.',v_position));
      end if;
      if v_target is null then
        v_problems := v_problems || format('Activity %s uses input from an activity that no longer exists.', v_position);
      elsif v_target >= v_position then
        v_problems := v_problems || format('Activity %s can only use input from an earlier activity.', v_position);
      elsif not exists (
        select 1
        from jsonb_array_elements(p_content -> 'activities' -> (v_target::int - 1) -> 'outputs') f
        where f ->> 'id' = v_activity -> 'input' ->> 'field'
      ) then
        v_problems := v_problems || format('Activity %s uses an answer field that no longer exists.', v_position);
      end if;
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_activity -> 'objectives') ref
      where not ref = any (v_objective_ids)
    ) then
      v_problems := v_problems || format('Activity %s links an objective that no longer exists.', v_position);
    end if;
  end loop;

  -- numeric: JSON Schema accepts 10.0 as an integer.
  select coalesce(sum((a ->> 'minutes')::numeric), 0) into v_minutes
  from jsonb_array_elements(p_content -> 'activities') a;
  if v_minutes > 240 then
    v_problems := v_problems || format(
      'The activities are planned for %s minutes; a session lasts at most 240 minutes (4 hours).',
      v_minutes
    );
  end if;
  return v_problems;
end;
$$;

create or replace function public.prepare_execution_v3(p_version uuid, p_operation uuid) returns uuid
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
  if exists(select 1 from jsonb_array_elements(v_version.content->'activities') a where a->'input'<>'null'::jsonb) and not public.lock_input_capability() then raise exception 'input_unavailable'; end if;
  v_problems := public.workshop_problems(v_version.content);
  if cardinality(v_problems) > 0 then
    raise exception 'unsupported_agenda' using detail = array_to_string(v_problems,E'\n');
  end if;
  insert into public.sessions(workspace_id,title) values(v_workshop.workspace_id,v_workshop.title) returning id into v_session;
  insert into public.session_execution(session_id,version_id,prepare_operation) values(v_session,p_version,p_operation);
  perform public.authorize_work(v_session,null,null,true);
  return v_session;
end;
$$;

create or replace function public.execution_command_v3(p_session uuid, p_operation uuid, p_revision integer, p_command text, p_context text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.sessions; v_execution public.session_execution; v_content jsonb;
  v_request jsonb := jsonb_build_object('command',p_command,'revision',p_revision);
  v_previous public.execution_commands; v_result jsonb; v_problems text[]; v_now timestamptz; input_preview jsonb;
begin
  v_request:=v_request||jsonb_build_object('context',p_context,'protocol',3);
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
    perform public.authorize_work(p_session,null,null,true);
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
    v_problems := public.workshop_problems(v_content);
    if exists(select 1 from jsonb_array_elements(v_content->'activities') a where a->'input'<>'null'::jsonb) and not public.lock_input_capability() then raise exception 'input_unavailable'; end if;
    input_preview:=public.input_preview(p_session,v_execution.current_index+1);
    if p_context is distinct from coalesce(input_preview->>'token',public.group_context_token(p_session)) then raise exception 'stale_execution'; end if;
    if v_content->'activities'->(v_execution.current_index+1)->>'scope'='group' then
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
      perform public.consume_inputs(p_session,v_execution.current_index+1,input_preview,'Activity advance confirmed');
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

create or replace function public.work_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null) returns jsonb
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
  if activity is null or activity->>'scope'<>'individual' then raise exception 'work_closed'; end if;
  if not is_host then perform public.require_input_write(p_session,person,activity->>'id',actor); end if;
  if p_request ? 'reason' and jsonb_typeof(p_request->'reason')<>'string' then raise exception 'invalid_work'; end if;
  reason:=replace(coalesce(p_request->>'reason',''),E'\r\n',E'\n');
  if char_length(reason)>500 then raise exception 'invalid_work'; end if;
  if cmd='save' then
    if jsonb_typeof(p_request->'content') is distinct from 'object' then raise exception 'invalid_work'; end if;
    if exists(select 1 from jsonb_object_keys(p_request->'content') k where not exists
      (select 1 from jsonb_array_elements(activity->'outputs') f where f->>'id'=k)) then raise exception 'invalid_work'; end if;
    for field in select f.value from jsonb_array_elements(activity->'outputs') f loop
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
    perform public.authorize_work(p_session,person,p_credential_hash,is_host);
    return old.receipt;
  end if;
  if s.state<>'open' or e.state not in ('live','paused') or e.deadline<=clock_timestamp() then raise exception 'work_closed'; end if;
  insert into public.work_items(session_id,participant_id,activity_id,version_id)
    values(p_session,person,activity->>'id',e.version_id) on conflict do nothing;
  select * into w from public.work_items where session_id=p_session and participant_id=person and activity_id=activity->>'id' for update;
  perform public.authorize_work(p_session,person,p_credential_hash,is_host);
  if e.deadline<=clock_timestamp() then raise exception 'work_closed'; end if;
  if w.window_revision is distinct from (p_request->>'window_revision')::integer then raise exception 'work_conflict'; end if;
  if cmd in ('reopen','close') then
    if activity->>'id'=(select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id)
      or not public.work_nonblank(reason) then raise exception 'invalid_work'; end if;
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
        if previous.id is null or cardinality(previous.missing)=0 or not public.work_nonblank(reason)
          or exists(select 1 from public.work_partial_acceptances where attempt_id=previous.id) then raise exception 'invalid_work'; end if;
        insert into public.work_partial_acceptances(attempt_id,actor_id,reason) values(previous.id,actor,reason);
      else
        if w.revision=0 or w.revision is distinct from (p_request->>'revision')::integer then raise exception 'work_conflict'; end if;
        if w.latest>0 and not public.work_nonblank(reason) then raise exception 'invalid_work'; end if;
        select coalesce(array_agg(f->>'id'),'{}') into missing from jsonb_array_elements(activity->'outputs') f where not public.work_nonblank(coalesce(w.content->>(f->>'id'),''));
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
  perform public.authorize_work(p_session,person,p_credential_hash,is_host);
  if e.deadline<=clock_timestamp() then raise exception 'work_closed'; end if;
  return receipt;
end;
$$;

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
  if not is_host then perform public.require_input_write(p_session,gid,aid,actor); end if;
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

create or replace function public.check_group_work_owner() returns trigger language plpgsql set search_path='' as $$
declare a jsonb;
begin
  if tg_op='UPDATE' and (new.session_id,new.participant_id,new.group_id,new.activity_id,new.version_id) is distinct from
    (old.session_id,old.participant_id,old.group_id,old.activity_id,old.version_id) then raise exception 'work_owner_frozen'; end if;
  if new.group_id is not null then
    select v.value into a from public.workshop_versions w cross join lateral jsonb_array_elements(w.content->'activities') v where w.id=new.version_id and v.value->>'id'=new.activity_id;
    if a is null or a->>'scope'<>'group' then raise exception 'invalid_group_work'; end if;
    if tg_op='INSERT' and not exists(select 1 from public.session_groups where session_id=new.session_id and id=new.group_id and not retired) then raise exception 'invalid_group_work'; end if;
  end if;
  return new;
end $$;

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
      and public.input_write_allowed(p_session,p.id,a.value->>'id',p.id) and (a.ordinality-1=e.current_index or coalesce(w.reopened,false)),
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
        'writable',(p_host or public.input_write_allowed(p_session,w.group_id,w.activity_id,actor)) and public.group_work_enabled() and s.state='open' and e.state in ('live','paused') and
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

create function public.host_execution_v3(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; preview jsonb;
begin
  result:=public.host_execution_v2(p_session);
  preview:=public.input_preview(p_session,(select current_index+1 from public.session_execution where session_id=p_session));
  perform public.authorize_work(p_session,null,null,true);
  return result||jsonb_build_object('ttl_ms',least(5000,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,(select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid)),'inputs',preview,'context',coalesce(preview->>'token',result->>'context'));
end $$;

create function public.freeze_input_grant() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)-array['revoked_at','revoked_by','revocation_reason']) is distinct from (to_jsonb(old)-array['revoked_at','revoked_by','revocation_reason'])
    or old.revoked_at is not null or new.revoked_at is null or new.revoked_by is null or not public.work_nonblank(new.revocation_reason) then raise exception 'input_grant_frozen'; end if;
  return new;
end $$;
create trigger freeze_input_grant before update on public.input_grants for each row execute function public.freeze_input_grant();

-- Private owner functions cannot be invoked as an authorization bypass.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in (
    'input_capability_changed','lock_input_capability','input_grant_valid','input_write_allowed','require_input_write',
    'input_field_projection','input_preview','consume_inputs','input_command','read_inputs','attach_input_binding','freeze_input_grant',
    'prepare_execution_v3','execution_command_v3','host_execution_v3') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.prepare_execution_v3(uuid,uuid),public.execution_command_v3(uuid,uuid,integer,text,text),public.host_execution_v3(uuid),public.input_command(uuid,uuid,jsonb) to authenticated;
grant execute on function public.read_inputs(uuid,text,boolean) to anon,authenticated;

-- Older prepare RPCs must refuse linked agendas even when given a v3 operation ID.
do $$ declare signature text; definition text; marker text:='  if p_operation is null then'; begin
  foreach signature in array array['public.prepare_execution(uuid,uuid)','public.prepare_execution_v2(uuid,uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(marker in definition)=0 then raise exception 'prepare guard insertion point missing'; end if;
    definition:=replace(definition,marker,
      '  if exists(select 1 from jsonb_array_elements(v_version.content->''activities'') a where a->''input''<>''null''::jsonb) then raise exception ''unsupported_agenda'' using detail=(select string_agg(format(''Activity %s requires fixed-input execution support.'',n),E''\n'') from jsonb_array_elements(v_version.content->''activities'') with ordinality as t(a,n) where a->''input''<>''null''::jsonb); end if;'||chr(10)||marker);
    execute definition;
  end loop;
end $$;

-- A nullable RPC flag must never become a third authorization mode.
create or replace function public.authorize_work(p_session uuid,p_participant uuid,p_hash text,p_host boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.sessions; person public.session_participants;
begin
  if p_host is null then raise exception 'not_allowed' using errcode='42501'; end if;
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
