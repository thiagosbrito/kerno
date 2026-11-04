# Three-store tenant isolation POC (THI-67)

Result of the M1 proof: one platform deployment, one database, three differently configured active stores (plus a draft and a suspended store that must never resolve). This records what was exercised, the outcome and the limits. It is local evidence, not a certification, a performance claim or production readiness.

## Fixtures

`supabase/seed.sql` creates three organizations and stores with similar-looking identifiers (differing only in the last hex digit):

| Host | Store | Locale | Currency | Homepage |
| --- | --- | --- | --- | --- |
| `acme-sneakers.localhost` (also verified `shop.acme-sneakers.test`) | Acme Sneakers | en | USD | catalog |
| `acme-books.localhost` (custom domain pending, unverified) | Acme Livros | pt-BR | BRL | landing |
| `acme-plants.localhost` | Acme Rośliny | pl | PLN | landing |

## Visual evidence

Captured by `e2e/three-store-isolation.spec.ts` with `E2E_EVIDENCE=1` against the local Supabase stack. Each page is the same storefront build, selected only by hostname.

![Acme Sneakers](../evidence/thi-67/acme-sneakers.png)
![Acme Livros](../evidence/thi-67/acme-books.png)
![Acme Rośliny](../evidence/thi-67/acme-plants.png)

## What was exercised

| Area | Test | Layer |
| --- | --- | --- |
| RLS, reads | 3x3 matrix: every ordered pair of tenants, owner and staff, by id and by scan, across organizations, stores, memberships, domains, audit events and draft profiles | `supabase/tests/three-store-isolation.test.ts` (real migrations in PGlite; also runnable against the local stack with `pnpm test:db`) |
| RLS, writes | Every ordered pair: update, delete, forged tenant id on insert, re-parenting, server-only functions (`add_member`, `claim_domain`), and the victim's data unchanged | same |
| Anonymous surface | Only the three active public profiles, no private columns, hosts and slugs resolve to their own store, suspending one tenant leaves the others, tenant tables denied | same |
| Server authorization | Three-organization matrix on the member routes (every owner denied on every other organization, nothing written, own organization still works); forged bodies, revocation, CSRF with real GoTrue sessions (two tenants) | `packages/server/src/auth/member-routes.test.ts`, `e2e/merchant-auth.spec.ts` |
| Cache keys | Three stores give pairwise distinct keys for identical scope/version/locale/currency; separator forgery and path-like ids are rejected | `packages/server/src/tenancy/three-store.test.ts`, `cache.test.ts` |
| Concurrent requests | 300 interleaved resolutions with random latency (cold and warm caches) and 90 interleaved HTTP requests: every response contains only its own store, none is publicly cacheable on the dev server, see Limitations | `three-store.test.ts`, `e2e/three-store-isolation.spec.ts` |
| Host/path/header tricks | Query, path, traversal, `X-Forwarded-Host`, `Forwarded` and `X-Tenant-Id` never select another tenant | `e2e/three-store-isolation.spec.ts` |
| Media paths | No storage bucket or policy exists in any migration, the seed or `config.toml` (tripwire, handles quoted names); a public file is served on an active host (control) and the file and image optimizer get the proxy's own 404 on unknown, draft and suspended hosts | migration scan test; e2e |

CI runs all of these: the PGlite suites and server tests in the `quality` job (`pnpm test`), the seeded three-store and merchant e2e against a real Supabase stack in the `e2e` job.

## Results

Local run on the date of this change: database suite, server suite and 21 Playwright tests passed against the local Supabase stack. CI results are recorded on the pull request, not here.

## Limitations

- **Content is thin.** A store's public profile (name, locale, currency, homepage mode) is the only per-store content. Pages, themes, catalog and publication versions arrive in M2/M3; cache keys already carry publication version, locale and currency but no cache consumes them yet.
- **Media is unproven.** No upload or delivery exists (THI-70). The media test only proves nothing is exposed today and must be replaced by per-tenant object-path policy tests across all three tenants.
- **Database concurrency is not exercised.** The in-process harness uses one connection, so true concurrent transactions (last-owner races, domain-claim races) are covered only by single-statement constraints and the existing sequential tests. Concurrency is proven at the resolver and HTTP layers only.
- **Server authorization at three tenants** is proven at the route-handler level with a fake member store plus the three-tenant RLS matrix; the browser e2e with real sessions still uses two organizations.
- **Locale is not applied to the UI.** `lang` is set per store but no translated strings exist (THI-71).
- **Dev server only.** The browser suite runs against `next dev`, which never caches pages, so the "not publicly cacheable" assertion cannot detect a page that production would statically cache or share between hosts. A production-server (`next build && next start`) run of this spec is still needed. Until then dynamic rendering rests on `force-dynamic`, `headers()` use and the `no-store` profile fetch.
- **Single process, single region, local stack.** Per-process host cache means suspension takes effect within one TTL (30 s positive, 5 s negative). No load, noisy-tenant, CDN or custom-domain TLS testing was done.
- Shopper accounts, previews, exports and payments are out of scope (THI-89, THI-74, M4, M5) and unproven.
