-- MANUAL, PRE-PRODUCTION ONLY. Reverts migrations/20261104130000_audit_events_harden.sql.
-- Run this BEFORE the audit_events rollback (newest first). Not applied automatically.
begin;
drop trigger if exists audit_events_no_truncate on public.audit_events;
drop function if exists private.audit_events_no_truncate();
create or replace function public.record_audit_event(
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
grant insert, update, delete, truncate on public.audit_events to service_role;
commit;
