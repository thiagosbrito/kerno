-- MANUAL, PRE-PRODUCTION ONLY. Destroys all domain claims created by
-- migrations/20261104090000_store_domains.sql. Not applied automatically.
-- Run this BEFORE the tenancy_core rollback (store_domains references stores).
begin;
drop function if exists public.resolve_store_by_slug(text);
drop function if exists public.resolve_store_by_host(text);
drop function if exists public.release_domain(uuid);
drop function if exists public.confirm_domain(uuid, boolean);
drop function if exists public.claim_domain(uuid, text, text);
drop table if exists public.store_domains;
alter table public.stores drop constraint if exists stores_slug_not_reserved;
commit;
