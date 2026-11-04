-- THI-66: tamper-resistant audit trail for sensitive tenant changes.
-- Forward-only. Manual pre-production undo: supabase/rollbacks/20261104120000_audit_events.down.sql.
-- Design: docs/security/merchant-auth.md.

create type public.audit_outcome as enum ('success', 'denied', 'failure');

-- No foreign keys on purpose: evidence must outlive the organization, store or user it describes.
-- Rows carry ids and column NAMES only, never values (contact emails, notes), so the trail holds no PII.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  store_id uuid,
  actor_user_id uuid,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{0,79}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  target_id text check (char_length(target_id) <= 120),
  outcome public.audit_outcome not null,
  correlation_id text not null check (correlation_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now()
);
create index audit_events_org_created_idx on public.audit_events (organization_id, created_at desc);

alter table public.audit_events enable row level security;
-- Owners and admins read their own organization's trail; nobody writes through the API.
create policy audit_events_select on public.audit_events for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;

-- Row-level guard against UPDATE/DELETE. TRUNCATE and service_role privileges are handled by
-- 20261104130000_audit_events_harden.sql (a row trigger does not fire for TRUNCATE).
create function private.audit_events_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;
create trigger audit_events_no_update_delete before update or delete on public.audit_events
  for each row execute function private.audit_events_immutable();

-- Correlation id: take the one the server forwarded as an x-correlation-id request header
-- (PostgREST exposes request headers as a GUC), else generate one. Never trust its shape.
create function private.current_correlation_id() returns text
language plpgsql stable set search_path = ''
as $$
declare
  forwarded text;
begin
  begin
    forwarded := (nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-correlation-id';
  exception when others then
    forwarded := null;
  end;
  if forwarded is not null and forwarded ~ '^[A-Za-z0-9_-]{8,64}$' then
    return forwarded;
  end if;
  return replace(gen_random_uuid()::text, '-', '');
end;
$$;

-- Row-change auditing. SECURITY DEFINER because API roles have no INSERT on audit_events; the
-- trigger is the only writer besides public.record_audit_event. It runs for service_role writes
-- too, so a bug or compromise in trusted server code still leaves a trail. Actor is the verified
-- session user (auth.uid()); null means a trusted/system context.
create function private.audit_row_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
  store uuid;
  actor uuid := (select auth.uid());
  act text;
  ttype text := tg_table_name;
  tid text;
  meta jsonb := '{}';
  changed text[];
begin
  if tg_table_name = 'memberships' then
    org := coalesce(new.organization_id, old.organization_id);
    tid := coalesce(new.user_id, old.user_id)::text;
    ttype := 'membership';
    if tg_op = 'INSERT' then
      act := 'membership.added';
      meta := jsonb_build_object('role', new.role);
      actor := coalesce(actor, new.created_by);
    elsif tg_op = 'UPDATE' then
      if new.role is not distinct from old.role then return null; end if;
      act := 'membership.role_changed';
      meta := jsonb_build_object('from', old.role, 'to', new.role);
    else
      act := 'membership.removed';
      meta := jsonb_build_object('role', old.role);
    end if;
  elsif tg_table_name = 'stores' then
    org := coalesce(new.organization_id, old.organization_id);
    store := coalesce(new.id, old.id);
    tid := store::text;
    ttype := 'store';
    if tg_op = 'INSERT' then
      act := 'store.created';
      meta := jsonb_build_object('status', new.status);
    elsif tg_op = 'UPDATE' then
      select array_agg(c order by c) into changed from (
        select 'slug' as c where new.slug is distinct from old.slug
        union all select 'name' where new.name is distinct from old.name
        union all select 'status' where new.status is distinct from old.status
        union all select 'contact_email' where new.contact_email is distinct from old.contact_email
        union all select 'internal_notes' where new.internal_notes is distinct from old.internal_notes
      ) d;
      if changed is null then return null; end if;
      act := 'store.updated';
      meta := jsonb_build_object('changed', changed);
      if new.status is distinct from old.status then
        meta := meta || jsonb_build_object('status_from', old.status, 'status_to', new.status);
      end if;
    else
      act := 'store.deleted';
    end if;
  else
    org := coalesce(new.id, old.id);
    tid := org::text;
    ttype := 'organization';
    if tg_op = 'INSERT' then
      act := 'organization.created';
    elsif tg_op = 'UPDATE' then
      if new.name is not distinct from old.name then return null; end if;
      act := 'organization.renamed';
    else
      act := 'organization.deleted';
    end if;
  end if;

  insert into public.audit_events
    (organization_id, store_id, actor_user_id, action, target_type, target_id, outcome, correlation_id, metadata)
  values (org, store, actor, act, ttype, tid, 'success', private.current_correlation_id(), meta);
  return null;
end;
$$;

create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_row_change();
create trigger stores_audit after insert or update or delete on public.stores
  for each row execute function private.audit_row_change();
create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function private.audit_row_change();

-- Application-level events (denied attempts). Server-only: the trusted server has already
-- verified the session and passes the actor. SECURITY INVOKER (runs as service_role). To stop an
-- attacker from spamming another tenant's trail with a guessed organization id, the actor must
-- currently be a member of that organization; attempts by non-members are logged by the server only.
create function public.record_audit_event(
  org uuid, store uuid, actor uuid, action_name text, target_type_name text, target_identifier text,
  result public.audit_outcome, correlation text, details jsonb
) returns void
language plpgsql set search_path = ''
as $$
begin
  perform 1 from public.memberships m where m.organization_id = org and m.user_id = actor;
  if not found then
    raise exception 'actor is not a member of the organization' using errcode = '42501';
  end if;
  insert into public.audit_events
    (organization_id, store_id, actor_user_id, action, target_type, target_id, outcome, correlation_id, metadata)
  values (org, store, actor, action_name, target_type_name, target_identifier, result, correlation, coalesce(details, '{}'));
end;
$$;
revoke all on function public.record_audit_event(uuid, uuid, uuid, text, text, text, public.audit_outcome, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_audit_event(uuid, uuid, uuid, text, text, text, public.audit_outcome, text, jsonb)
  to service_role;

revoke all on function private.audit_events_immutable(), private.current_correlation_id(), private.audit_row_change()
  from public, anon, authenticated;
