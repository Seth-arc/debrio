-- Title: Add scoped text link resources
-- Resource authority is independent of Evidence ownership and media-room presence.
create table public.resource_capability(singleton boolean primary key default true check(singleton),enabled boolean not null default false,generation uuid not null default gen_random_uuid());
insert into public.resource_capability(singleton) values(true);
create trigger resource_capability_changed before update on public.resource_capability for each row execute function public.input_capability_changed();
create table public.resources(
 id uuid primary key,workspace_id uuid not null references public.workspaces(id),created_by uuid not null references auth.users(id),
 revision integer not null check(revision>0),title text not null,kind text not null check(kind in ('text','link')),content text not null,
 created_at timestamptz not null default clock_timestamp(),unique(workspace_id,id)
);
create index resource_library_page on public.resources(workspace_id,created_at,id);
create table public.resource_versions(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,resource_id uuid not null,ordinal integer not null,
 draft_revision integer not null,title text not null,kind text not null,content text not null,created_by uuid not null,ready_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,resource_id) references public.resources(workspace_id,id),unique(resource_id,ordinal),unique(resource_id,draft_revision),unique(workspace_id,id)
);
create trigger freeze_resource_version before update on public.resource_versions for each row execute function public.freeze_work_version();
create table public.resource_checks(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,resource_id uuid not null,revision integer not null,version_id uuid,
 actor_id uuid not null,auth_session uuid not null,auth_exp timestamptz not null,url_digest text not null,started_at timestamptz not null default clock_timestamp(),
 outcome text not null default 'pending' check(outcome in ('pending','reachable','failed')),chain_digest text,final_url text,checked_at timestamptz,expires_at timestamptz,
 reviewed_at timestamptz,reviewed_by uuid
);
create index resource_check_rate on public.resource_checks(workspace_id,started_at);
create index resource_check_version_latest on public.resource_checks(version_id,started_at desc,id desc) where version_id is not null;
create index resource_check_draft_latest on public.resource_checks(resource_id,revision,started_at desc,id desc);
create table public.resource_allocations(
 id uuid primary key,session_id uuid not null references public.sessions(id),workspace_id uuid not null references public.workspaces(id),agenda_version uuid not null,
 resource_version uuid not null,revision integer not null default 1,trigger text not null check(trigger in ('start','activity','manual')),activity_id text,
 selectors jsonb not null,created_by uuid not null,released_at timestamptz,revoked_at timestamptz,revoked_by uuid,reason text,revocation_reason text,
 foreign key(session_id,agenda_version) references public.session_execution(session_id,version_id),unique(session_id,id)
);
-- Source deletion intentionally leaves only opaque references, never a cached body.
create unique index sessions_resource_scope on public.sessions(id,workspace_id);
alter table public.resource_allocations add foreign key(session_id,workspace_id) references public.sessions(id,workspace_id);
create table public.resource_recipients(
 allocation_id uuid not null,session_id uuid not null,participant_id uuid not null,generation integer not null check(generation>0),
 revoked_at timestamptz,revoked_by uuid,reason text,primary key(allocation_id,participant_id),
 foreign key(session_id,allocation_id) references public.resource_allocations(session_id,id),
 foreign key(session_id,participant_id) references public.session_participants(session_id,id)
);
create table public.resource_grants(
 id uuid primary key default gen_random_uuid(),allocation_id uuid not null,participant_id uuid not null,kind text not null check(kind in ('individual','group','shared')),
 group_id uuid,interval_id uuid,
 foreign key(allocation_id,participant_id) references public.resource_recipients(allocation_id,participant_id),
 check((kind='group')=(group_id is not null and interval_id is not null))
);
create index resource_grant_recipient on public.resource_grants(allocation_id,participant_id);
create table public.resource_notices(
 id uuid primary key default gen_random_uuid(),allocation_id uuid not null,participant_id uuid not null,generation integer not null,
 created_at timestamptz not null default clock_timestamp(),dismissed_at timestamptz,acked_endpoint text,acked_at timestamptz,
 foreign key(allocation_id,participant_id) references public.resource_recipients(allocation_id,participant_id),unique(allocation_id,participant_id,generation)
);
create unique index resource_interval_scope on public.group_membership_intervals(id,participant_id,group_id);
alter table public.resource_grants add foreign key(interval_id,participant_id,group_id) references public.group_membership_intervals(id,participant_id,group_id);
create table public.resource_commands(
 operation_id uuid primary key,workspace_id uuid not null,session_id uuid,actor_id uuid not null,request_digest text not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger freeze_resource_command before update on public.resource_commands for each row execute function public.freeze_work_version();
do $$ declare n text; begin
 foreach n in array array['resource_capability','resources','resource_versions','resource_checks','resource_allocations','resource_recipients','resource_grants','resource_notices','resource_commands'] loop
 execute format('alter table public.%I enable row level security',n); execute format('revoke all on public.%I from public,anon,authenticated,service_role',n); end loop;
end $$;

create function public.require_resource_host(p_workspace uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.workspaces where id=p_workspace for share;
 perform 1 from auth.sessions where id=nullif(auth.jwt()->>'session_id','')::uuid for share;
 if not public.owns_workspace(p_workspace) or not exists(select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid and s.user_id=auth.uid() and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) or (auth.jwt()->>'exp')::numeric<=extract(epoch from clock_timestamp()) then raise exception 'not_allowed' using errcode='42501'; end if;
end $$;
create function public.resource_allocation_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.session_id,new.workspace_id,new.agenda_version,new.created_by) is distinct from (old.id,old.session_id,old.workspace_id,old.agenda_version,old.created_by)
 or (old.released_at is not null and (new.resource_version,new.trigger,new.activity_id,new.released_at) is distinct from (old.resource_version,old.trigger,old.activity_id,old.released_at))
 or (old.revoked_at is not null and (new.revoked_at,new.revoked_by,new.revocation_reason) is distinct from (old.revoked_at,old.revoked_by,old.revocation_reason)) then raise exception 'resource_identity_frozen'; end if;
 return new;
end $$;
create trigger resource_allocation_identity before update on public.resource_allocations for each row execute function public.resource_allocation_identity();
create function public.lock_resource_capability() returns void language plpgsql security definer set search_path='' as $$
declare allowed boolean; begin select enabled into allowed from public.resource_capability where singleton for share; if not allowed then raise exception 'resource_unavailable'; end if; end $$;
create function public.resource_check_projection(p_check uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'outcome',c.outcome,'checked_at',c.checked_at,'expires_at',c.expires_at,'final_url',c.final_url,'reviewed',c.reviewed_at is not null) from public.resource_checks c where c.id=p_check;
$$;
create function public.resource_version_projection(p_version uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'resource',v.resource_id,'ordinal',v.ordinal,'title',v.title,'kind',v.kind,'content',v.content,'ready_at',v.ready_at,
 'check',public.resource_check_projection((select c.id from public.resource_checks c where c.version_id=v.id order by c.started_at desc,c.id desc limit 1))) from public.resource_versions v join public.resources r on r.id=v.resource_id and r.workspace_id=v.workspace_id where v.id=p_version;
$$;
create function public.begin_resource_check(p_workspace uuid,p_resource uuid,p_revision integer,p_version uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resources; v public.resource_versions; target text; cid uuid; begin
 perform public.require_resource_host(p_workspace); perform public.lock_resource_capability();
 -- Workspace serialization makes the rate limit atomic, with no network inside this transaction.
 perform pg_advisory_xact_lock(hashtextextended('resource-check-'||p_workspace::text,0));
 select * into r from public.resources where id=p_resource and workspace_id=p_workspace for update;
 if r.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_version is null then if r.revision is distinct from p_revision or r.kind<>'link' then raise exception 'resource_conflict'; end if; target:=r.content;
 else select * into v from public.resource_versions where id=p_version and resource_id=r.id and kind='link'; if v.id is null then raise exception 'not_allowed' using errcode='42501'; end if; target:=v.content; end if;
 if (select count(*) from public.resource_checks where workspace_id=p_workspace and started_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'resource_check_limited'; end if;
 perform public.require_resource_host(p_workspace);
 insert into public.resource_checks(workspace_id,resource_id,revision,version_id,actor_id,auth_session,auth_exp,url_digest)
 values(p_workspace,r.id,coalesce(v.draft_revision,r.revision),v.id,auth.uid(),(auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'exp')::numeric),encode(extensions.digest(target,'sha256'),'hex')) returning id into cid;
 return jsonb_build_object('check',cid,'actor',auth.uid(),'url',target);
end $$;
create function public.finish_resource_check(p_check uuid,p_outcome text,p_digest text,p_final_url text,p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.resource_checks; r public.resources; target text; begin
 select * into c from public.resource_checks where id=p_check;
 perform 1 from public.workspaces where id=c.workspace_id for share;
 perform 1 from auth.sessions where id=c.auth_session for share;
 perform public.lock_resource_capability();
 perform 1 from public.resources where id=c.resource_id for share;
 select * into c from public.resource_checks where id=p_check for update;
 if c.id is null or c.actor_id is distinct from p_actor or c.outcome<>'pending' or c.started_at<clock_timestamp()-interval '30 seconds' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into r from public.resources where id=c.resource_id and workspace_id=c.workspace_id for share;
 if not exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=c.workspace_id and w.owner_id=c.actor_id and s.id=c.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) or c.auth_exp<=clock_timestamp() then raise exception 'not_allowed' using errcode='42501'; end if;
 if c.version_id is null then if r.id is null or r.revision<>c.revision then raise exception 'resource_conflict'; end if; target:=r.content;
 else select content into target from public.resource_versions where id=c.version_id and resource_id=c.resource_id for share; end if;
 if target is null or encode(extensions.digest(target,'sha256'),'hex')<>c.url_digest then raise exception 'resource_conflict'; end if;
 if (p_outcome in ('reachable','failed')) is distinct from true or (p_outcome='reachable' and (p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_final_url is null or length(p_final_url)>2048 or p_final_url !~ '^https://')) then raise exception 'invalid_resource'; end if;
 if c.started_at<clock_timestamp()-interval '30 seconds' or c.auth_exp<=clock_timestamp() or not exists(select 1 from auth.sessions where id=c.auth_session and user_id=c.actor_id and aal='aal2' and (not_after is null or not_after>clock_timestamp())) then raise exception 'not_allowed' using errcode='42501'; end if;
 update public.resource_checks set outcome=p_outcome,chain_digest=case when p_outcome='reachable' then p_digest end,final_url=case when p_outcome='reachable' then p_final_url end,checked_at=c.started_at,expires_at=c.started_at+interval '5 minutes' where id=c.id;
 return public.resource_check_projection(c.id);
end $$;
create function public.resource_recheck_links(p_preview jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; c public.resource_checks; begin
 for item in select value from jsonb_array_elements(p_preview->'items') loop
 if item->'version'->>'kind'='link' then
 select * into c from public.resource_checks where id=(item->'version'->'check'->>'id')::uuid;
 if c.id is null or c.version_id is distinct from (item->'version'->>'id')::uuid or c.outcome<>'reachable' or c.reviewed_at is null or c.expires_at<=clock_timestamp()
 or c.id is distinct from (select id from public.resource_checks where version_id=c.version_id order by started_at desc,id desc limit 1)
 or not exists(select 1 from public.resource_versions v join public.resources r on r.id=v.resource_id where v.id=c.version_id and encode(extensions.digest(v.content,'sha256'),'hex')=c.url_digest) then raise exception 'resource_check_required'; end if;
 end if;
 end loop;
end $$;
create function public.resource_library_command(p_workspace uuid,p_operation uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resources; c public.resource_checks; previous public.resource_commands; digest text; result jsonb; rid uuid; vid uuid; cmd text:=p_request->>'command'; begin
 perform public.require_resource_host(p_workspace); if p_operation is null or jsonb_typeof(p_request) is distinct from 'object' or not p_request ? 'command' then raise exception 'invalid_resource'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 digest:=encode(extensions.digest(p_request::text,'sha256'),'hex');
 select * into previous from public.resource_commands where operation_id=p_operation;
 if found then if previous.workspace_id<>p_workspace or previous.session_id is not null or previous.actor_id<>auth.uid() or previous.request_digest<>digest then raise exception 'operation_reused'; end if; perform public.require_resource_host(p_workspace); return previous.receipt; end if;
 perform public.lock_resource_capability();
 if cmd in ('save','ready') then
 rid:=(p_request->>'resource')::uuid; if rid is null or jsonb_typeof(p_request->'revision') is distinct from 'number' or (p_request->>'revision' ~ '^[0-9]+$') is distinct from true then raise exception 'invalid_resource'; end if;
 perform pg_advisory_xact_lock(hashtextextended('resource-'||rid::text,0));
 select * into r from public.resources where id=rid for update;
 if r.id is not null and r.workspace_id<>p_workspace then raise exception 'not_allowed' using errcode='42501'; end if;
 if coalesce(r.revision,0)<>(p_request->>'revision')::integer then raise exception 'resource_conflict'; end if;
 end if;
 if cmd='save' then
 if not p_request ?& array['command','resource','revision','title','kind','content'] or p_request-array['command','resource','revision','title','kind','content']<>'{}'::jsonb or jsonb_typeof(p_request->'title') is distinct from 'string' or public.work_nonblank(p_request->>'title') is distinct from true or length(p_request->>'title')>120 or (p_request->>'kind' in ('text','link')) is distinct from true or jsonb_typeof(p_request->'content') is distinct from 'string' or public.work_nonblank(p_request->>'content') is distinct from true or length(p_request->>'content')>(case when p_request->>'kind'='text' then 20000 else 2048 end) then raise exception 'invalid_resource'; end if;
 if p_request->>'kind'='link' and (p_request->>'content' !~ '^https://[a-z0-9][a-z0-9.-]*[a-z0-9](:443)?(/|\?|$)' or split_part(split_part(p_request->>'content','://',2),'/',1) like '%@%' or p_request->>'content' ~ '[[:cntrl:][:space:]]') then raise exception 'invalid_resource'; end if;
 if r.id is null then insert into public.resources(id,workspace_id,created_by,revision,title,kind,content) values(rid,p_workspace,auth.uid(),1,p_request->>'title',p_request->>'kind',p_request->>'content') returning * into r;
 else update public.resources set revision=revision+1,title=p_request->>'title',kind=p_request->>'kind',content=p_request->>'content' where id=rid returning * into r; end if;
 result:=jsonb_build_object('committed',true,'resource',rid,'revision',r.revision);
 elsif cmd='ready' then
 if p_request-array['command','resource','revision']<>'{}'::jsonb or r.id is null then raise exception 'invalid_resource'; end if;
 if r.kind='link' then
 select * into c from public.resource_checks where resource_id=r.id and revision=r.revision and version_id is null order by started_at desc,id desc limit 1 for update;
 if c.id is null or c.outcome<>'reachable' or c.reviewed_at is null or c.expires_at<=clock_timestamp() or c.url_digest<>encode(extensions.digest(r.content,'sha256'),'hex') then raise exception 'resource_check_required'; end if; end if;
 select id into vid from public.resource_versions where resource_id=r.id and draft_revision=r.revision;
 if vid is null then insert into public.resource_versions(workspace_id,resource_id,ordinal,draft_revision,title,kind,content,created_by) values(p_workspace,r.id,coalesce((select max(ordinal) from public.resource_versions where resource_id=r.id),0)+1,r.revision,r.title,r.kind,r.content,auth.uid()) returning id into vid; end if;
 if c.id is not null then update public.resource_checks set version_id=vid where id=c.id; end if;
 result:=jsonb_build_object('committed',true,'resource',rid,'revision',r.revision,'version',vid);
 elsif cmd='approve_check' then
 if p_request-array['command','check','reviewed']<>'{}'::jsonb or p_request->'reviewed' is distinct from 'true'::jsonb then raise exception 'invalid_resource'; end if;
 select * into c from public.resource_checks where id=(p_request->>'check')::uuid and workspace_id=p_workspace;
 perform 1 from public.resources where id=c.resource_id for share;
 select * into c from public.resource_checks where id=(p_request->>'check')::uuid and workspace_id=p_workspace for update;
 if c.id is null or c.outcome<>'reachable' or c.expires_at<=clock_timestamp() then raise exception 'resource_check_required'; end if;
 select * into r from public.resources where id=c.resource_id for share;
 if r.id is null or (c.version_id is null and r.revision<>c.revision) then raise exception 'resource_conflict'; end if;
 update public.resource_checks set reviewed_at=clock_timestamp(),reviewed_by=auth.uid() where id=c.id;
 result:=jsonb_build_object('committed',true,'resource',c.resource_id);
 else raise exception 'invalid_resource'; end if;
 perform public.require_resource_host(p_workspace);
 if cmd='ready' and r.kind='link' then perform public.resource_recheck_links(jsonb_build_object('items',jsonb_build_array(jsonb_build_object('version',public.resource_version_projection(vid))))); end if;
 insert into public.resource_commands(operation_id,workspace_id,actor_id,request_digest,receipt) values(p_operation,p_workspace,auth.uid(),digest,result);
 perform public.require_resource_host(p_workspace);
 if cmd='ready' and r.kind='link' then perform public.resource_recheck_links(jsonb_build_object('items',jsonb_build_array(jsonb_build_object('version',public.resource_version_projection(vid))))); end if;
 return result;
end $$;
create function public.resource_access(p_allocation uuid,p_participant uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.resource_allocations a join public.resource_versions v on v.id=a.resource_version and v.workspace_id=a.workspace_id join public.resources r on r.id=v.resource_id and r.workspace_id=v.workspace_id
 join public.resource_recipients rr on rr.allocation_id=a.id and rr.participant_id=p_participant join public.session_participants p on p.id=rr.participant_id and p.session_id=a.session_id
 where a.id=p_allocation and a.released_at is not null and a.revoked_at is null and rr.revoked_at is null and p.state='admitted' and exists(select 1 from public.resource_grants g where g.allocation_id=a.id and g.participant_id=p_participant and
 (g.kind in ('individual','shared') or exists(select 1 from public.group_membership_intervals i join public.session_groups sg on sg.id=i.group_id and sg.session_id=i.session_id where i.id=g.interval_id and i.group_id=g.group_id and i.participant_id=p_participant and i.session_id=a.session_id and i.ended_at is null and not sg.retired))));
$$;
create function public.resource_bases(p_allocation uuid,p_participant uuid) returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',g.kind,'group',g.group_id,'interval',g.interval_id) order by g.kind,g.group_id),'[]'::jsonb) from public.resource_grants g join public.resource_allocations a on a.id=g.allocation_id where g.allocation_id=p_allocation and g.participant_id=p_participant and
 (g.kind in ('individual','shared') or exists(select 1 from public.group_membership_intervals i join public.session_groups sg on sg.id=i.group_id and sg.session_id=i.session_id where i.id=g.interval_id and i.group_id=g.group_id and i.participant_id=p_participant and i.session_id=a.session_id and i.ended_at is null and not sg.retired));
$$;
create function public.build_resource_preview(p_session uuid,p_request jsonb,p_due boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; e public.session_execution; s public.sessions; v jsonb; selector jsonb; person record; entry record; recipients jsonb:='{}'; resolved jsonb:='[]'; lost jsonb:='[]'; excluded jsonb:='{}'; exclusions jsonb:='[]'; problems jsonb:='[]'; bases jsonb; snapshot jsonb; token text; check_data jsonb; count_selectors integer; begin
 select * into s from public.sessions where id=p_session; select * into e from public.session_execution where session_id=p_session;
 if not p_request ?& array['command','allocation','revision','version','trigger','activity','selectors','restore','reason'] or p_request-array['command','allocation','revision','version','trigger','activity','selectors','restore','reason','token']<>'{}'::jsonb or (p_request->>'command' in ('schedule','release','audience')) is distinct from true or (p_request->>'trigger' in ('start','activity','manual')) is distinct from true or (p_request->>'revision' ~ '^[0-9]+$') is distinct from true or jsonb_typeof(p_request->'selectors') is distinct from 'array' or jsonb_typeof(p_request->'restore') is distinct from 'array' or jsonb_typeof(p_request->'reason') is distinct from 'string' or length(p_request->>'reason')>500 then raise exception 'invalid_resource'; end if;
 if jsonb_typeof(p_request->'revision') is distinct from 'number' then raise exception 'invalid_resource'; end if;
 count_selectors:=jsonb_array_length(p_request->'selectors');
 if count_selectors<1 or count_selectors>100 or jsonb_array_length(p_request->'restore')>100 then raise exception 'invalid_resource'; end if;
 if (p_request->>'allocation')::uuid is null or (p_request->>'version')::uuid is null then raise exception 'invalid_resource'; end if;
 select * into a from public.resource_allocations where id=(p_request->>'allocation')::uuid;
 if a.id is not null and a.session_id<>p_session then raise exception 'not_allowed' using errcode='42501'; end if;
 if coalesce(a.revision,0)<>(p_request->>'revision')::integer then raise exception 'resource_conflict'; end if;
 if e.session_id is null or a.revoked_at is not null then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_request->>'command'='schedule' and a.released_at is not null then raise exception 'invalid_resource'; end if;
 if p_request->>'command' in ('release','audience') and (a.id is null or a.resource_version<>(p_request->>'version')::uuid or a.trigger<>p_request->>'trigger' or a.activity_id is distinct from p_request->>'activity') then raise exception 'resource_conflict'; end if;
 if p_request->>'command'='release' and (a.released_at is not null or (a.trigger<>'manual' and not p_due)) then raise exception 'invalid_resource'; end if;
 if p_request->>'command'='audience' and (a.released_at is null or not public.work_nonblank(p_request->>'reason')) then raise exception 'invalid_resource'; end if;
 if p_request->>'trigger'='activity' then
 if not exists(select 1 from public.workshop_versions w cross join lateral jsonb_array_elements(w.content->'activities') with ordinality t(item,n) where w.id=e.version_id and item->>'id'=p_request->>'activity' and (p_request->>'command'<>'schedule' or n>e.current_index+1)) then raise exception 'invalid_resource'; end if;
 elsif p_request->'activity' is distinct from 'null'::jsonb then raise exception 'invalid_resource'; end if;
 if p_request->>'command'='schedule' and p_request->>'trigger'='start' and e.state<>'ready' then raise exception 'resource_closed'; end if;
 select public.resource_version_projection(rv.id) into v from public.resource_versions rv where rv.id=(p_request->>'version')::uuid and rv.workspace_id=s.workspace_id;
 if v is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_request->>'command'<>'schedule' and v->>'kind'='link' then
 check_data:=v->'check'; if check_data is null or check_data='null'::jsonb or check_data->>'outcome'<>'reachable' or check_data->>'reviewed'<>'true' or (check_data->>'expires_at')::timestamptz<=clock_timestamp() then problems:=problems||jsonb_build_array('Validate and review the exact link version before release.'); end if; end if;
 if not (select enabled from public.resource_capability where singleton) then problems:=problems||jsonb_build_array('Resource changes are temporarily unavailable.'); end if;
 for selector in select value from jsonb_array_elements(p_request->'selectors') loop
 if not selector ?& array['kind','id'] or selector-array['kind','id']<>'{}'::jsonb or (selector->>'kind' in ('individual','group','shared')) is distinct from true or (selector->>'kind'<>'shared' and (selector->>'id')::uuid is null) or (selector->>'kind'='shared' and selector->'id' is distinct from 'null'::jsonb) then raise exception 'invalid_resource'; end if;
 if selector->>'kind'='group' and not exists(select 1 from public.session_groups sg join public.group_membership_intervals i on i.group_id=sg.id and i.session_id=sg.session_id and i.ended_at is null join public.session_participants p on p.id=i.participant_id and p.session_id=i.session_id and p.state='admitted' where sg.id=(selector->>'id')::uuid and sg.session_id=p_session and not sg.retired) then problems:=problems||jsonb_build_array('Selected group is empty, retired or unavailable: '||coalesce(selector->>'id','')); end if;
 if selector->>'kind'='individual' and not exists(select 1 from public.session_participants p where p.id=(selector->>'id')::uuid and p.session_id=p_session and p.state='admitted') then problems:=problems||jsonb_build_array('Selected individual is not admitted: '||coalesce(selector->>'id','')); end if;
 for person in select p.id,p.display_name,i.id interval_id from public.session_participants p left join public.group_membership_intervals i on i.session_id=p.session_id and i.participant_id=p.id and i.ended_at is null and i.group_id=case when selector->>'kind'='group' then (selector->>'id')::uuid end
 where p.session_id=p_session and p.state='admitted' and (selector->>'kind'='shared' or (selector->>'kind'='individual' and p.id=(selector->>'id')::uuid) or (selector->>'kind'='group' and i.id is not null and exists(select 1 from public.session_groups g where g.id=i.group_id and not g.retired))) order by p.id loop
 if exists(select 1 from public.resource_recipients rr where rr.allocation_id=a.id and rr.participant_id=person.id and rr.revoked_at is not null) and not (p_request->'restore' ? person.id::text) then
 excluded:=jsonb_set(excluded,array[person.id::text],jsonb_build_object('participant',person.id,'name',person.display_name,'reason','Explicitly revoked; requires named restoration')); continue; end if;
 bases:=coalesce(recipients->person.id::text->'bases','[]'::jsonb);
 if not bases @> jsonb_build_array(jsonb_build_object('kind',selector->>'kind','group',case when selector->>'kind'='group' then selector->>'id' end,'interval',person.interval_id)) then bases:=bases||jsonb_build_array(jsonb_build_object('kind',selector->>'kind','group',case when selector->>'kind'='group' then selector->>'id' end,'interval',person.interval_id)); end if;
 recipients:=jsonb_set(recipients,array[person.id::text],jsonb_build_object('participant',person.id,'name',person.display_name,'bases',bases,'change',case when public.resource_access(a.id,person.id) then 'continuing' else 'new' end));
 end loop; end loop;
 for entry in select key,value from jsonb_each(recipients) order by key loop resolved:=resolved||jsonb_build_array(entry.value); end loop;
 for entry in select key,value from jsonb_each(excluded) order by key loop exclusions:=exclusions||jsonb_build_array(entry.value); end loop;
 for entry in select value from jsonb_array_elements(p_request->'restore') loop if jsonb_typeof(entry.value)<>'string' or not recipients ? (entry.value#>>'{}') then raise exception 'invalid_resource'; end if; end loop;
 if jsonb_array_length(resolved)=0 then problems:=problems||jsonb_build_array('No admitted recipients are selected.'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'bases',public.resource_bases(a.id,p.id),'change','withdrawn') order by p.id),'[]'::jsonb) into lost from public.resource_recipients rr join public.session_participants p on p.id=rr.participant_id and p.session_id=p_session where rr.allocation_id=a.id and public.resource_access(a.id,p.id) and not recipients ? p.id::text;
 snapshot:=jsonb_build_object('request',p_request-'token','allocation',to_jsonb(a),'execution',to_jsonb(e),'version',v,'recipients',resolved,'lost',lost,'excluded',exclusions,'problems',problems,
 'capability',(select to_jsonb(c) from public.resource_capability c),'actor',auth.uid(),'auth_session',auth.jwt()->>'session_id','scope',public.group_work_context(p_session),
 'endpoints',(select jsonb_agg(jsonb_build_array(id,state,credential_hash) order by id) from public.session_participants where session_id=p_session),'deliveries',(select jsonb_agg(to_jsonb(rr) order by participant_id) from public.resource_recipients rr where allocation_id=a.id));
 token:=encode(extensions.digest(snapshot::text,'sha256'),'hex');
 return jsonb_build_object('token',token,'allocation',p_request->>'allocation','revision',coalesce(a.revision,0),'version',v,'trigger',p_request->>'trigger','activity',p_request->>'activity','recipients',resolved,'lost',lost,'excluded',exclusions,'problems',problems,'request',p_request-'token');
end $$;
create function public.resource_preview(p_session uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
 perform 1 from public.sessions where id=p_session for share; perform public.authorize_work(p_session,null,null,true);
 result:=public.build_resource_preview(p_session,p_request); perform public.authorize_work(p_session,null,null,true);
 return result||jsonb_build_object('ttl_ms',greatest(0,least(5000,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,(select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid))));
end $$;
create function public.apply_resource_recipients(p_allocation uuid,p_preview jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; r jsonb; b jsonb; person uuid; prior public.resource_recipients; continuing boolean; gen integer; begin
 select * into a from public.resource_allocations where id=p_allocation;
 for r in select value from jsonb_array_elements(p_preview->'recipients') loop
 person:=(r->>'participant')::uuid; continuing:=public.resource_access(a.id,person);
 select * into prior from public.resource_recipients where allocation_id=a.id and participant_id=person;
 gen:=case when prior.allocation_id is null then 1 when continuing then prior.generation else prior.generation+1 end;
 insert into public.resource_recipients(allocation_id,session_id,participant_id,generation) values(a.id,a.session_id,person,gen)
 on conflict(allocation_id,participant_id) do update set generation=excluded.generation,revoked_at=null,revoked_by=null,reason=null;
 delete from public.resource_grants where allocation_id=a.id and participant_id=person;
 for b in select value from jsonb_array_elements(r->'bases') loop insert into public.resource_grants(allocation_id,participant_id,kind,group_id,interval_id) values(a.id,person,b->>'kind',(b->>'group')::uuid,(b->>'interval')::uuid); end loop;
 if not continuing then insert into public.resource_notices(allocation_id,participant_id,generation) values(a.id,person,gen); end if;
 end loop;
 update public.resource_recipients rr set revoked_at=clock_timestamp(),revoked_by=auth.uid(),reason='Audience update confirmed'
 where allocation_id=a.id and revoked_at is null and not exists(select 1 from jsonb_array_elements(p_preview->'recipients') target where target->>'participant'=rr.participant_id::text);
end $$;
create function public.read_resource_library(p_workspace uuid,p_resource uuid default null,p_offset integer default 0,p_metadata_only boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; detail jsonb; authority jsonb; begin
 perform public.require_resource_host(p_workspace); if p_offset is null or p_offset<0 or p_metadata_only is null then raise exception 'invalid_resource'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'title',r.title,'kind',r.kind) order by r.created_at,r.id),'[]'::jsonb) into items from (select * from public.resources where workspace_id=p_workspace order by created_at,id offset p_offset limit 20) r;
 if p_resource is not null then
 select jsonb_build_object('resource',r.id,'revision',r.revision,'versions',coalesce((select jsonb_agg(v.id order by v.ordinal desc) from (select id,ordinal from public.resource_versions where resource_id=r.id order by ordinal desc offset p_offset limit 20) v),'[]'::jsonb),'next_version_offset',case when (select count(*) from public.resource_versions where resource_id=r.id)>p_offset+20 then p_offset+20 end) into authority from public.resources r where r.id=p_resource and r.workspace_id=p_workspace for share;
 if authority is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if not p_metadata_only then
 select jsonb_build_object('id',r.id,'revision',r.revision,'title',r.title,'kind',r.kind,'content',r.content,
 'check',public.resource_check_projection((select c.id from public.resource_checks c where c.resource_id=r.id and c.revision=r.revision order by c.started_at desc,c.id desc limit 1)),
 'versions',coalesce((select jsonb_agg(public.resource_version_projection(v.id) order by v.ordinal desc) from (select id,ordinal from public.resource_versions where resource_id=r.id order by ordinal desc offset p_offset limit 20) v),'[]'::jsonb),
 'next_version_offset',case when (select count(*) from public.resource_versions where resource_id=r.id)>p_offset+20 then p_offset+20 end) into detail from public.resources r where r.id=p_resource and r.workspace_id=p_workspace for share;
 if detail is null then raise exception 'not_allowed' using errcode='42501'; end if; end if; end if;
 perform public.require_resource_host(p_workspace);
 return jsonb_build_object('workspace',p_workspace,'ttl_ms',greatest(0,least(5000,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,(select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid))),'enabled',(select enabled from public.resource_capability where singleton),'items',items,'resource',detail,'authority',authority,'next_offset',case when (select count(*) from public.resources where workspace_id=p_workspace)>p_offset+20 then p_offset+20 end);
end $$;
create function public.resource_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null,p_host boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.sessions; e public.session_execution; actor uuid; previous public.resource_commands; a public.resource_allocations; digest text; cmd text:=p_request->>'command'; preview jsonb; result jsonb:=jsonb_build_object('committed',true); person uuid; endpoint text; begin
 if p_operation is null or jsonb_typeof(p_request) is distinct from 'object' or p_host is null or not p_request ?& array['command','allocation'] or p_request->>'command' is null or p_request->>'allocation' is null then raise exception 'invalid_resource'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 perform 1 from public.sessions where id=p_session for update;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
 select * into s from public.sessions where id=p_session; s:=public.effective_session(s);
 select * into e from public.session_execution where session_id=p_session;
 if e.session_id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 endpoint:=case when p_host then auth.jwt()->>'session_id' else encode(extensions.digest(p_credential_hash,'sha256'),'hex') end;
 if (not p_host and cmd not in ('ack','dismiss')) or (p_host and cmd in ('ack','dismiss')) then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into a from public.resource_allocations where id=(p_request->>'allocation')::uuid and session_id=p_session for update;
 perform 1 from public.resource_capability where singleton for share;
 perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id where v.id=a.resource_version order by r.id for share of r,v;
 if cmd<>'schedule' and a.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if cmd in ('ack','dismiss') and (jsonb_typeof(p_request->'generation') is distinct from 'number' or (p_request->>'generation' ~ '^[1-9][0-9]*$') is distinct from true) then raise exception 'invalid_resource'; end if;
 if cmd in ('ack','dismiss') and (not public.resource_access(a.id,actor) or not exists(select 1 from public.resource_recipients rr where rr.allocation_id=a.id and rr.participant_id=actor and rr.generation=(p_request->>'generation')::integer)) then raise exception 'not_allowed' using errcode='42501'; end if;
 digest:=encode(extensions.digest((p_request||jsonb_build_object('_endpoint',case when not p_host then endpoint end))::text,'sha256'),'hex');
 select * into previous from public.resource_commands where operation_id=p_operation;
 if found then if previous.session_id is distinct from p_session or previous.actor_id<>actor or previous.request_digest<>digest then raise exception 'operation_reused'; end if; perform public.authorize_work(p_session,null,p_credential_hash,p_host); return previous.receipt; end if;
 if cmd in ('schedule','release','audience') then
 perform public.lock_resource_capability();
 if s.state='ended' or e.state='completed' or e.deadline<=clock_timestamp() or (cmd in ('release','audience') and e.state not in ('live','paused')) then raise exception 'resource_closed'; end if;
 -- Session first; source locks follow in stable UUID order. Authoring never takes a session lock.
 perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id where v.id=(p_request->>'version')::uuid order by r.id for share of r,v;
 preview:=public.build_resource_preview(p_session,p_request);
 if p_request->>'token' is distinct from preview->>'token' then raise exception 'stale_resource'; end if;
 if cmd<>'schedule' and jsonb_array_length(preview->'problems')>0 then raise exception 'resource_prerequisite'; end if;
 if cmd='schedule' then
 if a.id is null and (select count(*) from public.resource_allocations where session_id=p_session)>=100 then raise exception 'invalid_resource'; end if;
 if preview->'version'->>'kind'='link' and not exists(select 1 from public.resource_allocations where session_id=p_session and resource_version=(p_request->>'version')::uuid) and (select count(distinct x.resource_version) from public.resource_allocations x join public.resource_versions v on v.id=x.resource_version where x.session_id=p_session and v.kind='link')>=20 then raise exception 'invalid_resource'; end if;
 if a.id is null then insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,resource_version,trigger,activity_id,selectors,created_by) values((p_request->>'allocation')::uuid,p_session,s.workspace_id,e.version_id,(p_request->>'version')::uuid,p_request->>'trigger',p_request->>'activity',p_request->'selectors',actor) returning * into a;
 else update public.resource_allocations set resource_version=(p_request->>'version')::uuid,trigger=p_request->>'trigger',activity_id=p_request->>'activity',selectors=p_request->'selectors',revision=revision+1 where id=a.id returning * into a; end if;
 else
 perform public.apply_resource_recipients(a.id,preview);
 update public.resource_allocations set released_at=coalesce(released_at,clock_timestamp()),selectors=p_request->'selectors',revision=revision+1,reason=p_request->>'reason' where id=a.id returning * into a;
 end if;
 result:=result||jsonb_build_object('allocation',a.id,'revision',a.revision);
 elsif cmd='revoke' then
 if not p_request ?& array['command','allocation','participant','reason'] or p_request-array['command','allocation','participant','reason']<>'{}'::jsonb or jsonb_typeof(p_request->'reason') is distinct from 'string' or public.work_nonblank(p_request->>'reason') is distinct from true or length(p_request->>'reason')>500 then raise exception 'invalid_resource'; end if;
 person:=(p_request->>'participant')::uuid;
 if person is null then update public.resource_allocations set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,actor),revocation_reason=coalesce(revocation_reason,p_request->>'reason'),revision=revision+case when revoked_at is null then 1 else 0 end where id=a.id;
 else update public.resource_recipients set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,actor),reason=coalesce(reason,p_request->>'reason') where allocation_id=a.id and participant_id=person; if not found then raise exception 'not_allowed' using errcode='42501'; end if; update public.resource_allocations set revision=revision+1 where id=a.id; end if;
 elsif cmd='cancel' then
 if not p_request ?& array['command','allocation','revision'] or jsonb_typeof(p_request->'revision') is distinct from 'number' or (p_request->>'revision' ~ '^[0-9]+$') is distinct from true or p_request-array['command','allocation','revision']<>'{}'::jsonb or a.released_at is not null then raise exception 'invalid_resource'; end if;
 if a.revision<>(p_request->>'revision')::integer then raise exception 'resource_conflict'; end if;
 update public.resource_allocations set revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=actor,revocation_reason=coalesce(revocation_reason,'Schedule cancelled'),revision=revision+1 where id=a.id;
 elsif cmd in ('ack','dismiss') then
 if p_request-array['command','allocation','generation']<>'{}'::jsonb then raise exception 'invalid_resource'; end if;
 if cmd='ack' then update public.resource_notices set acked_endpoint=endpoint,acked_at=case when acked_endpoint=endpoint then acked_at else clock_timestamp() end where allocation_id=a.id and participant_id=actor and generation=(p_request->>'generation')::integer;
 else update public.resource_notices set dismissed_at=coalesce(dismissed_at,clock_timestamp()) where allocation_id=a.id and participant_id=actor and generation=(p_request->>'generation')::integer; end if;
 if not found then raise exception 'not_allowed' using errcode='42501'; end if;
 elsif cmd='retry' then
 if not p_request ? 'participants' or p_request-array['command','allocation','participants']<>'{}'::jsonb or jsonb_typeof(p_request->'participants') is distinct from 'array' or jsonb_array_length(p_request->'participants') not between 1 and 100 then raise exception 'invalid_resource'; end if;
 for person in select value::uuid from jsonb_array_elements_text(p_request->'participants') loop
 if not public.resource_access(a.id,person) or exists(select 1 from public.resource_notices n join public.resource_recipients rr on rr.allocation_id=n.allocation_id and rr.participant_id=n.participant_id and rr.generation=n.generation join public.session_participants p on p.id=rr.participant_id where n.allocation_id=a.id and n.participant_id=person and n.acked_endpoint=encode(extensions.digest(p.credential_hash,'sha256'),'hex')) then raise exception 'stale_resource'; end if;
 end loop;
 else raise exception 'invalid_resource'; end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if cmd in ('schedule','release','audience') and e.deadline<=clock_timestamp() then raise exception 'resource_closed'; end if;
 if cmd in ('ack','dismiss') and not public.resource_access(a.id,actor) then raise exception 'not_allowed' using errcode='42501'; end if;
 if cmd in ('release','audience') then perform public.resource_recheck_links(jsonb_build_object('items',jsonb_build_array(preview))); end if;
 insert into public.resource_commands(operation_id,workspace_id,session_id,actor_id,request_digest,receipt) values(p_operation,s.workspace_id,p_session,actor,digest,result);
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if cmd in ('schedule','release','audience') and e.deadline<=clock_timestamp() then raise exception 'resource_closed'; end if;
 if cmd in ('release','audience') then perform public.resource_recheck_links(jsonb_build_object('items',jsonb_build_array(preview))); end if;
 return result;
end $$;
create function public.resource_item(p_allocation uuid,p_actor uuid,p_host boolean,p_endpoint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; v public.resource_versions; rr public.resource_recipients; n public.resource_notices; result jsonb; recipients jsonb; begin
 select * into a from public.resource_allocations where id=p_allocation;
 select rv.* into v from public.resource_versions rv join public.resources r on r.id=rv.resource_id where rv.id=a.resource_version and rv.workspace_id=a.workspace_id;
 if a.id is null or v.id is null or (not p_host and not public.resource_access(a.id,p_actor)) then return null; end if;
 result:=jsonb_build_object('allocation',a.id,'revision',a.revision,'version',v.id,'title',v.title,'kind',v.kind,'ordinal',v.ordinal,'trigger',a.trigger,'activity',a.activity_id,'released_at',a.released_at,'revoked_at',a.revoked_at);
 if p_host then
 select coalesce(jsonb_agg(jsonb_build_object('participant',p.id,'name',p.display_name,'bases',public.resource_bases(a.id,p.id),'change',case when public.resource_access(a.id,p.id) then 'continuing' else 'withdrawn' end,'generation',r.generation,
 'delivery',case when not public.resource_access(a.id,p.id) then 'Access withdrawn/unavailable' when nn.acked_endpoint=encode(extensions.digest(p.credential_hash,'sha256'),'hex') then 'Received by active device' else 'Available; receipt unconfirmed' end) order by p.id),'[]'::jsonb) into recipients
 from public.resource_recipients r join public.session_participants p on p.id=r.participant_id and p.session_id=a.session_id left join public.resource_notices nn on nn.allocation_id=r.allocation_id and nn.participant_id=r.participant_id and nn.generation=r.generation where r.allocation_id=a.id;
 return result||jsonb_build_object('selectors',a.selectors,'recipients',recipients);
 end if;
 select * into rr from public.resource_recipients where allocation_id=a.id and participant_id=p_actor;
 select * into n from public.resource_notices where allocation_id=a.id and participant_id=p_actor and generation=rr.generation;
 return result||jsonb_build_object('bases',public.resource_bases(a.id,p_actor),'generation',rr.generation,'notice',jsonb_build_object('id',n.id,'generation',n.generation,'dismissed',n.dismissed_at is not null,'received',coalesce(n.acked_endpoint=p_endpoint,false)));
end $$;
create function public.read_resources(p_session uuid,p_host boolean default false,p_credential_hash text default null,p_allocation uuid default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; endpoint text; s public.sessions; e public.session_execution; items jsonb; detail jsonb; result jsonb; ttl numeric:=5000; begin
 if p_offset is null or p_offset<0 then raise exception 'invalid_resource'; end if;
 perform 1 from public.sessions where id=p_session for share;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
 select * into s from public.sessions where id=p_session; s:=public.effective_session(s); select * into e from public.session_execution where session_id=p_session;
 endpoint:=case when p_host then auth.jwt()->>'session_id' else encode(extensions.digest(p_credential_hash,'sha256'),'hex') end;
 perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id join public.resource_allocations a on a.resource_version=v.id where a.session_id=p_session order by r.id for share of r,v;
 select coalesce(jsonb_agg(public.resource_item(a.id,actor,p_host,endpoint) order by a.id),'[]'::jsonb) into items from (select a.id from public.resource_allocations a join public.resource_versions v on v.id=a.resource_version join public.resources r on r.id=v.resource_id where a.session_id=p_session and (p_host or public.resource_access(a.id,actor)) order by a.id offset p_offset limit 20) a;
 if p_allocation is not null then
 select public.resource_item(a.id,actor,p_host,endpoint)||jsonb_build_object('content',v.content,'check',public.resource_version_projection(v.id)->'check') into detail from public.resource_allocations a join public.resource_versions v on v.id=a.resource_version where a.id=p_allocation and a.session_id=p_session and (p_host or public.resource_access(a.id,actor));
 if detail is null then raise exception 'not_allowed' using errcode='42501'; end if; end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if p_host then ttl:=least(ttl,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,(select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid)); end if;
 if s.ended_at is not null then ttl:=least(ttl,extract(epoch from s.ended_at+interval '90 days'-clock_timestamp())*1000); elsif e.deadline is not null then ttl:=least(ttl,extract(epoch from e.deadline+interval '90 days'-clock_timestamp())*1000); end if;
 result:=jsonb_build_object('session',p_session,'actor',actor,'endpoint',endpoint,'ttl_ms',greatest(0,ttl),'enabled',(select enabled from public.resource_capability where singleton),'items',items,'detail',detail,'next_offset',case when (select count(*) from public.resource_allocations aa join public.resource_versions vv on vv.id=aa.resource_version join public.resources rr on rr.id=vv.resource_id where aa.session_id=p_session and (p_host or public.resource_access(aa.id,actor)))>p_offset+20 then p_offset+20 end);
 if p_host then result:=result||jsonb_build_object('workspace',s.workspace_id,'state',case when s.state='ended' then 'completed' else e.state end,'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by id),'[]'::jsonb) from public.session_participants where session_id=p_session and state='admitted'),'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal) order by ordinal),'[]'::jsonb) from public.session_groups where session_id=p_session and not retired),'activities',(select content->'activities' from public.workshop_versions where id=e.version_id)); end if;
 return result;
end $$;
create function public.due_resource_allocations(p_session uuid) returns setof public.resource_allocations language sql security definer set search_path='' as $$
 select a.* from public.resource_allocations a join public.session_execution e on e.session_id=a.session_id join public.workshop_versions v on v.id=e.version_id where a.session_id=p_session and a.released_at is null and a.revoked_at is null and
 ((a.trigger='start' and e.state='ready') or (a.trigger='activity' and a.activity_id=v.content->'activities'->(e.current_index+1)->>'id')) order by a.id;
$$;
create function public.resource_execution_preview(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; preview jsonb; items jsonb:='[]'; problems jsonb:='[]'; begin
 perform 1 from public.resource_capability where singleton for share;
 perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id join public.due_resource_allocations(p_session) due on due.resource_version=v.id order by r.id for share of r,v;
 for a in select * from public.due_resource_allocations(p_session) loop
 preview:=public.build_resource_preview(p_session,jsonb_build_object('command','release','allocation',a.id,'revision',a.revision,'version',a.resource_version,'trigger',a.trigger,'activity',a.activity_id,'selectors',a.selectors,'restore','[]'::jsonb,'reason','Scheduled release confirmed'),true);
 items:=items||jsonb_build_array(preview); problems:=problems||(preview->'problems'); end loop;
 return jsonb_build_object('items',items,'problems',problems);
end $$;
create function public.consume_resource_releases(p_session uuid,p_preview jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; check_data jsonb; begin
 if jsonb_array_length(p_preview->'items')=0 then return; end if;
 perform public.lock_resource_capability();
 if jsonb_array_length(p_preview->'problems')>0 then raise exception 'resource_prerequisite'; end if;
 for item in select value from jsonb_array_elements(p_preview->'items') loop
 check_data:=item->'version'->'check';
 if item->'version'->>'kind'='link' and (check_data is null or check_data='null'::jsonb or check_data->>'outcome'<>'reachable' or check_data->>'reviewed'<>'true' or (check_data->>'expires_at')::timestamptz<=clock_timestamp()) then raise exception 'resource_check_required'; end if;
 perform public.apply_resource_recipients((item->>'allocation')::uuid,item);
 update public.resource_allocations set released_at=clock_timestamp(),revision=revision+1 where id=(item->>'allocation')::uuid and session_id=p_session and released_at is null and revoked_at is null;
 if not found then raise exception 'stale_resource'; end if;
 end loop;
end $$;
create function public.host_execution_v4(p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; preview jsonb; begin
 perform 1 from public.sessions where id=p_session for share;
 result:=public.host_execution_v3(p_session); if result is null then return null; end if;
 preview:=public.resource_execution_preview(p_session);
 perform public.authorize_work(p_session,null,null,true);
 return result||jsonb_build_object('resources',preview,'context',encode(extensions.digest((result->>'context')||preview::text,'sha256'),'hex'));
end $$;
-- Preserve the proven execution/input transaction, extending only its orchestration.
do $$ declare definition text; marker text; begin
 definition:=pg_get_functiondef('public.execution_command_v3(uuid,uuid,integer,text,text)'::regprocedure);
 definition:=replace(definition,'public.execution_command_v3(','public.execution_command_v4(');
 definition:=replace(definition,'''protocol'',3','''protocol'',4');
 definition:=replace(definition,'input_preview jsonb;','input_preview jsonb; resource_preview jsonb;');
 marker:='    if p_context is distinct from coalesce(input_preview->>''token'',public.group_context_token(p_session)) then raise exception ''stale_execution''; end if;';
 if position(marker in definition)=0 then raise exception 'resource execution preview insertion point missing'; end if;
 definition:=replace(definition,marker,'    resource_preview:=public.resource_execution_preview(p_session);'||chr(10)||'    if p_context is distinct from encode(extensions.digest(coalesce(input_preview->>''token'',public.group_context_token(p_session))||resource_preview::text,''sha256''),''hex'') then raise exception ''stale_execution''; end if;');
 marker:='  if p_command<>''end'' then update public.session_execution set revision=revision+1 where session_id=p_session; end if;';
 if position(marker in definition)=0 then raise exception 'resource release insertion point missing'; end if;
 definition:=replace(definition,marker,'  if p_command in (''start'',''next'') then perform public.consume_resource_releases(p_session,resource_preview); end if;'||chr(10)||marker);
 marker:='  insert into public.execution_commands(operation_id,session_id,actor_id,request,receipt)';
 definition:=replace(definition,marker,'  if p_command in (''start'',''next'') then perform public.resource_recheck_links(resource_preview); end if;'||chr(10)||marker);
 marker:='  return v_result;';
 definition:=replace(definition,marker,'  if p_command in (''start'',''next'') then perform public.resource_recheck_links(resource_preview); end if;'||chr(10)||marker);
 execute definition;
end $$;
-- Rolled-back and older clients cannot bypass due release confirmation.
do $$ declare signature text; definition text; marker text:='  select * into v_previous from public.execution_commands where operation_id=p_operation;'; begin
 foreach signature in array array['public.execution_command_core(uuid,uuid,integer,text,boolean,text)','public.execution_command_v3(uuid,uuid,integer,text,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(marker in definition)=0 then raise exception 'resource legacy guard insertion point missing'; end if;
 definition:=replace(definition,marker,'  if p_command in (''start'',''next'') and exists(select 1 from public.due_resource_allocations(p_session)) then raise exception ''resource_prerequisite'' using detail=''Use resource-aware execution to preview and release due materials.''; end if;'||chr(10)||marker);
 execute definition;
 end loop;
end $$;
do $$ declare f record; begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'resource_%' or proname in ('require_resource_host','lock_resource_capability','begin_resource_check','finish_resource_check','read_resource_library','build_resource_preview','apply_resource_recipients','read_resources','due_resource_allocations','consume_resource_releases','host_execution_v4','execution_command_v4')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
grant execute on function public.read_resource_library(uuid,uuid,integer,boolean),public.resource_library_command(uuid,uuid,jsonb),public.begin_resource_check(uuid,uuid,integer,uuid),public.resource_preview(uuid,jsonb),public.host_execution_v4(uuid),public.execution_command_v4(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.read_resources(uuid,boolean,text,uuid,integer),public.resource_command(uuid,uuid,jsonb,text,boolean) to anon,authenticated;
grant execute on function public.finish_resource_check(uuid,text,text,text,uuid) to service_role;
