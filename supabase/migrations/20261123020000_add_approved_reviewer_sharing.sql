-- Title: Add approved reviewer sharing
-- Evidence owns permission and immutable references; Resources owns delivery.
create table public.review_capability(singleton boolean primary key default true check(singleton),enabled boolean not null default false,generation uuid not null default gen_random_uuid());
insert into public.review_capability(singleton) values(true);
create trigger review_capability_changed before update on public.review_capability for each row execute function public.input_capability_changed();
create table public.review_group_policies(
 session_id uuid not null,activity_id text not null,version_id uuid not null,policy integer not null default 1 check(policy=1),actor_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 primary key(session_id,activity_id),foreign key(session_id,version_id) references public.session_execution(session_id,version_id)
);
create table public.review_disclosures(
 session_id uuid not null,activity_id text not null,group_id uuid not null,participant_id uuid not null,interval_id uuid not null,policy integer not null check(policy=1),acknowledged_at timestamptz not null default clock_timestamp(),
 primary key(session_id,activity_id,group_id,participant_id,interval_id),foreign key(interval_id,session_id,group_id,participant_id) references public.group_membership_intervals(id,session_id,group_id,participant_id),foreign key(session_id,activity_id) references public.review_group_policies(session_id,activity_id),
 foreign key(session_id,group_id) references public.session_groups(session_id,id),foreign key(session_id,participant_id) references public.session_participants(session_id,id)
);
create table public.review_proposals(
 id uuid primary key,session_id uuid not null,workspace_id uuid not null,version_id uuid not null,source_attempt uuid not null,source_owner uuid not null,source_kind text not null check(source_kind in ('individual','group')),
 source_activity text not null,target_activity text not null,fields text[] not null,recipients uuid[] not null,presentation jsonb not null,projection_digest text not null,
 state text not null default 'draft' check(state in ('draft','pending','approved','declined','withdrawn','released','closed','cancelled')),
 revision integer not null default 1,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),closed_at timestamptz,reason text,
 foreign key(session_id,workspace_id) references public.sessions(id,workspace_id),foreign key(session_id,version_id) references public.session_execution(session_id,version_id),unique(session_id,id),
 check(cardinality(fields) between 1 and 20),check(cardinality(recipients) between 1 and 40)
);
create table public.review_recipients(
 proposal_id uuid not null,session_id uuid not null,participant_id uuid not null,revoked_at timestamptz,reason text,
 primary key(proposal_id,participant_id),foreign key(session_id,proposal_id) references public.review_proposals(session_id,id),foreign key(session_id,participant_id) references public.session_participants(session_id,id)
);
create table public.review_decisions(
 id uuid primary key default gen_random_uuid(),proposal_id uuid not null references public.review_proposals(id),actor_id uuid not null,decision text not null,revision integer not null,created_at timestamptz not null default clock_timestamp()
);
create table public.review_commands(operation_id uuid primary key,session_id uuid not null,actor_id uuid not null,digest text not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.resource_allocations alter column resource_version drop not null;
alter table public.resource_allocations add column review_id uuid;
alter table public.resource_allocations add foreign key(session_id,review_id) references public.review_proposals(session_id,id);
alter table public.resource_allocations add constraint resource_source_xor check((resource_version is null)<>(review_id is null));
create unique index resource_one_review on public.resource_allocations(review_id) where review_id is not null;
alter table public.work_attempts add column review_disclosure jsonb;
do $$ declare n text; begin
 foreach n in array array['review_capability','review_group_policies','review_disclosures','review_proposals','review_recipients','review_decisions','review_commands'] loop
 execute format('alter table public.%I enable row level security',n); execute format('revoke all on public.%I from public,anon,authenticated,service_role',n); end loop;
 foreach n in array array['review_group_policies','review_disclosures','review_decisions','review_commands'] loop
 execute format('create trigger immutable_review_fact before update on public.%I for each row execute function public.freeze_work_version()',n); end loop;
end $$;

create function public.review_policy_text() returns text language sql immutable set search_path='' as $$
 select 'The host may share selected consolidated fields from your submitted group answer, with their authorship, read-only with named admitted reviewers in this session during a later activity. Raw contribution slots, individual answers and private feedback are excluded. This does not permit external publication. Wait until everyone acknowledges before contributing, including verbally.'::text;
$$;
create function public.review_group_ready(p_session uuid,p_activity text,p_group uuid) returns boolean language sql security definer set search_path='' as $$
 select not exists(select 1 from public.review_group_policies where session_id=p_session and activity_id=p_activity) or not exists(
 select 1 from public.session_group_members m join public.session_participants p on p.id=m.participant_id and p.session_id=m.session_id
 where m.session_id=p_session and m.group_id=p_group and p.state='admitted' and not exists(select 1 from public.review_disclosures d join public.group_membership_intervals i on i.id=d.interval_id and i.ended_at is null where d.session_id=p_session and d.activity_id=p_activity and d.group_id=p_group and d.participant_id=m.participant_id));
$$;
create function public.review_group_acknowledged(p_session uuid,p_activity text,p_group uuid,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
 select not exists(select 1 from public.review_group_policies where session_id=p_session and activity_id=p_activity) or exists(select 1 from public.review_disclosures d join public.group_membership_intervals i on i.id=d.interval_id and i.ended_at is null where d.session_id=p_session and d.activity_id=p_activity and d.group_id=p_group and d.participant_id=p_actor);
$$;
create function public.review_capture_disclosure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.group_id is not null and exists(select 1 from public.review_group_policies where session_id=new.session_id and activity_id=new.activity_id) then
 if not public.review_group_ready(new.session_id,new.activity_id,new.group_id) then raise exception 'review_disclosure_required'; end if;
 select jsonb_build_object('policy',1,'people',coalesce(jsonb_agg(jsonb_build_object('participant',d.participant_id,'acknowledged_at',d.acknowledged_at) order by d.participant_id),'[]'::jsonb)) into new.review_disclosure
 from public.review_disclosures d where d.session_id=new.session_id and d.activity_id=new.activity_id and d.group_id=new.group_id;
 end if; return new;
end $$;
create trigger review_capture_disclosure before insert on public.work_attempts for each row execute function public.review_capture_disclosure();

-- Narrow Evidence projection. It contains only selected fields, never raw slots or notes.
create function public.review_source(p_attempt uuid,p_fields text[],p_presentation jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.work_attempts; f text; x jsonb; fields jsonb:='[]'; meta jsonb; people jsonb; authors uuid[]:='{}'; required uuid[]; total integer:=0; begin
 select * into t from public.work_attempts where id=p_attempt for share;
 if t.id is null or cardinality(p_fields) not between 1 and 20 or (select count(distinct a) from unnest(p_fields) a)<>cardinality(p_fields) or (cardinality(t.missing)>0 and not exists(select 1 from public.work_partial_acceptances where attempt_id=t.id)) then return null; end if;
 foreach f in array p_fields loop
 x:=public.input_field_projection(t.id,f);
 if x is null or not public.work_nonblank(x->>'value') then return null; end if;
 total:=total+char_length(x->>'value');
 fields:=fields||jsonb_build_array(jsonb_build_object('field',x->'field','value',x->>'value','authors',x->'authors'));
 authors:=authors||array(select a::uuid from jsonb_array_elements_text(x->'authors') a);
 end loop;
 if total>100000 then return null; end if;
 if t.group_id is not null then
 required:=array(select (a->>'participant')::uuid from jsonb_array_elements(t.snapshot->'roster') a)||authors;
 if t.review_disclosure is null or exists(select 1 from unnest(required) person where not exists(select 1 from jsonb_array_elements(t.review_disclosure->'people') d where (d->>'participant')::uuid=person and (d->>'acknowledged_at')::timestamptz<=t.submitted_at)) then return null; end if;
 -- Structured lineage must have been disclosed before its first acknowledged write.
 if exists(select 1 from jsonb_each(t.snapshot->'lineage') l cross join lateral jsonb_array_elements_text(l.value->'sources') src
 join public.group_contribution_versions c on c.id=src::uuid where l.key=any(p_fields) and not exists(select 1 from public.review_disclosures d where d.session_id=t.session_id and d.activity_id=t.activity_id and d.group_id=t.group_id and d.participant_id=c.author_id and d.acknowledged_at<=c.saved_at)) then return null; end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.id),'[]'::jsonb) into people from public.session_participants p where p.session_id=t.session_id and p.id=any(authors||array[t.submitted_by]||case when t.participant_id is not null then array[t.participant_id] else '{}'::uuid[] end);
 meta:=coalesce(p_presentation,jsonb_build_object('source_title',x->>'source_title','people',people,'owner_label',case when t.group_id is null then (select display_name from public.session_participants where id=t.participant_id) else 'Group '||(select ordinal from public.session_groups where id=t.group_id)::text end));
 return jsonb_build_object('attempt',t.id,'ordinal',t.ordinal,'source_activity',t.activity_id,'owner',t.owner_id,'kind',t.owner_kind,'submitter',t.submitted_by,'fields',fields,'presentation',meta,'partial',cardinality(t.missing)>0);
end $$;
create function public.review_open(p_proposal uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.review_proposals p join public.session_execution e on e.session_id=p.session_id join public.sessions s on s.id=p.session_id join public.workshop_versions v on v.id=e.version_id
 where p.id=p_proposal and p.state='released' and p.closed_at is null and s.state='open' and e.state in ('live','paused') and e.deadline>clock_timestamp() and v.content->'activities'->e.current_index->>'id'=p.target_activity
 and (p.source_kind='group' or exists(select 1 from public.session_participants a where a.id=p.source_owner and a.session_id=p.session_id and a.state='admitted'))
 and public.review_source(p.source_attempt,p.fields,p.presentation) is not null);
$$;
create function public.review_access(p_proposal uuid,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
 select public.review_open(p_proposal) and exists(select 1 from public.review_recipients r join public.session_participants p on p.id=r.participant_id and p.session_id=r.session_id where r.proposal_id=p_proposal and r.participant_id=p_actor and r.revoked_at is null and p.state='admitted');
$$;
create function public.review_close_on_execution() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='completed' or new.current_index is distinct from old.current_index then
 update public.review_proposals set state='closed',closed_at=coalesce(closed_at,clock_timestamp()),revision=revision+1,reason='Review activity ended' where session_id=new.session_id and closed_at is null and state in ('draft','pending','approved','released');
 end if; return new;
end $$;
create trigger review_close_on_execution after update of state,current_index on public.session_execution for each row execute function public.review_close_on_execution();
create function public.review_close_on_admission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.state='admitted' and new.state<>'admitted' then
 update public.review_recipients set revoked_at=coalesce(revoked_at,clock_timestamp()),reason=coalesce(reason,'Participant removed') where session_id=new.session_id and participant_id=new.id;
 update public.review_proposals set state='closed',closed_at=coalesce(closed_at,clock_timestamp()),revision=revision+1,reason='Author removed' where session_id=new.session_id and source_kind='individual' and source_owner=new.id and closed_at is null;
 end if; return new;
end $$;
create trigger review_close_on_admission after update of state on public.session_participants for each row execute function public.review_close_on_admission();
create function public.review_freeze_proposal() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.session_id,new.workspace_id,new.version_id,new.source_attempt,new.source_owner,new.source_kind,new.source_activity,new.target_activity,new.fields,new.recipients,new.presentation,new.projection_digest,new.created_by,new.created_at) is distinct from
 (old.id,old.session_id,old.workspace_id,old.version_id,old.source_attempt,old.source_owner,old.source_kind,old.source_activity,old.target_activity,old.fields,old.recipients,old.presentation,old.projection_digest,old.created_by,old.created_at)
 or (old.closed_at is not null and new is distinct from old) then raise exception 'review_frozen'; end if; return new;
end $$;
create trigger review_freeze_proposal before update on public.review_proposals for each row execute function public.review_freeze_proposal();
create function public.review_preview(p_proposal uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.review_proposals; e public.session_execution; source jsonb; recipients jsonb; blockers jsonb:='[]'; context jsonb; begin
 select * into p from public.review_proposals where id=p_proposal; select * into e from public.session_execution where session_id=p.session_id;
 source:=public.review_source(p.source_attempt,p.fields,p.presentation);
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'state',a.state) order by a.id),'[]'::jsonb) into recipients from public.session_participants a where a.session_id=p.session_id and a.id=any(p.recipients);
 if p.state<>'approved' then blockers:=blockers||jsonb_build_array('Author approval or eligible group policy is required.'); end if;
 if p.closed_at is not null or e.state not in ('live','paused') or e.deadline<=clock_timestamp() or (select state from public.sessions where id=p.session_id)<>'open' or (select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id) is distinct from p.target_activity then blockers:=blockers||jsonb_build_array('Review activity is not open.'); end if;
 if source is null or encode(extensions.digest(source::text,'sha256'),'hex') is distinct from p.projection_digest then blockers:=blockers||jsonb_build_array('The selected source is unavailable.'); end if;
 if exists(select 1 from jsonb_array_elements(recipients) a where a->>'state'<>'admitted') or jsonb_array_length(recipients)<>cardinality(p.recipients) or exists(select 1 from public.review_recipients where proposal_id=p.id and revoked_at is not null) then blockers:=blockers||jsonb_build_array('A named reviewer is unavailable.'); end if;
 if (select count(*) from public.resource_allocations where session_id=p.session_id)>=100 then blockers:=blockers||jsonb_build_array('This session already has 100 resource allocations.'); end if;
 -- A confirmation minted in an earlier 15-second window must be previewed again.
 context:=jsonb_build_object('proposal',p.id,'revision',p.revision,'state',p.state,'digest',p.projection_digest,'source',source,'recipients',recipients,'recipient_authority',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'credential',a.credential_hash,'admission',a.decided_at) order by a.id),'[]'::jsonb) from public.session_participants a where a.session_id=p.session_id and a.id=any(p.recipients)),'execution',e.revision,'groups',public.group_work_context(p.session_id),'capability',(select generation from public.review_capability where singleton),'resource_capability',(select generation from public.resource_capability where singleton),'host',auth.uid(),'endpoint',auth.jwt()->>'session_id','window',floor(extract(epoch from clock_timestamp())/15),'blockers',blockers);
 return jsonb_build_object('token',encode(extensions.digest(context::text,'sha256'),'hex'),'source',source,'recipients',recipients,'target_activity',p.target_activity,'current_activity',(select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id),'permission_basis',case when p.source_kind='individual' then 'Individual author approved this exact item, version, fields and audience.' else 'Prospective group sharing rule was disclosed before contribution.' end,'problems',blockers,'newer_version',exists(select 1 from public.work_attempts t join public.work_attempts original on original.id=p.source_attempt where t.session_id=original.session_id and t.owner_id=original.owner_id and t.activity_id=original.activity_id and t.ordinal>original.ordinal));
end $$;

create function public.review_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null,p_host boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; cmd text:=p_request->>'command'; p public.review_proposals; e public.session_execution; s public.sessions; t public.work_attempts; previous public.review_commands; digest text; source jsonb; preview jsonb; result jsonb:=jsonb_build_object('committed',true); fields text[]; recipients uuid[]; aid text; gid uuid; target text; chosen uuid; expected text[]; begin
 if p_operation is null or p_host is null or jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>262144 then raise exception 'invalid_review'; end if;
 expected:=case cmd when 'create' then array['proposal','attempt','fields','recipients','activity'] when 'enable_policy' then array['activity'] when 'ack_policy' then array['activity','group','policy'] when 'release' then array['proposal','token'] when 'revoke' then array['proposal','participant','reason'] when 'close' then array['proposal','reason'] when 'request' then array['proposal'] when 'approve' then array['proposal'] when 'decline' then array['proposal'] when 'withdraw' then array['proposal'] when 'cancel' then array['proposal'] end;
 if expected is null or not p_request ?& (expected||array['command']) or p_request-(expected||array['command'])<>'{}'::jsonb then raise exception 'invalid_review'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 perform 1 from public.sessions where id=p_session for update;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
 select * into s from public.sessions where id=p_session; s:=public.effective_session(s); select * into e from public.session_execution where session_id=p_session;
 if e.session_id is null or (p_host and cmd in ('approve','decline','withdraw','ack_policy')) or (not p_host and cmd not in ('approve','decline','withdraw','ack_policy')) then raise exception 'not_allowed' using errcode='42501'; end if;
 digest:=encode(extensions.digest((p_request||jsonb_build_object('_endpoint',case when not p_host then p_credential_hash end))::text,'sha256'),'hex');
 select * into previous from public.review_commands where operation_id=p_operation;
 if found then
 if (previous.session_id,previous.actor_id,previous.digest) is distinct from (p_session,actor,digest) then raise exception 'operation_reused'; end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host); return previous.receipt; end if;
 if cmd not in ('withdraw','decline','cancel','close','revoke','ack_policy') then
 perform 1 from public.review_capability where singleton for share;
 if not (select enabled from public.review_capability where singleton) then raise exception 'review_unavailable'; end if;
 perform public.lock_resource_capability();
 if s.state='ended' or e.state='completed' or e.deadline<=clock_timestamp() then raise exception 'review_closed'; end if;
 end if;
 if cmd='enable_policy' then
 aid:=p_request->>'activity';
 if not public.lock_group_capability() or not exists(select 1 from public.workshop_versions v cross join lateral jsonb_array_elements(v.content->'activities') with ordinality a where v.id=e.version_id and a.value->>'id'=aid and a.value->>'scope'='group' and (e.state='ready' or a.ordinality-1>e.current_index))
 or exists(select 1 from public.work_items where session_id=p_session and activity_id=aid and (revision>0 or latest>0)) or exists(select 1 from public.group_contribution_versions where session_id=p_session and activity_id=aid) then raise exception 'invalid_review'; end if;
 insert into public.review_group_policies(session_id,activity_id,version_id,actor_id) values(p_session,aid,e.version_id,actor) on conflict do nothing;
 elsif cmd='ack_policy' then
 aid:=p_request->>'activity';gid:=(p_request->>'group')::uuid;
 if p_request->>'policy'<>'1' or s.state<>'open' or e.state not in ('live','paused') or e.deadline<=clock_timestamp() or not exists(select 1 from public.review_group_policies where session_id=p_session and activity_id=aid) or not exists(select 1 from public.session_group_members where session_id=p_session and group_id=gid and participant_id=actor) or not exists(select 1 from public.work_items where session_id=p_session and group_id=gid and activity_id=aid) then raise exception 'not_allowed' using errcode='42501'; end if;
 insert into public.review_disclosures(session_id,activity_id,group_id,participant_id,interval_id,policy) select p_session,aid,gid,actor,i.id,1 from public.group_membership_intervals i where i.session_id=p_session and i.group_id=gid and i.participant_id=actor and i.ended_at is null on conflict do nothing;
 elsif cmd='create' then
 if jsonb_typeof(p_request->'fields')<>'array' or jsonb_typeof(p_request->'recipients')<>'array' then raise exception 'invalid_review'; end if;
 fields:=array(select jsonb_array_elements_text(p_request->'fields'));recipients:=array(select v::uuid from jsonb_array_elements_text(p_request->'recipients') v);target:=p_request->>'activity';
 if cardinality(recipients) not between 1 and 40 or cardinality(fields) not between 1 and 20 or cardinality(recipients)<>(select count(distinct v) from unnest(recipients) v) or cardinality(fields)<>(select count(distinct v) from unnest(fields) v) then raise exception 'invalid_review'; end if;
 select * into t from public.work_attempts where id=(p_request->>'attempt')::uuid and session_id=p_session for share;
 if t.id is null or target is distinct from (select content->'activities'->e.current_index->>'id' from public.workshop_versions where id=e.version_id) or e.state not in ('live','paused') or not exists(select 1 from public.workshop_versions v cross join lateral jsonb_array_elements(v.content->'activities') with ordinality a where v.id=e.version_id and a.value->>'id'=t.activity_id and a.ordinality-1<e.current_index) then raise exception 'invalid_review'; end if;
 if t.group_id is not null and not public.lock_group_capability() then raise exception 'review_unavailable'; end if;
 source:=public.review_source(t.id,fields);
 if source is null or exists(select 1 from unnest(recipients) r where not exists(select 1 from public.session_participants where session_id=p_session and id=r and state='admitted') or r=t.participant_id or exists(select 1 from jsonb_array_elements(t.snapshot->'roster') m where (m->>'participant')::uuid=r) or exists(select 1 from jsonb_array_elements(source->'fields') f cross join lateral jsonb_array_elements_text(f->'authors') a where a::uuid=r)) then raise exception 'invalid_review'; end if;
 if (select count(*) from public.review_proposals where session_id=p_session)>=100 then raise exception 'invalid_review'; end if;
 insert into public.review_proposals(id,session_id,workspace_id,version_id,source_attempt,source_owner,source_kind,source_activity,target_activity,fields,recipients,presentation,projection_digest,state,created_by)
 values((p_request->>'proposal')::uuid,p_session,s.workspace_id,e.version_id,t.id,t.owner_id,t.owner_kind,t.activity_id,target,fields,recipients,source->'presentation',encode(extensions.digest(source::text,'sha256'),'hex'),case when t.group_id is null then 'draft' else 'approved' end,actor) returning * into p;
 insert into public.review_recipients(proposal_id,session_id,participant_id) select p.id,p_session,v from unnest(recipients) v;
 result:=result||jsonb_build_object('proposal',p.id);
 else
 select * into p from public.review_proposals where id=(p_request->>'proposal')::uuid and session_id=p_session for update;
 if p.id is null or (not p_host and (p.source_kind<>'individual' or p.source_owner<>actor)) then raise exception 'not_allowed' using errcode='42501'; end if;
 if p.closed_at is not null then raise exception 'review_closed'; end if;
 if cmd in ('close','revoke') and (jsonb_typeof(p_request->'reason') is distinct from 'string' or not public.work_nonblank(p_request->>'reason') or char_length(p_request->>'reason')>500) then raise exception 'invalid_review'; end if;
 if cmd='request' then
 if p.state<>'draft' or public.review_source(p.source_attempt,p.fields,p.presentation) is null or not exists(select 1 from public.session_participants where session_id=p_session and id=p.source_owner and state='admitted') then raise exception 'review_prerequisite'; end if;
 update public.review_proposals set state='pending',revision=revision+1 where id=p.id;
 elsif cmd='approve' then
 if p.state<>'pending' or public.review_source(p.source_attempt,p.fields,p.presentation) is null then raise exception 'review_prerequisite'; end if;
 update public.review_proposals set state='approved',revision=revision+1 where id=p.id;
 elsif cmd in ('decline','withdraw','cancel','close') then
 if (cmd='decline' and p.state<>'pending') or (cmd='withdraw' and p.state not in ('pending','approved','released')) or (cmd='cancel' and p.state='released') then raise exception 'review_prerequisite'; end if;
 update public.review_proposals set state=case cmd when 'decline' then 'declined' when 'withdraw' then 'withdrawn' when 'cancel' then 'cancelled' else 'closed' end,closed_at=clock_timestamp(),revision=revision+1,reason=p_request->>'reason' where id=p.id;
 elsif cmd='revoke' then
 chosen:=(p_request->>'participant')::uuid;
 update public.review_recipients set revoked_at=coalesce(revoked_at,clock_timestamp()),reason=coalesce(reason,p_request->>'reason') where proposal_id=p.id and participant_id=chosen;
 if not found then raise exception 'not_allowed' using errcode='42501'; end if;
 update public.review_proposals set revision=revision+1 where id=p.id;
 elsif cmd='release' then
 preview:=public.review_preview(p.id);
 if p_request->>'token' is distinct from preview->>'token' then raise exception 'stale_review'; end if;
 if jsonb_array_length(preview->'problems')>0 then raise exception 'review_prerequisite'; end if;
 if p.source_kind='group' and not public.lock_group_capability() then raise exception 'review_unavailable'; end if;
 insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,review_id,trigger,activity_id,selectors,created_by,released_at) values(p.id,p_session,s.workspace_id,e.version_id,p.id,'manual',p.target_activity,'[]',actor,clock_timestamp());
 insert into public.resource_recipients(allocation_id,session_id,participant_id,generation) select p.id,p_session,v,1 from unnest(p.recipients) v;
 insert into public.resource_grants(allocation_id,participant_id,kind) select p.id,v,'individual' from unnest(p.recipients) v;
 insert into public.resource_notices(allocation_id,participant_id,generation) select p.id,v,1 from unnest(p.recipients) v;
 update public.review_proposals set state='released',revision=revision+1 where id=p.id;
 end if;
 insert into public.review_decisions(proposal_id,actor_id,decision,revision) select id,actor,cmd,revision from public.review_proposals where id=p.id;
 result:=result||jsonb_build_object('proposal',p.id);
 end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if cmd in ('create','request','approve','release','enable_policy','ack_policy') and (e.deadline<=clock_timestamp() or (public.effective_session(s)).state='ended') then raise exception 'review_closed'; end if;
 insert into public.review_commands(operation_id,session_id,actor_id,digest,receipt) values(p_operation,p_session,actor,digest,result);
 return result;
end $$;

create function public.read_reviews(p_session uuid,p_credential_hash text default null,p_host boolean default false,p_offset integer default 0,p_proposal uuid default null,p_source_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; e public.session_execution; s public.sessions; result jsonb; items jsonb; candidates jsonb:='[]'; policies jsonb; preview jsonb; current_activity text; begin
 if p_offset is null or p_offset<0 or p_source_offset is null or p_source_offset<0 then raise exception 'invalid_review'; end if;
 perform 1 from public.sessions where id=p_session for share;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
 select * into e from public.session_execution where session_id=p_session;select * into s from public.sessions where id=p_session;s:=public.effective_session(s);
 select content->'activities'->e.current_index->>'id' into current_activity from public.workshop_versions where id=e.version_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'state',case when p.closed_at is null and (e.state='completed' or e.deadline<=clock_timestamp()) then 'closed' else p.state end,'revision',p.revision,'activity',p.target_activity,'source',public.review_source(p.source_attempt,p.fields,p.presentation),'recipients',(select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'revoked',r.revoked_at is not null) order by a.id) from public.review_recipients r join public.session_participants a on a.id=r.participant_id where r.proposal_id=p.id)) order by p.created_at,p.id),'[]') into items from
 (select * from public.review_proposals where session_id=p_session and (p_host or (source_kind='individual' and source_owner=actor and state<>'draft')) order by created_at,id offset p_offset limit 20) p;
 if p_host then
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'ordinal',t.ordinal,'owner',t.owner_id,'kind',t.owner_kind,'activity',t.activity_id,'label',a.value->>'title','fields',a.value->'outputs','owner_label',case when t.participant_id is not null then (select display_name from public.session_participants where id=t.participant_id) else 'Group '||(select ordinal from public.session_groups where id=t.group_id) end) order by t.submitted_at,t.id),'[]') into candidates
 from (select t.* from public.work_attempts t join public.workshop_versions v on v.id=e.version_id cross join lateral jsonb_array_elements(v.content->'activities') with ordinality a where t.session_id=p_session and a.value->>'id'=t.activity_id and a.ordinality-1<e.current_index order by t.submitted_at,t.id offset p_source_offset limit 20) t cross join public.workshop_versions v cross join lateral jsonb_array_elements(v.content->'activities') with ordinality a where t.session_id=p_session and v.id=e.version_id and a.value->>'id'=t.activity_id and a.ordinality-1<e.current_index;
 if p_proposal is not null then
 if not exists(select 1 from public.review_proposals where id=p_proposal and session_id=p_session) then raise exception 'not_allowed' using errcode='42501'; end if;
 preview:=public.review_preview(p_proposal); end if;
 elsif p_proposal is not null then raise exception 'not_allowed' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('activity',p.activity_id,'group',g.id,'policy',p.policy,'text',public.review_policy_text(),'acknowledged',public.review_group_acknowledged(p_session,p.activity_id,g.id,actor),'ready',public.review_group_ready(p_session,p.activity_id,g.id),'pending',(select coalesce(jsonb_agg(jsonb_build_object('id',sp.id,'name',sp.display_name) order by sp.id),'[]') from public.session_group_members m join public.session_participants sp on sp.id=m.participant_id where m.session_id=p_session and m.group_id=g.id and not public.review_group_acknowledged(p_session,p.activity_id,g.id,sp.id))) order by p.activity_id,g.ordinal),'[]') into policies
 from public.review_group_policies p join public.session_groups g on g.session_id=p.session_id where p.session_id=p_session and (p_host or exists(select 1 from public.session_group_members m where m.session_id=p_session and m.group_id=g.id and m.participant_id=actor)) and (p_host or exists(select 1 from public.work_items where session_id=p_session and group_id=g.id and activity_id=p.activity_id));
 result:=jsonb_build_object('session',p_session,'actor',actor,'endpoint',case when p_host then auth.jwt()->>'session_id' else encode(extensions.digest(p_credential_hash,'sha256'),'hex') end,'enabled',(select enabled from public.review_capability where singleton),'ttl_ms',greatest(0,least(5000,case when e.deadline is not null and s.state='open' then extract(epoch from e.deadline-clock_timestamp())*1000 else 5000 end,case when p_host then ((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000 else 5000 end)),'current',current_activity,'state',case when s.state='ended' then 'completed' else e.state end,'items',items,'policies',policies,'preview',preview,'next_offset',case when (select count(*) from public.review_proposals where session_id=p_session and (p_host or (source_kind='individual' and source_owner=actor and state<>'draft')))>p_offset+20 then p_offset+20 end);
 if p_host then result:=result||jsonb_build_object('source_next_offset',case when (select count(*) from public.work_attempts t join public.workshop_versions v on v.id=e.version_id cross join lateral jsonb_array_elements(v.content->'activities') with ordinality a where t.session_id=p_session and a.value->>'id'=t.activity_id and a.ordinality-1<e.current_index)>p_source_offset+20 then p_source_offset+20 end,'sources',candidates,'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by id),'[]') from public.session_participants where session_id=p_session and state='admitted'),'activities',(select content->'activities' from public.workshop_versions where id=e.version_id)); end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 result:=jsonb_set(result,'{ttl_ms}',to_jsonb(greatest(0,least((result->>'ttl_ms')::numeric,extract(epoch from s.ended_at+interval '90 days'-clock_timestamp())*1000,case when p_host then (select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid) end))));
 return result;
end $$;

alter function public.group_draft_allowed(uuid,uuid,text,uuid) rename to group_draft_allowed_before_review;
create function public.group_draft_allowed(p_session uuid,p_group uuid,p_activity text,p_actor uuid) returns boolean language sql security definer set search_path='' as $$
 select public.group_draft_allowed_before_review(p_session,p_group,p_activity,p_actor) and public.review_group_acknowledged(p_session,p_activity,p_group,p_actor);
$$;
alter function public.group_work_command(uuid,uuid,jsonb,text) rename to group_work_command_before_review;
create function public.group_work_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 perform 1 from public.sessions where id=p_session for update;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_request->>'command' in ('accept_partial','reopen','close'));
 -- Existing receipts still pass the original current-authority and digest checks.
 if not exists(select 1 from public.work_commands where operation_id=p_operation) and p_request->>'command' in ('contribute','answer','replace_field','submit','submit_incomplete') and not public.review_group_ready(p_session,p_request->>'activity',(p_request->>'group')::uuid) then raise exception 'review_disclosure_required'; end if;
 return public.group_work_command_before_review(p_session,p_operation,p_request,p_credential_hash);
end $$;
alter function public.read_group_work(uuid,text,boolean) rename to read_group_work_before_review;
create function public.read_group_work(p_session uuid,p_credential_hash text default null,p_host boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; items jsonb; begin
 result:=public.read_group_work_before_review(p_session,p_credential_hash,p_host);
 select coalesce(jsonb_agg(case when x ? 'writable' then jsonb_set(x,'{writable}',to_jsonb((x->>'writable')::boolean and public.review_group_ready(p_session,x->'activity'->>'id',(x->>'group')::uuid))) else x end),'[]') into items from jsonb_array_elements(result->'items') x;
 return jsonb_set(result,'{items}',items);
end $$;
alter function public.resource_access(uuid,uuid) rename to resource_access_before_review;
create function public.resource_access(p_allocation uuid,p_participant uuid) returns boolean language sql security definer set search_path='' as $$
 select case when a.review_id is null then public.resource_access_before_review(a.id,p_participant) else a.released_at is not null and a.revoked_at is null and public.review_access(a.review_id,p_participant) and exists(select 1 from public.resource_recipients r where r.allocation_id=a.id and r.participant_id=p_participant and r.revoked_at is null) end from public.resource_allocations a where a.id=p_allocation;
$$;
alter function public.resource_command(uuid,uuid,jsonb,text,boolean) rename to resource_command_before_review;
create function public.resource_command(p_session uuid,p_operation uuid,p_request jsonb,p_credential_hash text default null,p_host boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
 perform 1 from public.sessions where id=p_session for update;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if p_request->>'command' not in ('ack','dismiss') and exists(select 1 from public.resource_allocations where id=(p_request->>'allocation')::uuid and review_id is not null) then raise exception 'not_allowed' using errcode='42501'; end if;
 return public.resource_command_before_review(p_session,p_operation,p_request,p_credential_hash,p_host);
end $$;
-- Public resource projections call Evidence; no materialized answer in the library.
create function public.resource_delivery_version(p_allocation uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; p public.review_proposals; source jsonb; begin
 select * into a from public.resource_allocations where id=p_allocation;
 if a.review_id is null then return public.resource_version_projection(a.resource_version); end if;
 select * into p from public.review_proposals where id=a.review_id;
 source:=public.review_source(p.source_attempt,p.fields,p.presentation);
 if source is null then return null; end if;
 return jsonb_build_object('id',p.id,'title',source->'presentation'->>'source_title','ordinal',source->'ordinal','kind','review','content','','check',null,'review',source);
end $$;

create or replace function public.resource_allocation_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.session_id,new.workspace_id,new.agenda_version,new.created_by,new.review_id) is distinct from (old.id,old.session_id,old.workspace_id,old.agenda_version,old.created_by,old.review_id)
 or (old.released_at is not null and (new.resource_version,new.trigger,new.activity_id,new.released_at) is distinct from (old.resource_version,old.trigger,old.activity_id,old.released_at))
 or (old.revoked_at is not null and (new.revoked_at,new.revoked_by,new.revocation_reason) is distinct from (old.revoked_at,old.revoked_by,old.revocation_reason)) then raise exception 'resource_identity_frozen'; end if;
 return new;
end $$;

create or replace function public.resource_item(p_allocation uuid,p_actor uuid,p_host boolean,p_endpoint text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.resource_allocations; v jsonb; rr public.resource_recipients; n public.resource_notices; result jsonb; recipients jsonb; begin
 select * into a from public.resource_allocations where id=p_allocation;
 v:=public.resource_delivery_version(a.id);
 if a.id is null or v is null or (not p_host and not public.resource_access(a.id,p_actor)) then return null; end if;
 result:=jsonb_build_object('allocation',a.id,'revision',a.revision,'version',v->'id','title',v->'title','kind',v->'kind','ordinal',v->'ordinal','trigger',a.trigger,'activity',a.activity_id,'released_at',a.released_at,'revoked_at',a.revoked_at);
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

create or replace function public.read_resources(p_session uuid,p_host boolean default false,p_credential_hash text default null,p_allocation uuid default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; endpoint text; s public.sessions; e public.session_execution; items jsonb; notices jsonb:='[]'; detail jsonb; result jsonb; ttl numeric:=5000; begin
 if p_offset is null or p_offset<0 then raise exception 'invalid_resource'; end if;
 perform 1 from public.sessions where id=p_session for share;
 actor:=public.authorize_work(p_session,null,p_credential_hash,p_host);
 select * into s from public.sessions where id=p_session; s:=public.effective_session(s); select * into e from public.session_execution where session_id=p_session;
 endpoint:=case when p_host then auth.jwt()->>'session_id' else encode(extensions.digest(p_credential_hash,'sha256'),'hex') end;
 perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id join public.resource_allocations a on a.resource_version=v.id where a.session_id=p_session order by r.id for share of r,v;
 select coalesce(jsonb_agg(public.resource_item(a.id,actor,p_host,endpoint) order by a.id),'[]'::jsonb) into items from (select a.id from public.resource_allocations a cross join lateral (select public.resource_delivery_version(a.id) data) dv where a.session_id=p_session and dv.data is not null and (p_host or public.resource_access(a.id,actor)) order by a.id offset p_offset limit 20) a;
 -- Release notices are independent of the paged tray. Resolve only the current
 -- recipient generation through the same authority predicate; never copy bodies.
 if not p_host then
 select coalesce(jsonb_agg(q.notice order by q.created_at,q.id),'[]'::jsonb) into notices from (
 select n.created_at,n.id,jsonb_build_object('allocation',a.id,'title',dv.data->>'title','ordinal',dv.data->'ordinal','notice',jsonb_build_object('id',n.id,'generation',n.generation,'dismissed',false,'received',coalesce(n.acked_endpoint=endpoint,false))) notice
 from public.resource_allocations a cross join lateral (select public.resource_delivery_version(a.id) data) dv
 join public.resource_recipients rr on rr.allocation_id=a.id and rr.participant_id=actor
 join public.resource_notices n on n.allocation_id=rr.allocation_id and n.participant_id=rr.participant_id and n.generation=rr.generation
 where a.session_id=p_session and n.dismissed_at is null and public.resource_access(a.id,actor)
 order by n.created_at,n.id limit 100) q;
 end if;
 if p_allocation is not null then
 select public.resource_item(a.id,actor,p_host,endpoint)||jsonb_build_object('content',dv.data->>'content','check',dv.data->'check','review',dv.data->'review') into detail from public.resource_allocations a cross join lateral (select public.resource_delivery_version(a.id) data) dv where a.id=p_allocation and a.session_id=p_session and (p_host or public.resource_access(a.id,actor));
 if detail is null then raise exception 'not_allowed' using errcode='42501'; end if; end if;
 perform public.authorize_work(p_session,null,p_credential_hash,p_host);
 if p_host then ttl:=least(ttl,((auth.jwt()->>'exp')::numeric-extract(epoch from clock_timestamp()))*1000,(select extract(epoch from not_after-clock_timestamp())*1000 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid)); end if;
 if s.ended_at is not null then ttl:=least(ttl,extract(epoch from s.ended_at+interval '90 days'-clock_timestamp())*1000); elsif e.deadline is not null then ttl:=least(ttl,extract(epoch from e.deadline+interval '90 days'-clock_timestamp())*1000); end if;
 if exists(select 1 from public.resource_allocations where session_id=p_session and review_id is not null) and s.state='open' then ttl:=least(ttl,extract(epoch from e.deadline-clock_timestamp())*1000); end if;
 result:=jsonb_build_object('session',p_session,'actor',actor,'endpoint',endpoint,'ttl_ms',greatest(0,ttl),'enabled',(select enabled from public.resource_capability where singleton),'items',items,'notices',notices,'detail',detail,'next_offset',case when (select count(*) from public.resource_allocations aa where public.resource_delivery_version(aa.id) is not null and aa.session_id=p_session and (p_host or public.resource_access(aa.id,actor)))>p_offset+20 then p_offset+20 end);
 if p_host then result:=result||jsonb_build_object('workspace',s.workspace_id,'state',case when s.state='ended' then 'completed' else e.state end,'participants',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by id),'[]'::jsonb) from public.session_participants where session_id=p_session and state='admitted'),'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'ordinal',ordinal) order by ordinal),'[]'::jsonb) from public.session_groups where session_id=p_session and not retired),'activities',(select content->'activities' from public.workshop_versions where id=e.version_id)); end if;
 return result;
end $$;

-- Only authenticated command/projection entrypoints are exposed. Internal helpers
-- and renamed predecessor functions cannot be invoked as a bypass through RPC.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'review_%' or p.proname in ('read_reviews','resource_delivery_version','group_draft_allowed_before_review','group_work_command_before_review','read_group_work_before_review','resource_access_before_review','resource_command_before_review')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
revoke all on function public.group_draft_allowed(uuid,uuid,text,uuid),public.resource_access(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.group_work_command(uuid,uuid,jsonb,text),public.read_group_work(uuid,text,boolean),public.resource_command(uuid,uuid,jsonb,text,boolean) from public;
grant execute on function public.review_command(uuid,uuid,jsonb,text,boolean),public.read_reviews(uuid,text,boolean,integer,uuid,integer),public.group_work_command(uuid,uuid,jsonb,text),public.read_group_work(uuid,text,boolean),public.resource_command(uuid,uuid,jsonb,text,boolean) to anon,authenticated;
