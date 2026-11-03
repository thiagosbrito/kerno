# KERNO

Multi-tenant, customizable e-commerce SaaS for merchants in Brazil and Poland. Merchants receive purchase proceeds through their own payment-provider accounts; KERNO earns subscriptions with 0% platform transaction commission.

## Repository status

Bootstrapped pnpm/Turborepo workspace: `apps/admin`, `apps/storefront`, `packages/contracts`, `packages/server`, `packages/ui`. There is no database migration, tenant model, authentication or deployment yet (see the [roadmap](docs/roadmap.md)). `packages/domain` and `supabase/` are created by the tickets that need them.

## Local development

Requires Node 24.16.x (`.nvmrc`) and pnpm 11.22.x (`packageManager`; use Corepack).

```sh
pnpm install --frozen-lockfile
pnpm setup:env  # writes apps/*/.env.local with placeholder values (never overwrites)
pnpm dev        # admin on :3000, storefront on :3001
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:bundles` (builds with sentinel secrets and fails if server-only names/values reach client bundles), `pnpm test:bundles:self` (unit-tests the bundle checker), `pnpm test:e2e` (Playwright on ports 3100/3101; run `pnpm exec playwright install chromium` once), `pnpm docs:check`, `pnpm scan:secrets`, `pnpm test:secrets:self`, `pnpm check:workflows`, `pnpm test:workflows:self`, `pnpm audit:deps`, `git diff --check` (locally this covers uncommitted changes only; CI checks committed changes against the base commit and also runs `git diff --exit-code`). CI otherwise runs the same commands; see [CI and branch protection](docs/steering/ci.md).

`.env.example` lists names only; `pnpm setup:env` fills non-secret placeholders for local use, and real Supabase values replace them once a local database exists. Apps fail closed on missing or malformed environment configuration (an `EnvError` page means `.env.local` is absent or invalid). The Supabase CLI and local database are not set up yet.

- [Agent entry point](AGENTS.md)
- [Roadmap and Linear tickets](docs/roadmap.md)
- [Architecture](docs/steering/architecture.md)
- [Security](docs/steering/security.md)
- [Testing](docs/steering/testing.md)
- [Workflow](docs/steering/workflow.md)
- [Decision register](docs/decisions/README.md)

Linear owns priorities, status, dependencies and acceptance criteria. This private repository owns source, implementation decisions and agent guidance. The planning source is the [KERNO project](https://linear.app/thiagosbrito/project/kerno-ef4b1e3f582c/overview); the user-managed Visual Blueprint v0.5 was not available during this bootstrap and must be reconciled before conflicting product details are implemented.

Documentation links are validated with `pnpm docs:check`.
