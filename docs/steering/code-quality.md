# Code quality steering

Enable strict TypeScript. Avoid unchecked casts, implicit any, non-null assertions and suppressed checks unless an explicit boundary invariant and explanation justify them. Validate runtime input with Zod at environment, HTTP/action, database JSON, template and provider boundaries. Types alone do not validate data.

Use stable identifiers, explicit money/currency and typed domain errors. Return safe user-facing errors while keeping redacted diagnostic context. Public responses must use deliberate field projections; never serialize database rows or provider credentials wholesale.

Keep domain functions deterministic. Isolate I/O and SDK adapters. Prefer small changes and cohesive modules over premature frameworks. Centralize authorization and money calculations; avoid copied business rules between client and server. Client validation improves feedback but cannot authorize writes.

Design loading, empty, error, stale, retry and success states. Use semantic controls, keyboard navigation, focus management, visible labels and accessible errors. Localize user-facing text and format money/dates by locale without changing canonical values.

Migrations are versioned and forward-compatible with deployed code. Review locks, backfills and tenant defaults; test on representative fixtures. Do not edit applied migrations or assume a destructive down migration is a safe rollback. Document expand/migrate/contract steps when relevant.

Bootstrap must define the actual lint/typecheck/build/test commands and pinned toolchain. Changes are complete only with relevant acceptance evidence and clean applicable checks; do not add tests that merely duplicate implementation.
