-- MANUAL, PRE-PRODUCTION ONLY. Destroys the audit trail created by
-- migrations/20261104120000_audit_events.sql. Not applied automatically.
-- Run this BEFORE the store_domains and tenancy_core rollbacks (newest first).
begin;
drop trigger if exists memberships_audit on public.memberships;
drop trigger if exists stores_audit on public.stores;
drop trigger if exists organizations_audit on public.organizations;
drop function if exists public.record_audit_event(uuid, uuid, uuid, text, text, text, public.audit_outcome, text, jsonb);
drop function if exists private.audit_row_change();
drop function if exists private.current_correlation_id();
drop table if exists public.audit_events;
drop function if exists private.audit_events_immutable();
drop type if exists public.audit_outcome;
commit;
