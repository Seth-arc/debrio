-- Title: Recheck group roster authority
-- Older admission/recovery clients must not mutate grouped identities after a lock outlives host authority.
create function public.authorize_group_roster_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.sessions;
begin
  if (old.state='admitted' or new.state='admitted') and
    (old.state is distinct from new.state or old.credential_hash is distinct from new.credential_hash) and
    exists(select 1 from public.session_execution where session_id=old.session_id) then
    perform public.authorize_work(old.session_id,null,null,true);
    select * into s from public.sessions where id=old.session_id;
    s:=public.effective_session(s);
    -- Verified credential recovery remains available during retained read-only review.
    if old.state is distinct from new.state and s.state='ended' then raise exception 'session_ended'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.authorize_group_roster_change() from public,anon,authenticated,service_role;
create trigger authorize_group_roster_change before update of state,credential_hash on public.session_participants
for each row execute function public.authorize_group_roster_change();
