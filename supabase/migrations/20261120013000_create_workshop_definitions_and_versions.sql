-- Title: Create workshop definitions and versions
-- P2-02a. A workshop keeps a stable identity; its agenda lives in numbered
-- versions. Hosts edit one draft, and "Ready to run" validates and freezes it.
-- The database is the only validator: owners can call these functions directly.

create extension if not exists pg_jsonschema with schema extensions;

-- The shape every saved agenda must have (drafts may still be incomplete).
create function public.workshop_content_schema()
returns json
language sql
immutable
set search_path = ''
as $$
  select '{
    "type": "object",
    "additionalProperties": false,
    "required": ["objectives", "activities"],
    "properties": {
      "objectives": {
        "type": "array",
        "maxItems": 20,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "text"],
          "properties": {
            "id": { "type": "string", "pattern": "^o[0-9]{1,6}$" },
            "text": { "type": "string", "maxLength": 300 }
          }
        }
      },
      "activities": {
        "type": "array",
        "maxItems": 40,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["id", "title", "instructions", "scope", "minutes", "outputs", "input", "objectives"],
          "properties": {
            "id": { "type": "string", "pattern": "^a[0-9]{1,6}$" },
            "title": { "type": "string", "maxLength": 120 },
            "instructions": { "type": "string", "maxLength": 4000 },
            "scope": { "enum": ["individual", "group"] },
            "minutes": { "type": "integer", "minimum": 1, "maximum": 240 },
            "outputs": {
              "type": "array",
              "maxItems": 10,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["id", "label", "kind"],
                "properties": {
                  "id": { "type": "string", "pattern": "^f[0-9]{1,6}$" },
                  "label": { "type": "string", "maxLength": 120 },
                  "kind": { "enum": ["short", "long"] }
                }
              }
            },
            "input": {
              "oneOf": [
                { "type": "null" },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["activity", "field"],
                  "properties": {
                    "activity": { "type": "string", "pattern": "^a[0-9]{1,6}$" },
                    "field": { "type": "string", "pattern": "^f[0-9]{1,6}$" }
                  }
                }
              ]
            },
            "objectives": {
              "type": "array",
              "maxItems": 20,
              "uniqueItems": true,
              "items": { "type": "string", "pattern": "^o[0-9]{1,6}$" }
            }
          }
        }
      }
    }
  }'::json;
$$;

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  title text not null check (
    char_length(title) between 1 and 120 and title !~ '^[[:space:]]|[[:space:]]$'
  ),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  -- The command that created it, so a retried create or duplicate returns it.
  operation_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index workshops_workspace on public.workshops (workspace_id);

create table public.workshop_versions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete restrict,
  number integer not null check (number > 0),
  state text not null default 'draft' check (state in ('draft', 'ready')),
  content jsonb not null default '{"objectives": [], "activities": []}'
    check (extensions.jsonb_matches_schema(public.workshop_content_schema(), content)),
  -- Optimistic concurrency: every save and the freeze must name the revision they loaded.
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  check ((state = 'ready') = (ready_at is not null)),
  unique (workshop_id, number)
);
-- One draft at a time per workshop.
create unique index workshop_versions_one_draft
  on public.workshop_versions (workshop_id) where state = 'draft';

-- A ready version is frozen: sessions will rely on it never changing.
create function public.keep_ready_versions_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'ready' then
    raise exception 'version_ready' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger workshop_versions_frozen
  before update or delete on public.workshop_versions
  for each row execute function public.keep_ready_versions_frozen();

alter table public.workshops enable row level security;
alter table public.workshop_versions enable row level security;

create policy "Owners with MFA read their workshops"
  on public.workshops for select to authenticated
  using (public.owns_workspace(workspace_id));

create policy "Owners with MFA read their workshop versions"
  on public.workshop_versions for select to authenticated
  using (exists (
    select 1 from public.workshops w
    where w.id = workshop_id and public.owns_workspace(w.workspace_id)
  ));

revoke all on public.workshops, public.workshop_versions from public, anon, authenticated;
grant select on public.workshops, public.workshop_versions to authenticated;

-- Problems that block "Ready to run" (1-based activity numbers). Empty means
-- ready. The result depends only on the agenda passed in.
create function public.workshop_problems(p_content jsonb)
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

-- Host helper: the caller's workshop, or a permission error that does not
-- reveal whether it exists.
create function public.require_owned_workshop(p_workshop uuid)
returns public.workshops
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workshop public.workshops;
begin
  select w.* into v_workshop from public.workshops w where w.id = p_workshop;
  if not found or not public.owns_workspace(v_workshop.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_workshop;
end;
$$;

-- Host helper: lock the caller's draft if it is still at the revision they
-- loaded. A missing expected revision is never treated as a match.
create function public.lock_current_draft(p_version uuid, p_expected_revision integer)
returns public.workshop_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.workshop_versions;
begin
  select v.* into v_version from public.workshop_versions v where v.id = p_version for update;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform public.require_owned_workshop(v_version.workshop_id);
  if v_version.state <> 'draft' then
    raise exception 'version_ready' using errcode = 'P0001';
  end if;
  if p_expected_revision is null or v_version.revision <> p_expected_revision then
    raise exception 'stale_draft' using errcode = 'P0001';
  end if;
  return v_version;
end;
$$;

-- A retried or concurrent request with the same operation gets what the first
-- one created; an operation used in another workspace is refused.
create function public.workshop_for_operation(p_workspace uuid, p_operation uuid)
returns public.workshops
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workshop public.workshops;
begin
  select w.* into v_workshop from public.workshops w
  where w.operation_id = p_operation and w.workspace_id = p_workspace;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_workshop;
end;
$$;

create function public.create_workshop(p_title text, p_operation uuid)
returns public.workshops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_workshop public.workshops;
begin
  select w.id into v_workspace from public.workspaces w where w.owner_id = auth.uid();
  if v_workspace is null or not public.current_session_has_mfa() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.workshops (workspace_id, title, operation_id)
  values (v_workspace, p_title, p_operation)
  on conflict (operation_id) do nothing
  returning * into v_workshop;
  if not found then
    return public.workshop_for_operation(v_workspace, p_operation);
  end if;
  insert into public.workshop_versions (workshop_id, number) values (v_workshop.id, 1);
  return v_workshop;
end;
$$;

-- Saves the whole draft agenda if nobody saved it since the caller loaded it.
create function public.save_workshop_draft(
  p_version uuid, p_expected_revision integer, p_content jsonb
)
returns public.workshop_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.workshop_versions := public.lock_current_draft(p_version, p_expected_revision);
begin
  update public.workshop_versions
  set content = p_content, revision = revision + 1, updated_at = now()
  where id = v_version.id
  returning * into v_version;
  return v_version;
end;
$$;

create function public.mark_workshop_ready(p_version uuid, p_expected_revision integer)
returns public.workshop_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.workshop_versions := public.lock_current_draft(p_version, p_expected_revision);
  v_problems text[] := public.workshop_problems(v_version.content);
begin
  if cardinality(v_problems) > 0 then
    raise exception 'not_ready'
      using errcode = 'P0001', detail = array_to_string(v_problems, E'\n');
  end if;
  update public.workshop_versions
  set state = 'ready', ready_at = now(), revision = revision + 1, updated_at = now()
  where id = v_version.id
  returning * into v_version;
  return v_version;
end;
$$;

-- Editing after "Ready to run" starts from the latest ready version as a new
-- draft; an existing draft is reused.
create function public.new_workshop_draft(p_workshop uuid)
returns public.workshop_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.workshop_versions;
begin
  perform public.require_owned_workshop(p_workshop);
  -- Serialise draft creation per workshop.
  perform 1 from public.workshops w where w.id = p_workshop for update;
  select v.* into v_version from public.workshop_versions v
  where v.workshop_id = p_workshop and v.state = 'draft';
  if found then
    return v_version;
  end if;
  insert into public.workshop_versions (workshop_id, number, content)
  select p_workshop,
    (select max(n.number) + 1 from public.workshop_versions n where n.workshop_id = p_workshop),
    v.content
  from public.workshop_versions v
  where v.workshop_id = p_workshop and v.state = 'ready'
  order by v.number desc
  limit 1
  returning * into v_version;
  return v_version;
end;
$$;

-- Copies configuration only; workshops hold no participants, work or approvals.
-- A retried request with the same operation returns the first copy.
create function public.duplicate_workshop(p_workshop uuid, p_operation uuid)
returns public.workshops
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.workshops := public.require_owned_workshop(p_workshop);
  v_copy public.workshops;
begin
  insert into public.workshops (workspace_id, title, operation_id)
  values (v_source.workspace_id, rtrim(left('Copy of ' || v_source.title, 120)), p_operation)
  on conflict (operation_id) do nothing
  returning * into v_copy;
  if not found then
    return public.workshop_for_operation(v_source.workspace_id, p_operation);
  end if;
  insert into public.workshop_versions (workshop_id, number, content)
  select v_copy.id, 1, v.content
  from public.workshop_versions v
  where v.workshop_id = p_workshop
  order by v.number desc
  limit 1;
  return v_copy;
end;
$$;

-- Supabase grants new functions to anon/authenticated by default; narrow them.
revoke all on function
  public.workshop_content_schema(),
  public.keep_ready_versions_frozen(),
  public.workshop_problems(jsonb),
  public.require_owned_workshop(uuid),
  public.lock_current_draft(uuid, integer),
  public.workshop_for_operation(uuid, uuid),
  public.create_workshop(text, uuid),
  public.save_workshop_draft(uuid, integer, jsonb),
  public.mark_workshop_ready(uuid, integer),
  public.new_workshop_draft(uuid),
  public.duplicate_workshop(uuid, uuid)
from public, anon, authenticated;
-- workshop_problems depends only on its input: the editor shows exactly what
-- Ready to run enforces.
grant execute on function
  public.workshop_content_schema(),
  public.workshop_problems(jsonb),
  public.create_workshop(text, uuid),
  public.save_workshop_draft(uuid, integer, jsonb),
  public.mark_workshop_ready(uuid, integer),
  public.new_workshop_draft(uuid),
  public.duplicate_workshop(uuid, uuid)
to authenticated;
