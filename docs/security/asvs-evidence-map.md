# ASVS 5.0 L2 evidence map

Status: **proposed baseline** for THI-63. ASVS L2 is a target, not a certification (see [security steering](../steering/security.md)). Nothing here asserts a control exists; "Evidence" columns describe what must be produced. The final verification is THI-84.

Companion: [threat model](threat-model.md) (abuse cases `AC-n`, exclusions `X-n`).

## 1. How to use this map

- **Granularity.** The map is at ASVS 5.0 chapter level (V1–V17) with the abuse cases that drive each chapter. Individual requirement IDs (for example `V8.x.y`) were **not** transcribed because the official ASVS 5.0 text was not available to verify against during this ticket, and unverified IDs would be worse than none.
- **Next step (tracked, not done):** import the official L2 requirement list into a per-requirement table (`ID, applicability, control, owner ticket, test, evidence, status`) and fill it using the chapter rows below as the starting classification. This import is an M3 exit criterion (section 4). It has no owning Linear ticket yet: a ticket is needed, and creating one requires owner approval. Until it is imported no requirement-level coverage claim is made.
- **Status values:** `planned` (owner ticket exists), `gap` (no owner yet), `n/a` (excluded with rationale), `implemented` and `verified` (only with attached evidence). No other status is used.
- Every status below is `planned`, `gap` or `n/a`; none is `implemented` or `verified`, because no row has linked evidence yet. Existing M0 artifacts (`.github/workflows/ci.yml`, `scripts/check_workflows.py`, `scripts/check_bundles.py`, `scripts/scan_secrets.py`) are referenced in V13 and V15 as inputs, not as verified coverage. Where a row contains a part with no owner ticket, the cell says `planned` with the `gap` part named.

## 2. Chapter applicability and ownership

Evidence owner is the role accountable for producing and maintaining the evidence; it is a role, not a named person, until the owner decision is made. "Engineering" means the implementing contributor of the owner ticket; "Security reviewer" is the independent reviewer for THI-84.

| ASVS 5.0 chapter | Applies | Why / scope | Abuse cases | Implementation tickets | Release gate | Status |
| --- | --- | --- | --- | --- | --- | --- |
| V1 Encoding and Sanitization | Yes | Merchant content, rich text, URLs, product fields and storefront (M2), page JSON/theme/editor (M3). Transactional email templates: `gap` (no roadmap ticket owns transactional email) | AC-12 | THI-71, THI-72, THI-73, THI-74 | M2, M3 | planned (email: gap) |
| V2 Validation and Business Logic | Yes | Zod at every boundary; money, inventory, order state, publish integrity, limits, entitlements | AC-16, AC-18, AC-19, AC-20, AC-23, AC-24, AC-25, AC-27, AC-28 | THI-69, THI-72, THI-74, THI-75–THI-78, THI-79, THI-80, THI-81, THI-82, THI-83, THI-87 | M2, M3, M4, M5, M6 | planned |
| V3 Web Frontend Security | Yes | CSP, cookies (`__Host-` prefix), clickjacking, third-party scripts, storefront and admin, sibling-subdomain isolation. AC-36 (malicious content on KERNO-served domains) has no owner: `gap` | AC-6, AC-11, AC-12, AC-15, AC-35, AC-36 | THI-65, THI-66, THI-70, THI-71, THI-72, THI-73, THI-74, THI-81 | M1, M2, M3, M5, M6 | planned (AC-36: gap) |
| V4 API and Web Service | Yes | Server actions/route handlers, direct Supabase API, webhooks | AC-1, AC-2, AC-6, AC-22 | THI-64, THI-66, THI-81 | M1, M5 | planned |
| V5 File Handling | Yes | Product media uploads and delivery | AC-13, AC-14 | THI-70 | M2 | planned |
| V6 Authentication | Yes | Merchant (and any customer) sign-in, reset, MFA policy | AC-5, AC-7 | THI-66 | M1 | planned |
| V7 Session Management | Yes | Cookie sessions, expiry, rotation, revocation | AC-5, AC-6 | THI-66 | M1 | planned |
| V8 Authorization | Yes | RLS, memberships, roles, object-level checks, privileged paths (service-role, jobs, preview, webhooks) | AC-1, AC-2, AC-3, AC-4, AC-21 | THI-64, THI-66, THI-68, THI-70, THI-74, THI-78, THI-81 | M1, M2, M3, M4, M5 | planned |
| V9 Self-contained Tokens | Yes | Supabase sessions are JWTs: the server must verify them via verified-claims APIs, never trust unverified cookie data; RLS uses `auth.uid()`/`auth.jwt()`; custom claims can be stale until refresh. Signed preview/order tokens, if used, also apply | AC-1, AC-4, AC-15, AC-21 | THI-64, THI-66, THI-68, THI-74, THI-78 | M1, M2, M3, M4 | planned |
| V10 OAuth and OIDC | Conditional | Applies if merchant sign-in uses social/SSO or providers use OAuth connect (account connection); confirm usage | AC-26 | THI-66, THI-80 | M1, M5 | planned |
| V11 Cryptography | Yes | Encryption of merchant credentials at rest, key management, token randomness | AC-26 | THI-80, THI-86 | M5, M6 | planned |
| V12 Secure Communication | Yes | TLS, HSTS, host and certificate handling for custom domains; separate registrable domains and `__Host-` cookies | AC-9, AC-10, AC-35 | THI-65, THI-66, THI-70, THI-86 | M1, M2, M6 | planned |
| V13 Configuration | Yes | Secrets, environments, headers, dependency and build hardening. M0 artifacts as inputs: `.github/workflows/ci.yml`, `scripts/check_workflows.py`, `scripts/check_bundles.py`, `scripts/scan_secrets.py` | AC-29, AC-30, AC-33 | THI-61, THI-62, THI-64, THI-86 | M0, M1, M6 | planned |
| V14 Data Protection | Yes | PII classification, minimization, retention, caching, logs | AC-8, AC-31, AC-34 | THI-64, THI-65, THI-74, THI-81, THI-85, THI-86 | M1, M3, M5, M6 | planned |
| V15 Secure Coding and Architecture | Yes | Trust boundaries, dependency management, safe patterns, SSRF. M0 artifacts as inputs: `.github/workflows/ci.yml`, `scripts/check_workflows.py`, `scripts/scan_secrets.py`; continuous | AC-3, AC-17, AC-30 | THI-61, THI-62, plus every ticket | M0–M6 | planned |
| V16 Security Logging and Error Handling | Yes | Audit events, redaction, safe errors | AC-31, AC-32 | THI-65, THI-66, THI-68, THI-74, THI-80, THI-81, THI-82, THI-86 | M1, M2, M3, M5, M6 | planned |
| V17 WebRTC | No | No real-time media/WebRTC in approved scope | none | none | none | n/a |

### Recorded exclusion

| Item | Rationale | Review trigger |
| --- | --- | --- |
| V17 WebRTC (entire chapter) | No WebRTC feature is planned or approved; it adds no attack surface in the current scope | Any real-time media/chat/video feature proposal |

V10 is not excluded; it is conditional. Whoever delivers THI-66 and THI-80 records in the ticket whether the chapter applies and either maps it or converts it to a justified exclusion here. V9 applies because Supabase-managed sessions are JWTs.

Level-3-only requirements are outside the target and need no per-requirement exclusion entry. Per-requirement exclusions inside L2 chapters will be added to the requirement-level table with rationale and an expiry or review trigger. Compensating controls must name the specific requirement and the test that proves the compensation.

## 3. Evidence expected per control family

"Evidence" means artifacts a reviewer can inspect without trusting the author: a test name and CI run, a migration and its RLS test, a configuration file, a captured negative-test output, or a dated review record. A passing unit test alone is not evidence for RLS, payment or production readiness (see [testing](../steering/testing.md)).

| Control family | Minimum evidence | Produced by | Evidence owner |
| --- | --- | --- | --- |
| Tenant isolation / RLS (AC-1, AC-3, AC-14) | Migrations with policies; Supabase integration tests as anon/member/nonmember/privileged on ≥2 stores; storage policy tests | THI-64, THI-66, THI-67, THI-70, THI-74, THI-81 | Engineering (tenancy) |
| Authentication, session, CSRF (AC-5, AC-6, AC-7) | Session lifecycle tests; cookie-attribute assertions; rate-limit tests | THI-66 | Engineering (auth) |
| Authorization and roles (AC-2, AC-4) | Role-matrix test table by UI and direct API; revoked-membership test | THI-66, THI-68 | Engineering (auth) |
| Host routing and domains (AC-9, AC-10, AC-35) | Spoofed-header corpus; DNS-ownership test; fail-closed test; domain-separation config and `__Host-` cookie assertions | THI-65, THI-66, THI-70 | Engineering (routing) |
| Caching, preview and publishing (AC-8, AC-15, AC-16, AC-18) | Two-store cache fixture; preview expiry/cross-tenant negatives; publish race test; payload limit and quota tests | THI-65, THI-72, THI-74, THI-87 | Engineering (content) |
| Redirects (AC-11) | Redirect allowlist negatives (external, protocol-relative) | THI-66, THI-81 | Engineering (auth) |
| Output safety (AC-12) | Payload corpus results across storefront, renderer, editor, admin; CSP config; sanitizer tests. Transactional email: `gap` | THI-71, THI-72, THI-73, THI-74 | Engineering (content) |
| Uploads and media (AC-13, AC-14) | Type/size/traversal negatives; signed-URL expiry; tenant-prefix tests | THI-70 | Engineering (media) |
| Outbound requests (AC-17) | SSRF corpus per fetch site; allowlist config | Each ticket adding a fetch (THI-65, THI-70, THI-80) | Ticket implementer; reviewed by Security reviewer |
| Commerce integrity (AC-19–AC-21) | Money/rounding unit tests; concurrency tests; IDOR negatives | THI-69, THI-75–THI-78 | Engineering (commerce) |
| Payments and webhooks (AC-22–AC-26, AC-28) | Raw signed fixtures; replay, reorder, mismatch, reconciliation tests; credential non-disclosure scan | THI-79–THI-82 | Engineering (payments) |
| Billing and entitlements (AC-27) | Entitlement matrix; replayed-event test; downgrade test | THI-83 | Engineering (billing) |
| Secrets and supply chain (AC-29, AC-30) | CI run logs for scans and validators; bundle check output; lockfile policy | THI-62, THI-64, ongoing | Engineering (platform) |
| Logging, audit, privacy (AC-31, AC-32, AC-34) | Redaction fixtures; audit event tests; data inventory | THI-65, THI-66, THI-68, THI-74, THI-80, THI-81, THI-82, THI-85, THI-86 | Engineering + legal reviewer |
| Operations (AC-33) | Restore rehearsal record; environment separation proof; rotation runbook | THI-86 | Operations owner (TBD) |

Evidence owners that depend on unmade decisions (operations owner, legal reviewer, incident owner) are `TBD` and flagged in the [decision register](../decisions/README.md). A `TBD` owner at a gate blocks that gate.

## 4. Release gates

Security is a condition of every milestone. A milestone exits only when its rows below have attached evidence and the earlier rows still hold. Gates are cumulative.

| Milestone | Security exit criteria (evidence required) | Abuse cases covered |
| --- | --- | --- |
| M0 Repository & Agent Foundation | Threat model and this map reviewed and merged (this ticket); CI quality, dependency and secret checks pass (THI-62); no secrets or service-role identifiers in client bundles | AC-29, AC-30 |
| M1 Multi-tenant PoC | Three-store isolation proven end to end (THI-67): RLS suite plus Playwright, including RLS-bypass checks (`SECURITY DEFINER`, views without `security_invoker`, `user_metadata` policies, exposed tables without RLS, storage list) and stale-claim denial; host-routing negatives; auth, session, CSRF and role negatives; cache-key isolation; audit events for sensitive actions; hosting-independent trusted-proxy policy (ignore forwarded headers unless from an explicitly configured trusted proxy; fail closed when unconfigured), revisited when the hosting decision lands (THI-86); registrable-domain separation and `__Host-` cookies (or documented justification); SSRF corpus for each outbound-fetch site in this milestone | AC-1–AC-11, AC-17, AC-29, AC-32, AC-35 |
| M2 Admin & Catalog | Role matrix enforced and tested; media upload and storage-policy negatives; schema validation at boundaries; no private data in public projections; stored-XSS corpus on product fields and catalog storefront; privileged-path re-checks (media); audit events for role changes; SSRF corpus for each outbound-fetch site in this milestone | AC-3, AC-4, AC-12 (product fields, storefront), AC-13, AC-14, AC-17, AC-19 (contracts), AC-32, AC-35 (media origin) |
| M3 Builder & Publishing | Stored-XSS corpus passes across page JSON, theme, renderer and editor; CSP in place; preview isolation and expiry; cache keys include publication version; privileged preview-path re-checks; atomic publish/rollback race tests; payload size/depth limits; audit events for publish; per-requirement ASVS L2 table imported (needs a Linear ticket; creating one requires owner approval) | AC-3, AC-8, AC-12 (page JSON, theme, editor), AC-15, AC-16, AC-18, AC-32 |
| M4 Commerce | Server-authoritative totals; final-unit concurrency; IDOR negatives on orders; state-transition table tests | AC-19, AC-20, AC-21 |
| M5 Payments & Billing | Provider contract tests (signature, replay, reorder, mismatch, reconciliation); credential encryption and non-disclosure; provider raw-payload redaction; open-redirect negatives on return URLs; webhook privileged-path re-checks; entitlement tests; invariant: merchant-owned destination and no platform fee/commission field on any provider call; audit events for credential and refund actions; SSRF corpus for each outbound-fetch site in this milestone | AC-3, AC-11, AC-17, AC-22–AC-28, AC-31, AC-32 |
| M6 Secure Beta | THI-84 requirement-level L2 verification with findings remediated or accepted by the owner in writing; restore rehearsal; incident procedures; privacy and market review; owner sign-off before any real-money test; AC-36 resolved or explicitly accepted | all, AC-31, AC-33, AC-34, AC-36 |

## 5. Unowned items (gaps to resolve)

| Gap | Needed by | Action |
| --- | --- | --- |
| Per-requirement L2 table not yet imported; no owning Linear ticket (`gap`) | M3 exit; complete by THI-84 | A Linear ticket is needed (creating one requires owner approval). Import official ASVS 5.0 L2 list; classify using section 2 |
| Transactional email: no roadmap ticket owns it, so AC-12 email testing has no owner (`gap`) | Before any email is sent | Owner decision: add a ticket or record email as out of scope |
| AC-36 abuse and takedown for malicious content on KERNO-served domains: no owner (`gap`, open decision) | M6 | Owner decision on abuse reporting, takedown and domain-reputation process; record in decision register |
| Evidence owner names for operations, legal and incident response | M6 | Owner decision, record in decision register |
| Roles matrix and MFA policy | THI-66 / THI-68 | Decision required before authorization tests are finalized |
| Rate-limit and quota numbers, and failure behavior (fail open vs. closed) | THI-66, THI-87 | Decide per endpoint class; record in ADR |
| Trusted-proxy policy and hosting topology | M1 (policy), THI-86 (topology) | M1 uses a hosting-independent policy: ignore forwarded headers unless from an explicitly configured trusted proxy; fail closed when unconfigured. Revisit when the hosting decision lands (THI-86) |
| API Top 10 mapping | M3 onward | Add an API Top 10 column once endpoints exist (security steering lists it as applicable) |

## 6. Maintenance

- A ticket that changes a control, adds a boundary, or closes a gap updates the relevant row in the same change and links its evidence.
- Do not mark `implemented` or `verified` without a linked artifact. Do not delete a row to remove a gap; convert it to `n/a` with rationale.
- Re-run the documentation validator (`python3 scripts/validate_docs.py`) after edits.
