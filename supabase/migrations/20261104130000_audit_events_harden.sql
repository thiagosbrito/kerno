-- THI-66 review fix: make audit_events append-only for service_role too.
-- Forward-only. Manual pre-production undo: supabase/rollbacks/20261104130000_audit_events_harden.down.sql.
-- Supabase's default privileges give service_role ALL on public tables, and a row trigger does not
-- fire for TRUNCATE, so the first migration did not actually stop a service-role wipe or forged insert.

revoke insert, update, delete, truncate on public.audit_events from service_role;

create function private.audit_events_no_truncate() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end;
$$;
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function private.audit_events_no_truncate();
revoke all on function private.audit_events_no_truncate() from public, anon, authenticated;

-- service_role can no longer INSERT directly, so this function is now the only service-side writer.
-- SECURITY DEFINER (runs as the table owner) with a pinned search_path. Justification: the audit
-- table must not be writable by any API role, yet denied attempts are recorded on behalf of a
-- verified actor. The function still requires that actor to be a current member of the organization,
-- validates every field through the table's CHECK constraints, and stays executable by service_role only.
create or replace function public.record_audit_event(
  org uuid, store uuid, actor uuid, action_name text, target_type_name text, target_identifier text,
  result public.audit_outcome, correlation text, details jsonb
) returns void
language plpgsql security definer set search_path = ''
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
