# Tenancy model, roles and RLS (THI-64)

Status: implemented in `supabase/migrations/20261103210000_tenancy_core.sql` and tested by `supabase/tests`. Roles follow [ADR 0002](../decisions/0002-organization-roles.md) (accepted). Related abuse cases: AC-1, AC-3, AC-4, AC-29 in the [threat model](threat-model.md); chapters V4, V8, V14 in the [ASVS evidence map](asvs-evidence-map.md).

## Model

- `organizations` are the tenant. `memberships(organization_id, user_id, role)` link `auth.users` to an organization. A user may belong to many organizations.
- `stores` belong to one organization and are **merchant-private** (slug, internal name, status, contact email, internal notes). Anonymous visitors cannot read this table.
- `store_public_profiles` is the **public projection** (display name, locale, currency, homepage mode). It is readable by anyone only while the store is `active`; members also see their drafts. Add a column there only if it is safe for anyone to read. New columns on `stores` are private by default.
- Authorization derives from **current membership rows**, never from JWT custom claims or `user_metadata`, so a revoked member loses access on the next query even with a valid token.

## Roles

Hierarchy: owner > admin > manager > staff. A role can manage only the roles below it (owner manages all).

| Action | owner | admin | manager | staff |
| --- | --- | --- | --- | --- |
| Read organization, stores, public profiles, members | yes | yes | yes | yes |
| Rename or delete organization | yes | no | no | no |
| Create/update stores and public profiles | yes | yes | no | no |
| Delete store | yes | no | no | no |
| Catalog, stock, orders (policies added by later tickets) | yes | yes | yes | read only |
| Add member | any role | `manager`, `staff` | no | no |
| Change role / remove member | any member | `manager`, `staff` rows; new role must be `manager` or `staff` | no | no |
| Leave the organization | yes (not last owner) | yes | yes | yes |
| Suspend a store or lift a suspension | platform only | platform only | platform only | platform only |

Managers handle day-to-day operations (catalog, stock, orders) but not store configuration, members, payment accounts or billing. This migration grants managers read access only; the catalog, inventory and order tickets add their write policies per table. Staff is read-only for now. Owners cannot be removed or demoted by admins.

## Transitions and invariants

- **Create organization:** only through `public.create_organization(name, owner_user_id)`, executable by `service_role` alone. API roles cannot call it, because shoppers will also be authenticated users. The trusted server (onboarding, THI-68) verifies the session and passes the owner explicitly. Direct inserts into `organizations` are denied.
- **Add/change/remove member:** per the table above; enforced by RLS `WITH CHECK`/`USING` plus column grants (only `role` is updatable; `organization_id` and `user_id` are immutable). Adding requires an existing `auth.users` row; invitation flows belong to THI-68.
- **Last owner:** a trigger rejects demoting or removing the last owner (it locks the organization row so concurrent changes serialize). Deleting the organization cascades. Deleting the last owner's auth user is rejected until ownership is transferred or the organization is deleted.
- **Suspension:** a trigger lets only a caller without an end-user subject (service role, migrations) set or lift `suspended`.
- `created_by` on memberships is stamped from the session and cannot be forged.

## Forged tenant IDs and direct API access

`organization_id` and ids are not writable after creation (column-level `UPDATE` grants), inserts must satisfy a role check on the submitted organization, and reads/updates/deletes are filtered by membership. Anonymous and non-member requests get permission errors (writes/privileged reads) or zero rows. Default privileges for `anon`/`authenticated` on new `public` tables, sequences and functions are revoked, so a future table is inaccessible until a migration grants and polices it.

## Service role

`service_role` keeps Supabase's `BYPASSRLS`, so it ignores every policy above. It must stay server-only: `SUPABASE_SERVICE_ROLE_KEY` is parsed only by the server schema in `@kerno/contracts`, `pnpm test:bundles` fails if the name or value reaches a client bundle, and `supabase/tests/service-role-boundary.test.ts` fails if client-reachable source references it. Any server code using it must perform an equivalent explicit authorization check (AC-3); no such code exists yet.

## `SECURITY DEFINER` inventory

`private.is_org_member`, `private.has_org_role`, `private.store_is_active` (policy helpers; avoid RLS recursion; read only the caller's own membership or public activity), and `private.protect_last_owner` (needs to see all owners). `public.create_organization` is `SECURITY INVOKER` and service-role-only. All definer functions set `search_path = ''`; the test suite pins this exact list.

## Verification

The same suite (`supabase/tests`) runs in two modes:

- `pnpm --filter @kerno/supabase test` (also part of `pnpm test` and CI): replays the migration on an empty PostgreSQL in-process (PGlite) with a Supabase-compatible stand-in for roles, `auth.users` and `auth.uid()`. Needs no Docker.
- `pnpm db:start`, `pnpm db:reset`, then `pnpm test:db`: runs it against the real local Supabase stack (Docker, Supabase CLI pinned in the root `package.json`, `supabase/config.toml`). `db:reset` recreates the database and applies `supabase/migrations`. The suite refuses non-local database URLs because it truncates tenant tables.

It exercises anonymous, member, non-member and service contexts across two organizations with overlapping-looking ids: cross-tenant reads, updates, deletes and inserts with forged ids; forged claims/`user_metadata`; revoked membership with a live token; role transitions; last-owner protection; suspension; catalog checks (RLS on every table, no views without `security_invoker`, definer allowlist, grants for `anon` and API roles, deny-by-default for tables created later); and a manual rollback followed by a second replay.

Limitations: the real-stack run uses direct SQL with `SET ROLE` and JWT claims, not PostgREST/GoTrue over HTTP, so the HTTP layer is not exercised. Concurrent-transaction races (two owners demoting each other) are not tested; the row lock is by design only. CI runs the PGlite mode only; a Supabase-stack CI job is a follow-up. Storage policies do not exist yet (THI-70).

## Rollback

The migration is forward-only. `supabase/rollbacks/20261103210000_tenancy_core.down.sql` drops everything it created and **destroys tenant data**; use it only before real tenants exist. Afterwards, roll forward with a new migration (expand, migrate, contract).
