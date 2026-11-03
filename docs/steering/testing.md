# Testing steering

No application test suite exists at bootstrap. Use the documentation validator now. The monorepo and CI tickets establish executable commands, clean environment setup and deterministic fixtures.

## Required layers

- Vitest unit tests: exact money/rounding, schema rejection, shipping precedence, entitlements and allowed/forbidden state transitions.
- Supabase integration tests: real migrations and RLS as anonymous, member, nonmember and privileged roles; storage policies; transaction concurrency and tenant-scoped uniqueness. Mocks cannot prove RLS.
- Provider contract tests: sandbox/raw signed fixtures for verification, account/amount/currency mismatch, replay, reordering, retries, timeouts, refunds and reconciliation. Never rely only on a success callback.
- Playwright: merchant authorization, three-store routing/isolation, catalog, draft/editor/publish/rollback, checkout failure/recovery and accessible keyboard paths. Include supported locale/currency combinations.

Every security-sensitive ticket includes positive and negative cases. Tenant fixtures must use at least two stores with overlapping-looking object identifiers and distinct memberships; the POC proves three stores. Assert that both reads and writes fail across tenants, including media, previews, exports and caches. Test expired/revoked sessions and denied direct requests, not just hidden UI controls.

Use controllable time and failure injection for reservation expiry, autosave, publish races and webhook processing. Verify final-unit concurrency, duplicate events and partial failure recovery. Keep secrets and real customer data out of fixtures. Run destructive tests only against disposable local/test databases.

Before release: agree performance/accessibility budgets, test noisy tenants and outages, rehearse restore/rollback and incident procedures, and attach ASVS evidence. Real-money smoke tests require all recorded gates. Describe coverage gaps plainly; passing unit tests is not payment or production readiness.
