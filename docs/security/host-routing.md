# Verified hostname-to-store routing (THI-65)

One storefront deployment serves many stores. The only input that selects a store is the request's **normalized hostname**, resolved to an **active** store through a **verified** claim or a platform subdomain. Everything else (forwarded headers, paths, cookies, query, bodies) is ignored for tenant selection. This document is the trusted-proxy and canonical-host contract; abuse cases are AC-8, AC-9 and AC-10 in the [threat model](threat-model.md).

## Hostname forms

| Form | Example | Resolves when |
| --- | --- | --- |
| Platform subdomain | `acme-books.<PLATFORM_DOMAIN>` | exactly one label under the platform domain that is a valid store slug, and the store is `active` |
| Custom domain | `shop.acme-sneakers.test` | a `store_domains` row has `verified_at` set and the store is `active` |

Slug names that could impersonate the platform (`www`, `api`, `login`, `auth`, `status`, `kerno`, ... see `RESERVED_STORE_SLUGS`) are rejected by a CHECK on `stores.slug` and again by the resolver. Never a store: the platform apex, nested names under it (`a.b.<PLATFORM_DOMAIN>`), pending/unverified claims, draft or suspended stores, IP literals, single-label names, anything malformed. These resolve to a generic 404 with `Cache-Control: no-store`.

**Normalization** (`packages/server/src/tenancy/hostname.ts`) accepts one host: trims nothing (whitespace is rejected), lowercases, strips one port and one trailing dot, converts IDNs to punycode, then requires 2+ LDH labels, a letter-led TLD and the DNS length limits. Userinfo, paths, queries, backslashes, control characters, IPv4/IPv6 literals and comma lists are rejected. The same shape is enforced by a CHECK on `store_domains.hostname` and by the resolver SQL functions matching exactly (they never normalize), so a non-normalized spelling cannot match.

## Trusted proxy boundary

Hosting is undecided (THI-86), so the policy is hosting-independent and fail-closed (`request-host.ts`):

- **Default (`TRUSTED_FORWARDED_HOST_HEADER` unset):** only the `Host` header is read. `X-Forwarded-Host`, `Forwarded`, `X-Original-Host`, `X-Host` and similar are ignored, so a client cannot choose a store by sending them.
- **Trusted edge:** set `TRUSTED_FORWARDED_HOST_HEADER` to the name of the **one** header your edge/proxy sets with the public hostname (`x-...` only). The edge **must overwrite or strip** that header on every inbound request; the app cannot verify who set it. When set, `Host` is ignored and a missing header fails closed (404), never falling back to `Host`.
- The edge must reject requests with more than one `Host` header and must normalize the authority (absolute-URI request lines), so a cache in front of the app and the origin agree on the host.
- A comma-separated value (appended by a hop, or injected by a client) is ambiguous and rejected.
- Operational requirement, not enforced by code: the origin must not be reachable except through the trusted edge when this mode is on. Revisit when THI-86 chooses hosting.

## Canonical hosts

A store's canonical host is its verified primary custom domain (`store_domains.is_primary`, at most one per store, requires verification) or else `<slug>.<PLATFORM_DOMAIN>`. The resolver returns it with every match. THI-65 only **exposes** it; redirecting non-canonical hosts to it, and building absolute links from it, belongs to later tickets. Absolute URLs must be built from the canonical host, never from the request's `Host` or a forwarded header (AC-9).

## Claiming and verifying a domain

All writes are server-only (`service_role`) SQL functions; members can read their own organization's rows and cannot write:

1. `claim_domain(store, host, platform_domain)` records a pending claim and returns a 64-hex `verification_token` (idempotent per store+host). Hostnames equal to or under the platform domain are refused (a store cannot claim `x.kerno.app`). A host already **verified** by another store is refused. Several stores may hold a pending claim for the same host.
2. The merchant publishes TXT `_kerno-verification.<host>` = `kerno-verification=<token>`. `verifyDomainOwnership` (`verification.ts`) checks it with a single DNS TXT query; resolver errors mean "not verified". No HTTP request to a merchant-controlled URL is made, so there is no SSRF surface here (AC-17).
3. `confirm_domain(domain, make_primary)` marks it verified. A partial unique index makes the **first verified claim win**; a second store confirming the same host gets `23505`.
4. `release_domain(domain)` deletes the claim; deleting the store cascades. A released or suspended host stops resolving after the cache TTL.

The caller of these functions (THI-68 merchant UI/API) must authorize the acting merchant against the store and run the DNS check before `confirm_domain` (AC-3). That caller and an audit event for each action (AC-32) do not exist yet.

## Public resolution surface

`resolve_store_by_host(host)` and `resolve_store_by_slug(slug)` are `SECURITY DEFINER` (anon may call), return only `store_id`, `slug` and `canonical_hostname` for **active** stores, and never expose `store_domains`, `stores` or any private column. The storefront calls them and reads `store_public_profiles` with the **anon key** only; the service-role key is not used on the request path. Any transport error, timeout, non-2xx status or unexpected row shape is "unavailable": the proxy answers 503 (`Retry-After`) and nothing is cached.

## Caching (AC-8)

- Resolver cache: in-process, keyed by the **normalized hostname** only, bounded (default 1000 entries, oldest evicted), positive TTL 30 s, negative TTL 5 s. Case/port/trailing-dot variants share one entry; no forwarded value can reach a key; two stores cannot share an entry because the key is the host. For platform subdomains the returned slug is also checked against the label asked for; custom hosts rely on the database's exact match. Concurrent misses for one host share one directory call. Random-host floods can still evict good entries (memory stays bounded) and send lookups to the database; rate limiting is a hosting-level follow-up (THI-86). Outages are never cached.
- Staleness bound: releasing a domain, suspending a store or verifying a new domain takes effect within one TTL per server process (no cross-process invalidation yet).
- Responses: refusals and served pages are `Cache-Control: no-store` (the page is `force-dynamic`; asserted in the seeded e2e). A `Vary: Host` header could not be made to survive Next.js's own `Vary` handling on page responses, so the protection is `no-store`, and any shared cache or CDN in front must not cache storefront HTML across hosts (an edge requirement to settle in THI-86). Until tenant-aware page/data caching exists (THI-74), nothing tenant-specific is cached.
- `tenantCacheKey({storeId, scope, publicationVersion?, locale?, currency?})` is the required constructor for any future shared cache key: it requires a valid store id and is JSON-encoded so parts cannot collide.

## Not covered here

- Server Actions: Next.js compares `Origin` with `x-forwarded-host`/`Host` for CSRF. Mutations arrive with THI-66; it must configure `serverActions.allowedOrigins` and re-check the trusted-proxy assumptions (AC-6, AC-9).
- Cookies and sibling-subdomain isolation (AC-35): no cookies are issued yet. Shopper/admin cookies must be `__Host-` prefixed (host-only) and admin must live on a different registrable domain from store subdomains (THI-66, THI-89).
- TLS/certificates for custom domains, HSTS, rate limiting, abuse takedown (AC-36), DNS-rebind/dangling-record re-verification, and cross-process cache invalidation: not implemented; owned by THI-86 and later tickets.
- Store activation is not gated yet (THI-83): any `active` store with a verified host serves.
- Slug reuse: a store that renames its slug or is deleted frees `<slug>.<PLATFORM_DOMAIN>` for another tenant, who then inherits old links within one cache TTL. Retired-slug tracking or a slug-change policy is **not** implemented; decide it with merchant onboarding (THI-68) / activation (THI-83). Only the server can create organizations today, so no merchant can exploit this yet.
- The claim path (THI-68) must require `normalizeHostname(input) === input`; the database CHECK still accepts malformed punycode labels (they can never resolve).

## Verification

| Evidence | Where | Run |
| --- | --- | --- |
| Claims, uniqueness, resolution, access control, rollback | `supabase/tests/domains.test.ts`, `rls.test.ts` | `pnpm --filter @kerno/supabase test` (PGlite, in CI); `pnpm db:reset && pnpm test:db` (real local stack) |
| Normalization, spoofing, forwarded-host, trust policy | `packages/server/src/tenancy/{hostname,request-host}.test.ts` | `pnpm test` |
| Resolver, three stores, unknown/unverified hosts, cache poisoning, cross-store reuse, outage handling, directory fail-closed, DNS proof | `resolver.test.ts`, `cache.test.ts`, `supabase-directory.test.ts`, `verification.test.ts` | `pnpm test` |
| Real directory against PostgREST, grants and seed | `supabase-directory.integration.test.ts` | `pnpm db:reset`, then `KERNO_TEST_SUPABASE_URL=http://127.0.0.1:54321 KERNO_TEST_SUPABASE_ANON_KEY=<local anon key> pnpm --filter @kerno/server test` (runs in the Browser CI job) |
| One deployment serving the three seeded stores | `e2e/smoke.spec.ts` (apex/nested 404 in CI; seeded stores need `E2E_SEEDED_STORES=1`) | `pnpm db:reset`, then `E2E_SEEDED_STORES=1 E2E_SUPABASE_ANON_KEY=<local anon key> pnpm test:e2e` |

Local fixtures live in `supabase/seed.sql` (fake data, applied by `supabase db reset` only): `acme-sneakers.localhost:3001`, `acme-books.localhost:3001`, `acme-plants.localhost:3001`, a verified custom domain `shop.acme-sneakers.test`, a pending claim, plus draft and suspended stores that must never resolve. Browsers resolve `*.localhost` to loopback; for the custom domain send a `Host` header. `pnpm test:db` truncates tenant tables, so run `pnpm db:reset` afterwards to restore the seed.

CI (the `Browser (Playwright)` job) starts the local Supabase stack, runs `test:db`, resets with the seed, then runs the directory integration test and the seeded e2e; with `CI` / `KERNO_REQUIRE_STACK_TESTS` set they fail rather than skip when the stack variables are missing. That job has not run yet at the time of writing: check the PR's CI result. THI-67 owns the full three-store isolation proof.
