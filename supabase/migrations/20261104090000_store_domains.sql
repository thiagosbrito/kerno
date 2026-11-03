-- THI-65: verified custom domains and public host resolution.
-- Forward-only. Manual pre-production undo: supabase/rollbacks/20261104090000_store_domains.down.sql.
-- Builds on 20261103210000_tenancy_core.sql. Design: docs/security/host-routing.md.

-- Slugs become hostnames (<slug>.<platform domain>), so names that could impersonate the
-- platform are reserved. Keep in step with RESERVED_STORE_SLUGS in packages/contracts (a test
-- compares the two lists).
alter table public.stores add constraint stores_slug_not_reserved check (slug not in ('www', 'api', 'app', 'admin', 'auth', 'login', 'logout', 'signup', 'register', 'account', 'accounts', 'billing', 'checkout', 'cdn', 'assets', 'static', 'media', 'mail', 'email', 'smtp', 'ftp', 'status', 'support', 'help', 'docs', 'blog', 'dashboard', 'console', 'kerno', 'platform', 'root', 'staging', 'preview'));

-- A claim is a request to serve a hostname for a store. Only a VERIFIED claim on an ACTIVE
-- store ever resolves (see the resolve_* functions). Hostnames are stored normalized:
-- lowercase ASCII (punycode for IDNs), no port, no trailing dot, at least two labels, and a
-- TLD that starts with a letter (so IP literals cannot be stored).
create table public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  hostname text not null check (
    char_length(hostname) <= 253
    and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  -- Published by the merchant in DNS to prove control (TXT _kerno-verification.<hostname>).
  verification_token text not null
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (not is_primary or verified_at is not null),
  unique (store_id, hostname)
);
-- Duplicate claims: many stores may hold a pending claim, but only one can ever be verified.
create unique index store_domains_verified_hostname_key on public.store_domains (hostname)
  where verified_at is not null;
create unique index store_domains_one_primary_key on public.store_domains (store_id)
  where is_primary;
create index store_domains_store_id_idx on public.store_domains (store_id);

alter table public.store_domains enable row level security;

-- Members read their own organization's claims (the stores subselect runs under the caller's
-- RLS). There is no API write path: claim, confirm and release are server-only functions.
create policy store_domains_select on public.store_domains for select to authenticated
  using (exists (select 1 from public.stores s where s.id = store_domains.store_id));

revoke all on public.store_domains from public, anon, authenticated;
grant select on public.store_domains to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only domain management (service_role). SECURITY INVOKER: they run with the
-- service role's own privileges. The server must have verified DNS ownership (TXT record)
-- before calling confirm_domain, and must authorize the acting merchant (AC-3).
-- ---------------------------------------------------------------------------

-- Idempotent: claiming the same hostname again for the same store returns the same token.
-- platform_domain is the platform's own suffix (for example kerno.app); hostnames equal to or
-- under it are reserved. A hostname already verified by ANOTHER store cannot be claimed.
create function public.claim_domain(target_store uuid, host text, platform_domain text)
returns table (domain_id uuid, verification_token text)
language plpgsql set search_path = ''
as $$
begin
  if platform_domain is null or platform_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
    raise exception 'platform domain must be a normalized lowercase hostname' using errcode = '22023';
  end if;
  if host = platform_domain or right(host, char_length(platform_domain) + 1) = '.' || platform_domain then
    raise exception 'hostname is reserved by the platform' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.store_domains d
    where d.hostname = host and d.verified_at is not null and d.store_id <> target_store
  ) then
    raise exception 'hostname is already verified' using errcode = '23505';
  end if;
  return query
    insert into public.store_domains as d (store_id, hostname) values (target_store, host)
    on conflict (store_id, hostname) do update set hostname = excluded.hostname
    returning d.id, d.verification_token;
end;
$$;

-- Marks a claim verified, optionally as the store's primary (canonical) hostname. If another
-- store verified the same hostname first, the unique index raises 23505 (first verified wins).
create function public.confirm_domain(domain uuid, make_primary boolean default false)
returns void
language plpgsql set search_path = ''
as $$
declare
  owner_store uuid;
begin
  select d.store_id into owner_store from public.store_domains d where d.id = domain for update;
  if owner_store is null then
    raise exception 'domain claim not found' using errcode = 'P0002';
  end if;
  update public.store_domains set verified_at = coalesce(verified_at, now()) where id = domain;
  if make_primary then
    update public.store_domains set is_primary = false where store_id = owner_store and is_primary and id <> domain;
    update public.store_domains set is_primary = true where id = domain;
  end if;
end;
$$;

create function public.release_domain(domain uuid) returns void
language sql set search_path = ''
as $$
  delete from public.store_domains where id = domain;
$$;

revoke all on function public.claim_domain(uuid, text, text), public.confirm_domain(uuid, boolean),
  public.release_domain(uuid) from public, anon, authenticated;
grant execute on function public.claim_domain(uuid, text, text), public.confirm_domain(uuid, boolean),
  public.release_domain(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Public host resolution. Anonymous visitors must be able to learn which store serves a
-- hostname, but must not read store_domains or stores. These SECURITY DEFINER functions are
-- the only public window: exact-match, ACTIVE stores only, verified claims only, and they
-- return only the store id, slug and primary hostname (all already public once a store is
-- live). They never normalize: callers pass the normalized hostname, so an unnormalized
-- spelling simply does not match.
-- ---------------------------------------------------------------------------
create function public.resolve_store_by_host(host text)
returns table (store_id uuid, slug text, canonical_hostname text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.slug, (select p.hostname from public.store_domains p where p.store_id = s.id and p.is_primary)
  from public.store_domains d
  join public.stores s on s.id = d.store_id
  where d.hostname = host and d.verified_at is not null and s.status = 'active';
$$;

create function public.resolve_store_by_slug(store_slug text)
returns table (store_id uuid, slug text, canonical_hostname text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.slug, (select p.hostname from public.store_domains p where p.store_id = s.id and p.is_primary)
  from public.stores s
  where s.slug = store_slug and s.status = 'active';
$$;

revoke all on function public.resolve_store_by_host(text), public.resolve_store_by_slug(text) from public;
grant execute on function public.resolve_store_by_host(text), public.resolve_store_by_slug(text)
  to anon, authenticated, service_role;
