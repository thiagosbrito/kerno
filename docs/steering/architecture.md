# Architecture steering

## Approved baseline

Platform-hosted multi-tenant SaaS with a shared Next.js App Router storefront engine and Supabase PostgreSQL. Use pnpm/Turborepo, TypeScript, Tailwind v4, shadcn/ui with Base UI, Zod, Vitest and Playwright. Pin compatible versions during bootstrap; only Tailwind v4 is a recorded major-version choice. Start in one primary backend region. Regional data planes require evidence and a new decision.

Physical products first. Keep product and fulfillment contracts extensible without implementing unapproved future types. Stores choose a landing or catalog homepage. Support English, Brazilian Portuguese and Polish, and a chosen store currency of USD, BRL or PLN. Currency conversion, mixed-currency carts and automatic tax compliance are not implied.

## Proposed workspace boundaries (to confirm during bootstrap)

- apps/admin: merchant administration and visual editing.
- apps/storefront: shared host-routed public storefront.
- packages/contracts: Zod schemas and serializable public/domain contracts; no secrets or database clients.
- packages/ui: reusable accessible components; no tenant authorization decisions.
- packages/domain: commerce rules and state transitions independent of provider SDKs.
- packages/server: server-only tenant context, persistence and provider adapters.
- supabase: versioned migrations, seed fixtures and RLS integration tests.

Add scoped AGENTS.md files at these boundaries when they exist. Admin mutations require server membership/role checks; storefront reads expose only published public data; contracts validate every untrusted boundary; migrations include isolation and rollback evidence. Keep provider-specific shapes outside domain contracts.

## Runtime boundaries

Resolve normalized, verified hostnames to active stores at a trusted server boundary. Unknown hosts fail closed. Define trusted proxy handling explicitly. Carry authorized tenant context through persistence and include tenant, publication version and relevant locale/currency in cache keys. RLS must protect tenant rows even when APIs are called directly. Service-role usage bypasses RLS and requires narrow server-only access plus equivalent explicit authorization.

Drafts and published snapshots are separate. Preview access expires and must not populate public caches. Publish and rollback atomically to schema-compatible versions. Merchant content is allowlisted data rendered by trusted components; sanitize rich content and constrain URLs, sizes and depth.

Represent money exactly using documented integer minor units and explicit currency with bounded arithmetic. Define rounding once and verify totals. Model orders, inventory reservations, payment events, subscriptions and refunds with explicit allowed transitions and idempotency. A redirect or browser callback is never payment evidence. Handle retries, concurrency, expiry and reconciliation durably.

## Decisions still required

Hosting, provider selection, plan pricing/limits, roles matrix, inventory expiry, tax handling, shipping integrations, refund/restock policy, operational budgets and country launch requirements need issue-level decisions. Read the [decision register](../decisions/README.md); do not silently fill these gaps.
