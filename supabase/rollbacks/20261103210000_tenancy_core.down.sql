-- MANUAL, PRE-PRODUCTION ONLY. Destroys all tenant data created by
-- migrations/20261103210000_tenancy_core.sql. Not applied automatically.
-- Once real tenants exist, roll forward with a new migration instead.
drop function if exists public.create_organization(text, uuid);
drop table if exists public.store_public_profiles;
drop table if exists public.stores;
drop table if exists public.memberships;
drop table if exists public.organizations;
drop function if exists private.guard_store_suspension();
drop function if exists private.protect_last_owner();
drop function if exists private.stamp_membership_creator();
drop function if exists private.touch_updated_at();
drop function if exists private.store_is_active(uuid);
drop function if exists private.has_org_role(uuid, public.org_role[]);
drop function if exists private.is_org_member(uuid);
drop type if exists public.homepage_mode;
drop type if exists public.store_currency;
drop type if exists public.store_status;
drop type if exists public.org_role;
-- The private schema and the default-privilege revocations are intentionally kept (deny by default).
