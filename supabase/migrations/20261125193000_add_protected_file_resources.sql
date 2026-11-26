-- Title: Add protected file resources
-- File objects are private; these rows carry authority, quota and immutable references.
alter table public.resources drop constraint resources_kind_check;
alter table public.resources add constraint resources_kind_check check(kind in ('text','link','file'));
alter table public.resource_versions add constraint resource_versions_kind_check check(kind in ('text','link','file'));

create table public.file_resource_capability(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 generation uuid not null default gen_random_uuid()
);
insert into public.file_resource_capability(singleton) values(true);
create trigger file_resource_capability_changed before update on public.file_resource_capability for each row execute function public.input_capability_changed();
create table public.file_blocked_digests(
 sha256 text primary key check(sha256 ~ '^[0-9a-f]{64}$'),
 blocked_at timestamptz not null default clock_timestamp()
);

create table public.resource_file_intents(
 id uuid primary key default gen_random_uuid(), operation_id uuid not null unique,
 workspace_id uuid not null references public.workspaces(id),
 resource_id uuid not null, revision integer not null check(revision>0),
 actor_id uuid not null references auth.users(id), auth_session uuid not null,
 auth_expires_at timestamptz not null,
 request_digest text not null check(request_digest ~ '^[0-9a-f]{64}$'),
 title text not null, filename text not null,
 mime text not null check(mime in ('application/pdf','text/plain')),
 byte_size integer not null check(byte_size between 1 and 10485760),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 staging_key text not null unique, ready_key text not null unique,
 state text not null default 'pending' check(state in ('pending','uploading','validated','promoting','ready','rejected','unavailable','deleted')),
 error_code text, version_id uuid unique,
 validated_scanner text, validated_signatures_at timestamptz, validated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
 purged_at timestamptz,
 staging_purged_at timestamptz,
 upload_lock_until timestamptz,
 cleanup_attempts integer not null default 0,
 cleanup_error text,
 cleanup_next_at timestamptz,
 cleanup_alerted_at timestamptz,
 unique(workspace_id,id),
 foreign key(workspace_id,resource_id) references public.resources(workspace_id,id)
);
create index file_intents_quota on public.resource_file_intents(workspace_id,purged_at);
create table public.resource_file_versions(
 version_id uuid primary key references public.resource_versions(id),
 intent_id uuid not null unique references public.resource_file_intents(id),
 workspace_id uuid not null references public.workspaces(id),
 filename text not null, mime text not null check(mime in ('application/pdf','text/plain')),
 byte_size integer not null check(byte_size between 1 and 10485760),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 storage_key text not null unique,
 scanner_version text not null, signatures_at timestamptz not null,
 scanned_at timestamptz not null,
 last_verified_at timestamptz not null default clock_timestamp(),
 state text not null default 'ready' check(state in ('ready','unavailable','deleted')),
 changed_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,version_id) references public.resource_versions(workspace_id,id)
);
create function public.freeze_file_version_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.version_id,new.intent_id,new.workspace_id,new.filename,new.mime,new.byte_size,new.sha256,new.storage_key,new.scanner_version,new.signatures_at,new.scanned_at)
 is distinct from
 (old.version_id,old.intent_id,old.workspace_id,old.filename,old.mime,old.byte_size,old.sha256,old.storage_key,old.scanner_version,old.signatures_at,old.scanned_at)
 or (old.state='deleted' and new.state<>'deleted') then raise exception 'resource_identity_frozen'; end if;
 return new;
end $$;
create trigger freeze_file_version_identity before update on public.resource_file_versions for each row execute function public.freeze_file_version_identity();
do $$ declare n text; begin
 foreach n in array array['file_resource_capability','file_blocked_digests','resource_file_intents','resource_file_versions'] loop
 execute format('alter table public.%I enable row level security',n);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;
-- The application service may look up exact keys only after a caller's scoped read.
grant select on public.resource_file_intents,public.resource_file_versions to service_role;

create function public.begin_file_resource(
 p_workspace uuid,p_operation uuid,p_resource uuid,p_revision integer,
 p_title text,p_filename text,p_mime text,p_size integer,p_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.resources; i public.resource_file_intents; d text; next_revision integer; begin
 perform public.require_resource_host(p_workspace);
 perform public.lock_resource_capability();
 if not (select enabled from public.file_resource_capability where singleton for share) then raise exception 'resource_unavailable'; end if;
 if p_operation is null or p_resource is null or p_revision is null or p_revision<0 or p_revision>2147483646 or
 public.work_nonblank(p_title) is distinct from true or length(p_title)>120 or
 p_filename is null or length(p_filename) not between 1 and 120 or p_filename !~ '^[^/\\[:cntrl:]]+\.(pdf|txt)$' or
 translate(p_filename,chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||chr(8294)||chr(8295)||chr(8296)||chr(8297),'')<>p_filename or
 p_mime not in ('application/pdf','text/plain') or
 (p_mime='application/pdf' and right(p_filename,4)<>'.pdf') or
 (p_mime='text/plain' and right(p_filename,4)<>'.txt') or
 p_size not between 1 and 10485760 or p_sha256 !~ '^[0-9a-f]{64}$'
 then raise exception 'invalid_resource'; end if;
 d:=encode(extensions.digest(jsonb_build_array(p_workspace,p_resource,p_revision,p_title,p_filename,p_mime,p_size,p_sha256)::text,'sha256'),'hex');
 if exists(select 1 from public.file_blocked_digests where sha256=p_sha256) then raise exception 'resource_unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('file-operation-'||p_operation::text,0));
 select * into i from public.resource_file_intents where operation_id=p_operation;
 if i.id is not null then
  if i.workspace_id<>p_workspace or i.actor_id<>auth.uid() or i.request_digest<>d then raise exception 'operation_reused'; end if;
  perform public.require_resource_host(p_workspace);
  return jsonb_build_object('intent',i.id,'resource',i.resource_id,'revision',i.revision,'state',i.state,'expires_at',i.expires_at,'version',i.version_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('file-quota-'||p_workspace::text,0));
 if (select count(*) from public.resource_file_intents where workspace_id=p_workspace and purged_at is null)>=100 or
 coalesce((select sum(byte_size * case when state='promoting' and staging_purged_at is null then 2 else 1 end) from public.resource_file_intents where workspace_id=p_workspace and purged_at is null),0)+p_size>104857600
 then raise exception 'resource_prerequisite'; end if;
 perform pg_advisory_xact_lock(hashtextextended('resource-'||p_resource::text,0));
 select * into r from public.resources where id=p_resource for update;
 if r.id is not null and (r.workspace_id<>p_workspace or r.kind<>'file') then raise exception 'not_allowed' using errcode='42501'; end if;
 if coalesce(r.revision,0)<>p_revision or exists(select 1 from public.resource_file_intents where resource_id=p_resource and state in ('pending','uploading','validated','promoting','unavailable') and purged_at is null) then raise exception 'resource_conflict'; end if;
 next_revision:=p_revision+1;
 if r.id is null then insert into public.resources(id,workspace_id,created_by,revision,title,kind,content) values(p_resource,p_workspace,auth.uid(),next_revision,p_title,'file','');
 else update public.resources set revision=next_revision,title=p_title where id=p_resource; end if;
 insert into public.resource_file_intents(operation_id,workspace_id,resource_id,revision,actor_id,auth_session,auth_expires_at,request_digest,title,filename,mime,byte_size,sha256,staging_key,ready_key)
 values(p_operation,p_workspace,p_resource,next_revision,auth.uid(),(auth.jwt()->>'session_id')::uuid,to_timestamp((auth.jwt()->>'exp')::numeric),d,p_title,p_filename,p_mime,p_size,p_sha256,p_workspace::text||'/'||gen_random_uuid()::text,p_workspace::text||'/'||gen_random_uuid()::text)
 returning * into i;
 perform public.require_resource_host(p_workspace);
 return jsonb_build_object('intent',i.id,'resource',i.resource_id,'revision',i.revision,'state',i.state,'expires_at',i.expires_at,'version',i.version_id);
end $$;

create function public.read_file_resource(p_workspace uuid,p_intent uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 perform public.require_resource_host(p_workspace);
 select * into i from public.resource_file_intents where id=p_intent and workspace_id=p_workspace;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 return jsonb_build_object('intent',i.id,'resource',i.resource_id,'revision',i.revision,'state',i.state,'error',i.error_code,'filename',i.filename,'mime',i.mime,'size',i.byte_size,'version',i.version_id,'expires_at',i.expires_at,'upload_lock_until',i.upload_lock_until);
end $$;

create function public.read_file_resource_for_resource(p_workspace uuid,p_resource uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i uuid; begin
 perform public.require_resource_host(p_workspace);
 select id into i from public.resource_file_intents where workspace_id=p_workspace and resource_id=p_resource order by created_at desc,id desc limit 1;
 if i is null then return null; end if;
 return public.read_file_resource(p_workspace,i);
end $$;

create function public.reserve_file_upload(p_intent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null or i.expires_at<=clock_timestamp() or i.purged_at is not null or i.auth_expires_at<=clock_timestamp() then return false; end if;
 perform 1 from public.workspaces where id=i.workspace_id for share;
 perform 1 from auth.sessions where id=i.auth_session for share;
 if not exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=i.workspace_id and w.owner_id=i.actor_id and s.id=i.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) or
 not (select enabled from public.file_resource_capability where singleton) or not (select enabled from public.resource_capability where singleton) then return false; end if;
 if i.state='uploading' and i.upload_lock_until<=clock_timestamp() then
  update public.resource_file_intents set state='pending',upload_lock_until=null where id=i.id;
 elsif i.state<>'pending' then return false;
 end if;
 update public.resource_file_intents set state='uploading',upload_lock_until=clock_timestamp()+interval '60 seconds' where id=i.id;
 return true;
end $$;

create function public.finish_file_upload(p_intent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null then return false; end if;
 if i.state='uploading' then
  perform 1 from public.workspaces where id=i.workspace_id for share;
  perform 1 from auth.sessions where id=i.auth_session for share;
  if i.auth_expires_at>clock_timestamp() and exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=i.workspace_id and w.owner_id=i.actor_id and s.id=i.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) then
   update public.resource_file_intents set state='pending',upload_lock_until=null where id=i.id;
   return true;
  end if;
  update public.resource_file_intents set state='deleted',upload_lock_until=null,error_code='not_allowed' where id=i.id;
  return false;
 end if;
 update public.resource_file_intents set upload_lock_until=null where id=i.id;
 return false;
end $$;

-- A clean staged-byte verdict is durable, but cannot itself release a file.
-- The host must separately mark the validated version Ready.
create function public.validate_file_resource(p_intent uuid,p_sha256 text,p_scanner text,p_signatures_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; now_at timestamptz:=clock_timestamp(); begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null or i.state not in ('pending','unavailable','validated') or i.version_id is not null or i.expires_at<=now_at or i.auth_expires_at<=now_at or
 p_sha256 is distinct from i.sha256 or p_scanner is null or length(p_scanner)>120 or p_signatures_at is null or p_signatures_at>now_at or p_signatures_at<now_at-interval '24 hours' or
 exists(select 1 from public.file_blocked_digests where sha256=i.sha256) or
 not (select enabled from public.file_resource_capability where singleton) or not (select enabled from public.resource_capability where singleton) or
 not exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=i.workspace_id and w.owner_id=i.actor_id and s.id=i.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>now_at))
 then raise exception 'resource_unavailable'; end if;
 update public.resource_file_intents set state='validated',error_code=null,validated_scanner=p_scanner,validated_signatures_at=p_signatures_at,validated_at=now_at where id=i.id;
 return jsonb_build_object('intent',i.id,'resource',i.resource_id,'revision',i.revision,'state','validated','filename',i.filename,'size',i.byte_size);
end $$;

-- Reserve the temporary second copy before promotion. The reservation remains
-- durable across a crash until staging is actually removed and Ready commits.
create function public.reserve_file_promotion(p_intent uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; used_bytes bigint; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into i from public.resource_file_intents where id=p_intent;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('file-quota-'||i.workspace_id::text,0));
 select * into i from public.resource_file_intents where id=p_intent for update;
 perform 1 from public.workspaces where id=i.workspace_id for share;
 perform 1 from auth.sessions where id=i.auth_session for share;
 if i.auth_expires_at<=clock_timestamp() or exists(select 1 from public.file_blocked_digests where sha256=i.sha256) or not exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=i.workspace_id and w.owner_id=i.actor_id and s.id=i.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>clock_timestamp())) or
 not (select enabled from public.file_resource_capability where singleton) or not (select enabled from public.resource_capability where singleton) then raise exception 'resource_unavailable'; end if;
 if i.expires_at<=clock_timestamp() or i.purged_at is not null then raise exception 'resource_unavailable'; end if;
 if i.state='promoting' then return; end if;
 if i.state<>'validated' or i.version_id is not null or i.expires_at<=clock_timestamp() or i.validated_signatures_at is null or i.validated_signatures_at<clock_timestamp()-interval '24 hours' then raise exception 'resource_unavailable'; end if;
 select coalesce(sum(byte_size * case when state='promoting' and staging_purged_at is null then 2 else 1 end),0) into used_bytes from public.resource_file_intents where workspace_id=i.workspace_id and purged_at is null;
 if used_bytes+i.byte_size>104857600 then raise exception 'resource_prerequisite'; end if;
 update public.resource_file_intents set state='promoting',error_code=null where id=i.id;
end $$;

-- Service-only completion cannot trust a browser's scan claim. The server checks
-- stored bytes and scanner first, then presents the exact digest and verdict here.
create function public.finish_file_resource(p_intent uuid,p_sha256 text,p_scanner text,p_signatures_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; r public.resources; vid uuid; now_at timestamptz:=clock_timestamp(); begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('file-digest-'||p_sha256,0));
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if i.state='ready' and i.sha256=p_sha256 then return jsonb_build_object('committed',true,'resource',i.resource_id,'revision',i.revision,'version',i.version_id); end if;
 select * into r from public.resources where id=i.resource_id and workspace_id=i.workspace_id for update;
 perform 1 from public.workspaces where id=i.workspace_id for share;
 perform 1 from auth.sessions where id=i.auth_session for share;
 if i.state<>'promoting' or i.version_id is not null or i.expires_at<=now_at or i.auth_expires_at<=now_at or r.revision<>i.revision or r.kind<>'file' or
 not exists(select 1 from public.workspaces w join auth.sessions s on s.user_id=w.owner_id where w.id=i.workspace_id and w.owner_id=i.actor_id and s.id=i.auth_session and s.aal='aal2' and (s.not_after is null or s.not_after>now_at)) or
 not (select enabled from public.file_resource_capability where singleton) or
 not (select enabled from public.resource_capability where singleton) or
 exists(select 1 from public.file_blocked_digests where sha256=i.sha256) or
 p_sha256 is distinct from i.sha256 or p_scanner is null or length(p_scanner)>120 or p_signatures_at is null or p_signatures_at>now_at or p_signatures_at<now_at-interval '24 hours'
 then raise exception 'resource_unavailable'; end if;
 insert into public.resource_versions(workspace_id,resource_id,ordinal,draft_revision,title,kind,content,created_by)
 values(i.workspace_id,i.resource_id,coalesce((select max(ordinal) from public.resource_versions where resource_id=i.resource_id),0)+1,i.revision,r.title,'file','',i.actor_id) returning id into vid;
 insert into public.resource_file_versions(version_id,intent_id,workspace_id,filename,mime,byte_size,sha256,storage_key,scanner_version,signatures_at,scanned_at)
 values(vid,i.id,i.workspace_id,i.filename,i.mime,i.byte_size,i.sha256,i.ready_key,p_scanner,p_signatures_at,now_at);
 update public.resource_file_intents set state='ready',version_id=vid,error_code=null,staging_purged_at=now_at where id=i.id;
 return jsonb_build_object('committed',true,'resource',i.resource_id,'revision',i.revision,'version',vid);
end $$;

create function public.set_file_resource_state(p_intent uuid,p_state text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_state not in ('unavailable','rejected','deleted') or p_error is not null and (length(p_error)>50 or p_error !~ '^[a-z_]+$') then raise exception 'invalid_resource'; end if;
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if i.state='deleted' and p_state<>'deleted' or i.state='rejected' and p_state<>'deleted' then raise exception 'not_allowed' using errcode='42501'; end if;
 update public.resource_file_intents set state=p_state,error_code=p_error where id=i.id;
 if i.version_id is not null then update public.resource_file_versions set state=case when p_state='deleted' then 'deleted' else 'unavailable' end,changed_at=clock_timestamp() where version_id=i.version_id; end if;
end $$;

-- Incident response for a digest newly identified as unsafe. This transition
-- is atomic across every matching workspace and cannot restore a version.
create function public.quarantine_file_digest(p_sha256 text) returns integer language plpgsql security definer set search_path='' as $$
declare affected integer; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_resource'; end if;
 perform pg_advisory_xact_lock(hashtextextended('file-digest-'||p_sha256,0));
 insert into public.file_blocked_digests(sha256) values(p_sha256) on conflict do nothing;
 perform 1 from public.resource_file_intents where sha256=p_sha256 order by id for update;
 update public.resource_file_intents set state='unavailable',error_code='known_bad'
 where sha256=p_sha256 and state='ready';
 update public.resource_file_versions set state='unavailable',changed_at=clock_timestamp()
 where sha256=p_sha256 and state='ready';
 get diagnostics affected=row_count;
 return affected;
end $$;

create function public.delete_file_resource(p_workspace uuid,p_intent uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 perform public.require_resource_host(p_workspace);
 select * into i from public.resource_file_intents where id=p_intent and workspace_id=p_workspace for update;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 perform 1 from public.resources where id=i.resource_id for share;
 perform public.require_resource_host(p_workspace);
 update public.resource_file_intents set state='deleted',error_code=null where id=i.id and state<>'deleted';
 if i.version_id is not null then update public.resource_file_versions set state='deleted',changed_at=clock_timestamp() where version_id=i.version_id and state<>'deleted'; end if;
 return jsonb_build_object('committed',true,'intent',i.id,'version',i.version_id,'purged',i.purged_at is not null);
end $$;

create function public.delete_file_resource_version(p_workspace uuid,p_version uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare file_intent uuid; begin
 perform public.require_resource_host(p_workspace);
 select intent_id into file_intent from public.resource_file_versions where workspace_id=p_workspace and version_id=p_version;
 if file_intent is null then raise exception 'not_allowed' using errcode='42501'; end if;
 return public.delete_file_resource(p_workspace,file_intent);
end $$;

create function public.purge_file_resource(p_intent uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 update public.resource_file_intents set purged_at=coalesce(purged_at,clock_timestamp()),cleanup_error=null,cleanup_next_at=null where id=p_intent and state='deleted' and (upload_lock_until is null or upload_lock_until<=clock_timestamp());
 if not found then raise exception 'not_allowed' using errcode='42501'; end if;
end $$;

create function public.record_file_cleanup_failure(p_intent uuid,p_error text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_error not in ('storage_unavailable','purge_unavailable') then raise exception 'invalid_resource'; end if;
 update public.resource_file_intents set cleanup_attempts=cleanup_attempts+1,cleanup_error=p_error,
 cleanup_next_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(cleanup_attempts,7)))::integer),
 cleanup_alerted_at=case when cleanup_attempts>=2 then coalesce(cleanup_alerted_at,clock_timestamp()) else cleanup_alerted_at end
 where id=p_intent and state='deleted' and purged_at is null;
 if not found then raise exception 'not_allowed' using errcode='42501'; end if;
end $$;

create function public.expire_file_resource(p_intent uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare i public.resource_file_intents; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into i from public.resource_file_intents where id=p_intent for update;
 if i.id is null then raise exception 'not_allowed' using errcode='42501'; end if;
 if i.state='deleted' then return true; end if;
 if i.state in ('pending','uploading','validated','promoting','unavailable','rejected') and i.version_id is null and i.expires_at<=clock_timestamp() and (i.upload_lock_until is null or i.upload_lock_until<=clock_timestamp()) then
  update public.resource_file_intents set state='deleted',error_code='expired' where id=i.id;
  return true;
 end if;
 return false;
end $$;

create function public.file_version_in_session(p_session uuid,p_version uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare workspace uuid; begin
 perform public.authorize_work(p_session,null,null,true);
 select workspace_id into workspace from public.sessions where id=p_session;
 if workspace is null or not exists(select 1 from public.resource_versions where id=p_version and workspace_id=workspace) then raise exception 'not_allowed' using errcode='42501'; end if;
 return exists(select 1 from public.resource_file_versions where version_id=p_version and workspace_id=workspace);
end $$;

-- A server preflight may skip external Storage probing for an operation that
-- already has a durable receipt. The command itself still checks its exact
-- payload, actor and current authority before returning that receipt.
create function public.file_operation_replay_candidate(p_session uuid,p_operation uuid,p_execution boolean) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform public.authorize_work(p_session,null,null,true);
 if p_operation is null or p_execution is null then raise exception 'invalid_resource'; end if;
 if p_execution then
  return exists(select 1 from public.execution_commands where session_id=p_session and operation_id=p_operation and actor_id=auth.uid());
 end if;
 return exists(select 1 from public.resource_commands where session_id=p_session and operation_id=p_operation and actor_id=auth.uid());
end $$;

create function public.due_file_versions_for_host(p_session uuid) returns uuid[] language plpgsql security definer set search_path='' as $$
declare versions uuid[]; begin
 perform public.authorize_work(p_session,null,null,true);
 select coalesce(array_agg(f.version_id order by f.version_id),'{}'::uuid[]) into versions
 from public.due_resource_allocations(p_session) a join public.resource_file_versions f on f.version_id=a.resource_version
 join public.sessions s on s.id=a.session_id and s.workspace_id=f.workspace_id;
 return versions;
end $$;

create function public.verify_file_version(p_version uuid,p_sha256 text) returns boolean language plpgsql security definer set search_path='' as $$
declare f public.resource_file_versions; begin
 if auth.role()<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 select * into f from public.resource_file_versions where version_id=p_version for update;
 if f.version_id is null or f.state<>'ready' or f.sha256 is distinct from p_sha256 then return false; end if;
 update public.resource_file_versions set last_verified_at=clock_timestamp() where version_id=p_version;
 return true;
end $$;

create or replace function public.resource_version_projection(p_version uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'resource',v.resource_id,'ordinal',v.ordinal,'title',v.title,'kind',v.kind,'content',v.content,'ready_at',v.ready_at,
 'check',public.resource_check_projection((select c.id from public.resource_checks c where c.version_id=v.id order by c.started_at desc,c.id desc limit 1)),
 'file',case when v.kind='file' then jsonb_build_object('filename',f.filename,'mime',f.mime,'size',f.byte_size,'status',case when fc.enabled then f.state else 'unavailable' end) end)
 from public.resource_versions v join public.resources r on r.id=v.resource_id and r.workspace_id=v.workspace_id
 left join public.resource_file_versions f on f.version_id=v.id
 cross join public.file_resource_capability fc
 where v.id=p_version;
$$;

-- Existing release and recovery paths retain their audience logic. A file's
-- current safety state participates in their exact preview token.
do $$ declare definition text; marker text; begin
 definition:=pg_get_functiondef('public.resource_library_command(uuid,uuid,jsonb)'::regprocedure);
 marker:='if cmd=''save'' then';
 if position(marker in definition)=0 or position('elsif cmd=''ready'' then' in definition)=0 then raise exception 'file authoring insertion point missing'; end if;
 definition:=replace(definition,marker,marker||chr(10)||' if r.id is not null and r.kind=''file'' then raise exception ''invalid_resource''; end if;');
 definition:=replace(definition,'elsif cmd=''ready'' then','elsif cmd=''ready'' then'||chr(10)||' if r.kind=''file'' then raise exception ''invalid_resource''; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.read_resource_library(uuid,uuid,integer,boolean)'::regprocedure);
 marker:='''enabled'',(select enabled from public.resource_capability where singleton)';
 if position(marker in definition)=0 then raise exception 'file library status insertion point missing'; end if;
 definition:=replace(definition,marker,marker||',''file_enabled'',(select enabled from public.file_resource_capability where singleton)');
 execute definition;
 definition:=pg_get_functiondef('public.build_resource_preview(uuid,jsonb,boolean)'::regprocedure);
 marker:='if v is null then raise exception ''not_allowed'' using errcode=''42501''; end if;';
 if position(marker in definition)=0 then raise exception 'file preview insertion point missing'; end if;
 definition:=replace(definition,marker,marker||chr(10)||' if v->>''kind''=''file'' and ((v->''file''->>''status'') is distinct from ''ready'' or not exists(select 1 from public.resource_file_versions f where f.version_id=(v->>''id'')::uuid and f.state=''ready'' and f.last_verified_at>clock_timestamp()-interval ''15 seconds'')) then problems:=problems||jsonb_build_array(''The exact file version is unavailable.''); end if;');
 execute definition;
 definition:=pg_get_functiondef('public.read_resources(uuid,boolean,text,uuid,integer)'::regprocedure);
 marker:='''review'', dv.data -> ''review''';
 if position(marker in definition)=0 then
  marker:='''review'',dv.data->''review''';
 end if;
 if position(marker in definition)=0 then raise exception 'file detail insertion point missing'; end if;
 definition:=replace(definition,marker,marker||',''file'',dv.data->''file''');
 execute definition;
 definition:=pg_get_functiondef('public.resource_command_before_review(uuid,uuid,jsonb,text,boolean)'::regprocedure);
 marker:='perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id where v.id=(p_request->>''version'')::uuid order by r.id for share of r,v;';
 if position(marker in definition)=0 then raise exception 'file manual release lock point missing'; end if;
 definition:=replace(definition,marker,marker||chr(10)||' perform 1 from public.resource_file_versions where version_id=(p_request->>''version'')::uuid for share;');
 marker:='preview:=public.build_resource_preview(p_session,p_request);';
 if position(marker in definition)=0 then raise exception 'file confirmation status point missing'; end if;
 definition:=replace(definition,marker,marker||chr(10)||' if preview->''version''->>''kind''=''file'' and jsonb_array_length(preview->''problems'')>0 then raise exception ''resource_unavailable''; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.resource_execution_preview(uuid)'::regprocedure);
 marker:='perform 1 from public.resources r join public.resource_versions v on v.resource_id=r.id join public.due_resource_allocations(p_session) due on due.resource_version=v.id order by r.id for share of r,v;';
 if position(marker in definition)=0 then raise exception 'file due release lock point missing'; end if;
 definition:=replace(definition,marker,marker||chr(10)||' perform 1 from public.resource_file_versions f join public.due_resource_allocations(p_session) due on due.resource_version=f.version_id order by f.version_id for share of f;');
 execute definition;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('begin_file_resource','read_file_resource','read_file_resource_for_resource','reserve_file_upload','finish_file_upload','validate_file_resource','reserve_file_promotion','finish_file_resource','set_file_resource_state','quarantine_file_digest','delete_file_resource','delete_file_resource_version','purge_file_resource','record_file_cleanup_failure','expire_file_resource','file_version_in_session','file_operation_replay_candidate','due_file_versions_for_host','verify_file_version','freeze_file_version_identity') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end $$;
grant execute on function public.begin_file_resource(uuid,uuid,uuid,integer,text,text,text,integer,text),public.read_file_resource(uuid,uuid),public.read_file_resource_for_resource(uuid,uuid),public.delete_file_resource(uuid,uuid),public.delete_file_resource_version(uuid,uuid),public.file_version_in_session(uuid,uuid),public.file_operation_replay_candidate(uuid,uuid,boolean),public.due_file_versions_for_host(uuid) to authenticated;
grant execute on function public.reserve_file_upload(uuid),public.finish_file_upload(uuid),public.validate_file_resource(uuid,text,text,timestamptz),public.reserve_file_promotion(uuid),public.finish_file_resource(uuid,text,text,timestamptz),public.set_file_resource_state(uuid,text,text),public.quarantine_file_digest(text),public.purge_file_resource(uuid),public.record_file_cleanup_failure(uuid,text),public.expire_file_resource(uuid),public.verify_file_version(uuid,text) to service_role;
