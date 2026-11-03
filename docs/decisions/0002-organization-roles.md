# 0002 · Organization roles matrix

- Status: **accepted** (owner approval in the THI-64 session, 2026-11-04). The `manager` role and its limits were directed by the owner. MFA policy, billing and payout roles, and the invitation flow stay open.
- Date: 2026-11-03
- Related: [THI-64](https://linear.app/thiagosbrito/issue/THI-64/model-tenants-memberships-and-deny-by-default-rls), THI-66, THI-68; open item "roles matrix" in the [decision register](README.md)

## Context

THI-64 needs roles to write RLS policies. The register lists the roles matrix as open, so this records the smallest set implemented and what remains undecided.

## Decision (proposal)

Four organization-level roles: `owner`, `admin`, `manager`, `staff`. Owners manage everything including roles and organization deletion; admins manage stores, managers and staff; managers run day-to-day operations (catalog, stock, orders; policies arrive with those tickets) but cannot edit store settings, public profiles or members; staff is read-only. Platform-only suspension. Full table and invariants: [tenancy and RLS](../security/tenancy-and-rls.md).

## Alternatives

Per-store roles (more granular, more policy surface); a separate billing role (depends on THI-83); custom role editing (out of scope for POC).

## Consequences

Later tickets add per-table policies for each role. Changing the enum or semantics needs a new migration and updated tests. Still open: MFA policy, billing/payout roles, invitation flow (THI-68), ownership-transfer UX.

## Verification and rollback

Role behavior is covered by `supabase/tests/rls.test.ts`. Reverting means a forward migration; see the rollback notes in the tenancy document.
