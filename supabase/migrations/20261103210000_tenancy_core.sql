-- THI-64: tenants (organizations), stores, memberships and deny-by-default RLS.
-- Forward-only. Manual pre-production undo: supabase/rollbacks/20261103210000_tenancy_core.down.sql.
-- Requires Supabase-provided: roles anon/authenticated/service_role, auth.users, auth.uid().
-- Design and role semantics: docs/security/tenancy-and-rls.md.

-- ---------------------------------------------------------------------------
-- Deny by default: future tables in public are not readable/writable by API roles
-- until a migration grants and polices them explicitly.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public;
-- Policies call helpers in this schema as the invoking role, so USAGE is required.
-- The schema is not exposed through the Data API.
grant usage on schema private to anon, authenticated;

create type public.org_role as enum ('owner', 'admin', 'manager', 'staff');
create type public.store_status as enum ('draft', 'active', 'suspended');
create type public.store_currency as enum ('USD', 'BRL', 'PLN');
create type public.homepage_mode as enum ('landing', 'catalog');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

-- Merchant-private store record. Never readable by anonymous visitors.
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  name text not null check (char_length(name) between 1 and 120),
  status public.store_status not null default 'draft',
  contact_email text check (char_length(contact_email) <= 254),
  internal_notes text check (char_length(internal_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stores_organization_id_idx on public.stores (organization_id);

-- Public storefront projection. Add a column here only if it is safe to show to anyone.
create table public.store_public_profiles (
  store_id uuid primary key references public.stores (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  default_locale text not null check (default_locale in ('en', 'pt-BR', 'pl')),
  currency public.store_currency not null,
  homepage_mode public.homepage_mode not null default 'landing',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER is needed so policies can read memberships without
-- recursing into memberships' own RLS; all derive the user from auth.uid() and
-- read current membership rows (never JWT claims or user_metadata).
-- ---------------------------------------------------------------------------
create function private.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function private.has_org_role(org uuid, roles public.org_role[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

-- Exposes only whether a store id is active (public information) so anonymous
-- policies need no access to the private stores table.
create function private.store_is_active(store uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.stores s where s.id = store and s.status = 'active');
$$;

revoke all on function private.is_org_member(uuid), private.has_org_role(uuid, public.org_role[]),
  private.store_is_active(uuid) from public;
grant execute on function private.is_org_member(uuid), private.has_org_role(uuid, public.org_role[]),
  private.store_is_active(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger stores_touch_updated_at before update on public.stores
  for each row execute function private.touch_updated_at();
create trigger store_public_profiles_touch_updated_at before update on public.store_public_profiles
  for each row execute function private.touch_updated_at();

-- created_by cannot be forged by an API caller.
create function private.stamp_membership_creator() returns trigger
language plpgsql set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is not null then
    new.created_by := uid;
  end if;
  return new;
end;
$$;
create trigger memberships_stamp_creator before insert on public.memberships
  for each row execute function private.stamp_membership_creator();

-- An organization always keeps at least one owner. Locking the organization row
-- serializes concurrent demotions/removals so two owners cannot both pass the check.
-- SECURITY DEFINER: must see the organization and all owners regardless of caller RLS.
create function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  -- Organization already gone (cascade from organization delete): allow.
  perform 1 from public.organizations o where o.id = old.organization_id for update;
  if not found then
    return coalesce(new, old);
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
  ) then
    raise exception 'organization must keep at least one owner' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_protect_last_owner before update or delete on public.memberships
  for each row execute function private.protect_last_owner();

-- Only the platform (service role / migrations: no end-user subject) may suspend a store
-- or lift a suspension, so a merchant cannot undo an abuse takedown.
create function private.guard_store_suspension() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (
    (tg_op = 'INSERT' and new.status = 'suspended') or
    (tg_op = 'UPDATE' and new.status is distinct from old.status
      and (new.status = 'suspended' or old.status = 'suspended'))
  ) then
    raise exception 'store suspension is controlled by the platform' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger stores_guard_suspension before insert or update on public.stores
  for each row execute function private.guard_store_suspension();

-- Trigger functions are never called directly. EXECUTE is only checked when a trigger is
-- created, so removing the default PUBLIC grant does not affect firing.
revoke all on function private.touch_updated_at(), private.stamp_membership_creator(),
  private.protect_last_owner(), private.guard_store_suspension() from public;

-- ---------------------------------------------------------------------------
-- Organization creation: the only way to bootstrap a tenant, and server-only. Shoppers are
-- also authenticated users, so API roles must not be able to create organizations. The
-- trusted server (merchant onboarding, THI-68) verifies the session and passes the owner
-- explicitly (AC-3). SECURITY INVOKER: runs with service_role's own privileges, atomically.
-- ---------------------------------------------------------------------------
create function public.create_organization(org_name text, owner_user_id uuid) returns uuid
language plpgsql set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.organizations (name) values (org_name) returning id into new_id;
  insert into public.memberships (organization_id, user_id, role, created_by)
    values (new_id, owner_user_id, 'owner', owner_user_id);
  return new_id;
end;
$$;
revoke all on function public.create_organization(text, uuid) from public, anon, authenticated;
grant execute on function public.create_organization(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security: enabled everywhere, policies enumerated per role/action.
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.stores enable row level security;
alter table public.store_public_profiles enable row level security;

-- organizations (insert only via create_organization)
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.has_org_role(id, array['owner']::public.org_role[]))
  with check (private.has_org_role(id, array['owner']::public.org_role[]));
create policy organizations_delete on public.organizations for delete to authenticated
  using (private.has_org_role(id, array['owner']::public.org_role[]));

-- memberships: owner manages all; admin manages managers and staff; any member may leave.
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_org_member(organization_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner']::public.org_role[])
    or (private.has_org_role(organization_id, array['admin']::public.org_role[]) and role in ('manager', 'staff'))
  );
create policy memberships_update on public.memberships for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner']::public.org_role[])
    or (private.has_org_role(organization_id, array['admin']::public.org_role[]) and role in ('manager', 'staff'))
  )
  with check (
    private.has_org_role(organization_id, array['owner']::public.org_role[])
    or (private.has_org_role(organization_id, array['admin']::public.org_role[]) and role in ('manager', 'staff'))
  );
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner']::public.org_role[])
    or (private.has_org_role(organization_id, array['admin']::public.org_role[]) and role in ('manager', 'staff'))
    or user_id = (select auth.uid())
  );

-- stores (private)
create policy stores_select on public.stores for select to authenticated
  using (private.is_org_member(organization_id));
create policy stores_insert on public.stores for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
create policy stores_update on public.stores for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (private.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
create policy stores_delete on public.stores for delete to authenticated
  using (private.has_org_role(organization_id, array['owner']::public.org_role[]));

-- store_public_profiles: anyone reads active stores; members read their drafts; owner/admin write.
-- The subselects on stores run under the caller's RLS, so they only see own-organization stores.
create policy profiles_public_select on public.store_public_profiles for select to anon, authenticated
  using (private.store_is_active(store_id));
create policy profiles_member_select on public.store_public_profiles for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_id));
create policy profiles_insert on public.store_public_profiles for insert to authenticated
  with check (exists (
    select 1 from public.stores s
    where s.id = store_id and private.has_org_role(s.organization_id, array['owner', 'admin']::public.org_role[])
  ));
create policy profiles_update on public.store_public_profiles for update to authenticated
  using (exists (
    select 1 from public.stores s
    where s.id = store_id and private.has_org_role(s.organization_id, array['owner', 'admin']::public.org_role[])
  ))
  with check (exists (
    select 1 from public.stores s
    where s.id = store_id and private.has_org_role(s.organization_id, array['owner', 'admin']::public.org_role[])
  ));
create policy profiles_delete on public.store_public_profiles for delete to authenticated
  using (exists (
    select 1 from public.stores s
    where s.id = store_id and private.has_org_role(s.organization_id, array['owner']::public.org_role[])
  ));

-- ---------------------------------------------------------------------------
-- Privileges: least privilege on top of RLS. Column-level INSERT/UPDATE grants make
-- ids, organization_id and timestamps immutable through the API (forged tenant IDs).
-- service_role keeps Supabase's BYPASSRLS and full table access: server-only credential.
-- ---------------------------------------------------------------------------
revoke all on public.organizations, public.memberships, public.stores, public.store_public_profiles
  from public, anon, authenticated;

grant select, delete on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select, delete on public.memberships to authenticated;
grant insert (organization_id, user_id, role) on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

grant select, delete on public.stores to authenticated;
grant insert (organization_id, slug, name, status, contact_email, internal_notes) on public.stores to authenticated;
grant update (slug, name, status, contact_email, internal_notes) on public.stores to authenticated;

grant select on public.store_public_profiles to anon, authenticated;
grant delete on public.store_public_profiles to authenticated;
grant insert (store_id, display_name, default_locale, currency, homepage_mode)
  on public.store_public_profiles to authenticated;
grant update (display_name, default_locale, currency, homepage_mode)
  on public.store_public_profiles to authenticated;
