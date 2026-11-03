# 0004 · Tenant isolation model: pooled now, silo-ready

- Status: **accepted** (owner approval in the THI-64 session, 2026-11-04) as the current baseline: a shared database, no per-client isolation for now. Dedicated environments are **deferred**: they happen only if a real need appears (see "Revisit when"). The six keeping-it-cheap rules stay as lightweight guardrails.
- Date: 2026-11-04
- Related: [THI-64](https://linear.app/thiagosbrito/issue/THI-64/model-tenants-memberships-and-deny-by-default-rls), [THI-89](https://linear.app/thiagosbrito/issue/THI-89/implement-passwordless-shopper-accounts-with-per-store-isolation), [ADR 0003](0003-shopper-identity.md), [tenancy and RLS](../security/tenancy-and-rls.md)

## Context

Sharing one database puts every tenant's data behind one set of controls (RLS plus server checks). Isolated environments per client (Next.js, database, assets) shrink the blast radius of data-layer failures, but a shared engine that can reach every environment still holds every credential, and silo adds fleet operations (migrations across environments, per-tenant monitoring, backups), a provisioner and at least roughly $10 per merchant per month for a dedicated database project (Supabase pricing at the time of writing; verify). Plan prices are not decided. The owner floated, as an unvalidated idea only (2026-11-04), a first paid tier of around USD 69.99 per month with pricier tiers above it, and still has to work out costs and margins. If that were the price, roughly USD 10 to 15 per month for a dedicated database project would be about 14 to 21 percent of first-tier revenue (provider prices unverified), which is the kind of check the real margin analysis should repeat. For now the project is a concept run by one person. Research and cost notes are in the THI-64 session summary.

## Alternatives

- Full silo per client from the start: strongest isolation; highest cost and operations; changes M1, THI-65 to THI-67.
- Pooled with hardening (chosen for now).
- Hybrid: pooled by default, dedicated environment as a paid tier (the likely end state if demand appears).

## Decision

Keep the approved baseline: one platform-hosted engine, a shared database, RLS plus server authorization. Keep the move to dedicated environments cheap by following these rules:

1. Every tenant table carries `organization_id` or `store_id` (enforced by `supabase/tests/rls.test.ts`).
2. No cross-tenant queries or joins outside narrow control-plane adapters.
3. All database access goes through one tenant-binding resolver (verified host, then store, then connection) in `packages/server`; no other module creates database clients.
4. Assets are keyed `stores/{store_id}/...`.
5. Identifiers are UUIDs; per-store counters (such as order numbers) are never global sequences.
6. Client registry, billing and operator data stay out of tenant tables so they can move to a separate control-plane repository and database.

Hardening backlog, to schedule with the tickets that need it: a separate database role per tenant without `BYPASSRLS`; per-tenant envelope encryption for merchant payment-provider credentials; minimal shopper personal data.

## Consequences

Cheapest path for M1 and no change to the roadmap. A breach of the shared engine or database reaches all tenants until the hardening items land. Moving a merchant to a dedicated environment is a scripted export and import (rows by store key, same migration version, repoint the binding, move the asset prefix, re-create auth users and invalidate sessions, short read-only cutover). The effort stays small only if rules 1 to 6 hold; every violation adds refactoring.

## Revisit when

A merchant requires or will pay for dedicated isolation; plan prices are set; a security incident or audit finding; per-merchant revenue clearly covers a dedicated environment; or fleet tooling exists. Evidence to gather first: a one-day spike that provisions a full environment for one client and measures idle cost, provisioning time and whether Next.js runs per tenant.

## Verification and rollback

Rules 1 is tested; the others are reviewed per ticket. Nothing here changes code behavior, so there is nothing to roll back; reverting means editing this record.
