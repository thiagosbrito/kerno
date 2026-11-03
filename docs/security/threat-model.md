# KERNO threat model

Status: **proposed baseline** for THI-63. It is a design-time analysis of a platform whose controls are not yet implemented. No control below is claimed to exist until the owning ticket ships it with evidence. Re-review at each milestone gate and when a provider, hosting or roles decision lands (see the [decision register](../decisions/README.md)).

Related: [ASVS evidence map](asvs-evidence-map.md), [security steering](../steering/security.md), [architecture](../steering/architecture.md), [testing](../steering/testing.md).

## 1. Scope and method

In scope: the shared storefront engine, merchant admin, Supabase (Postgres, Auth, Storage), host routing, media uploads, draft/publish pipeline, cart/checkout/orders, merchant-owned payment providers, KERNO subscription billing, CI/supply chain and operations.

Method: STRIDE per trust boundary and data flow, then abuse cases ranked by impact (tenant breach and money movement highest). Likelihood and impact are qualitative (H/M/L) until real telemetry exists.

Out of scope here: provider-specific analysis (done in THI-79 once providers are chosen), legal/tax/privacy conclusions (qualified review, THI-85), hosting and network design (THI-86).

## 2. Assets

| ID | Asset | Why it matters | Classification |
| --- | --- | --- | --- |
| A1 | Tenant isolation (store data boundary) | Core multi-tenant promise; one breach exposes every merchant | Critical |
| A2 | Merchant credentials, sessions, MFA state | Account takeover controls a store and its payouts | Critical |
| A3 | Merchant payment-provider credentials/connection tokens | Direct access to merchant proceeds | Critical |
| A4 | Supabase service-role key and other platform secrets | Bypasses RLS | Critical |
| A5 | Orders, payment events, refunds, inventory | Financial integrity and fulfillment | High |
| A6 | Customer PII (names, addresses, email, phone) | Privacy law exposure (GDPR/LGPD) | High |
| A7 | Published storefront content and domain mappings | Defacement, phishing, SEO abuse | High |
| A8 | Drafts, previews, unpublished catalog | Confidentiality of unreleased content | Medium |
| A9 | KERNO subscription/entitlement state | Revenue integrity, plan-limit enforcement | High |
| A10 | Uploaded media and storage objects | Malware hosting, XSS, cost abuse | Medium |
| A11 | Audit logs and telemetry | Forensics; must not leak secrets/PII | Medium |
| A12 | Source, CI pipeline, dependencies, lockfile | Supply-chain compromise reaches all tenants | Critical |

## 3. Adversaries

| ID | Adversary | Capability | Goal |
| --- | --- | --- | --- |
| T1 | Anonymous internet user | Crafted HTTP requests, forged Host headers, scripted abuse | Reach private data, abuse checkout, DoS |
| T2 | Malicious shopper | Valid cart/checkout flows, replay, tampering | Underpay, over-claim stock, steal other orders |
| T3 | Malicious merchant (tenant) | Authenticated admin, own store config, content, uploads, domains | Read/modify other tenants, escalate, host malicious content |
| T4 | Compromised or malicious merchant staff | Lower-role membership | Escalate to owner/billing/payout powers |
| T5 | Network/webhook forger | Can POST to webhook endpoints, replay captured events | Fake paid/refunded state, replay old events |
| T6 | Compromised dependency or CI actor | Malicious package, PR from fork, workflow injection | Exfiltrate secrets, ship backdoor |
| T7 | Insider / over-privileged operator | Dashboard, DB or log access | Data exposure, unaudited changes |
| T8 | Third-party provider failure or compromise | Delayed, reordered, duplicate or wrong-account events | Inconsistent financial state |

## 4. Trust boundaries

```text
[Browser: shopper / merchant]            untrusted
        │  TB1 (internet edge: TLS, Host, forwarded headers)
        ▼
[Edge/proxy] ──► [Next.js storefront + admin (server)]   trusted, holds tenant context
                    │  TB2 (tenant context + authz)        │ TB4 (outbound: fetch, redirects)
                    ▼                                      ▼
        [Supabase Postgres + RLS]   TB3        [External: payment providers, billing provider,
        [Supabase Storage]                      image/URL fetches, DNS/domain verification]
                    ▲
                    │ TB5 (service-role, server-only adapters)
        [Webhook receivers] ◄── TB6 (provider → KERNO, signed) ── [Provider]
        [CI / build / deploy]  TB7 (untrusted PR code vs. secrets)
```

| ID | Boundary | Rule |
| --- | --- | --- |
| TB1 | Internet → edge/app | Host and forwarded headers are untrusted until the trusted-proxy policy normalizes them; unknown hosts fail closed. |
| TB2 | Request → tenant context | Tenant is derived from verified host (storefront) or verified session + current membership (admin), never from submitted IDs. |
| TB3 | App → database/storage | RLS and storage policies enforce tenancy independently of the app; direct API calls must also be denied. |
| TB4 | App → outbound network | Any server-side fetch of a user-influenced URL is an SSRF boundary; allowlist and block internal ranges. |
| TB5 | Server code → service-role | Service-role bypasses RLS; confined to narrow server-only adapters with explicit equivalent authorization. |
| TB6 | Provider → webhook | Authenticity (signature over raw bytes), account/tenant binding, amount/currency and replay protection before any state change. |
| TB7 | Untrusted code → secrets | Fork/PR jobs have no production secrets; dependencies are pinned and scanned. |
| TB8 | Merchant content → renderer | Merchant data is allowlisted and rendered by trusted components; no merchant-executed code. |

## 5. Data flows

| ID | Flow | Boundaries | Key data |
| --- | --- | --- | --- |
| F1 | Shopper requests storefront page | TB1, TB2, TB3 | Host, locale, published snapshot |
| F2 | Merchant signs in and administers store | TB1, TB2, TB3 | Session, membership, role |
| F3 | Merchant uploads media | TB1, TB2, TB3 | File bytes, metadata, storage path |
| F4 | Draft edit → preview → publish/rollback | TB2, TB3, TB8 | Draft JSON, version, preview token |
| F5 | Merchant connects custom domain | TB1, TB4 | Hostname, verification proof |
| F6 | Shopper cart → quote → hosted checkout | TB1, TB2, TB6 | Cart, server prices, redirect |
| F7 | Provider webhook → order/payment state | TB6, TB5, TB3 | Signed event, order ID |
| F8 | Refund/dispute/reconciliation | TB4, TB6, TB3 | Provider refs, amounts |
| F9 | Merchant connects payment account | TB2, TB4, TB5 | OAuth/connect tokens (encrypted) |
| F10 | KERNO subscription billing and entitlements | TB6, TB2 | Subscription events, plan limits |
| F11 | Build, dependency update, deploy | TB7 | Source, lockfile, CI secrets |

## 6. Threats and abuse cases

Each abuse case lists the required negative test. IDs (`AC-n`) are referenced by the [evidence map](asvs-evidence-map.md). "Owner" is the Linear ticket that must deliver the control and test; "Gate" is the earliest milestone exit that cannot pass without it.

### 6.1 Tenant and authentication

| ID | Abuse case | Adv. | Impact | Control summary | Required failure test | Owner / Gate |
| --- | --- | --- | --- | --- | --- | --- |
| AC-1 | **Cross-tenant read/write via direct Supabase API** with a valid session for tenant A, targeting tenant B rows, including overlapping-looking IDs | T3 | H | RLS on every tenant table, keyed on current membership, not on JWT custom claims (can be stale until refresh) or user-editable `user_metadata`/`raw_user_meta_data`. No RLS bypass paths: `SECURITY DEFINER` functions reviewed, views use `security_invoker`, no exposed-schema table without RLS, storage policies deny cross-tenant list | RLS suite as anon/member/nonmember/privileged across ≥2 stores; reads and writes both denied. Catalog checks flag exposed-schema tables without RLS, views without `security_invoker` and unreviewed `SECURITY DEFINER` functions; editing own `user_metadata` grants nothing; cross-tenant storage list denied; membership removal denied despite a still-valid token | THI-64 / M1 |
| AC-2 | **Client-supplied tenant ID** (body, header, query, hidden field) overrides tenant | T3, T1 | H | Tenant from host or session+membership only; submitted IDs ignored/validated against context | Request with tenant B ID under tenant A session returns 403/404 and writes nothing | THI-66 / M1 |
| AC-3 | **Confused deputy**: privileged server code (service-role, background job, webhook handler, preview/export worker) acts for a caller without re-checking that caller's rights on the target object | T3, T5 | H | Service-role confined to adapters; every call carries an authorized tenant context and re-checks object ownership | Tenant A user invokes an action/job referencing tenant B object ID; service-role path rejects it; static check that service-role import is server-only | THI-64, THI-66 / M1; THI-70 / M2; THI-74 / M3; THI-81 / M5 (and each ticket adding a privileged path) |
| AC-4 | **Privilege escalation**: staff promotes self, edits owner, changes billing/payout, or acts after role downgrade/removal | T4 | H | Roles read from current membership per request, never from JWT custom claims or `user_metadata` (claims can be stale until refresh); role-change requires higher role; last-owner protection; no `SECURITY DEFINER` function or view without `security_invoker` that skips role checks | Lower-role user attempts each privileged action by UI and direct call; revoked member's live session denied on next request | THI-66, THI-68 / M1, M2 |
| AC-5 | **Session theft/fixation, stale or revoked session** reuse | T1, T3 | H | Verified sessions, expiry, rotation, revocation on credential change, secure cookie flags | Expired/revoked/rotated session denied; cookie attributes asserted | THI-66 / M1 |
| AC-6 | **CSRF** on cookie-authenticated admin mutation | T1 | M | Origin/CSRF check on all mutations (origin checks depend on AC-9: a spoofed forwarded host weakens them) | Cross-origin and missing-origin mutation rejected | THI-66 / M1 |
| AC-7 | **Account takeover** via credential stuffing, weak reset, missing MFA for owners | T1 | H | Rate limits, safe reset flow, MFA policy (decision required) | Lockout/rate-limit behavior; reset token single-use and expiring | THI-66 / M1 |
| AC-8 | **Cache poisoning/leak**: private or other-tenant data served from a shared cache; key lacks tenant/version/locale/currency | T1, T3 | H | Cache keys include tenant, publication version, locale, currency; no private data in shared cache | Two-store fixture: request store A then B on same path/locale; no bleed; preview never cached publicly | THI-65, THI-74 / M1, M3 |

### 6.2 Host routing and domains

| ID | Abuse case | Adv. | Impact | Control summary | Required failure test | Owner / Gate |
| --- | --- | --- | --- | --- | --- | --- |
| AC-9 | **Host header injection / spoofed X-Forwarded-Host** to reach another store or poison links | T1 | H | Hosting-independent trusted-proxy policy for M1: ignore forwarded headers unless from an explicitly configured trusted proxy; fail closed when unconfigured; revisited when the hosting decision lands (THI-86). Normalize and verify hostnames; unknown host fails closed | Spoofed Host/forwarded-host/port/case/trailing-dot variants resolve to no store or the correct one; forwarded headers ignored when no trusted proxy is configured | THI-65 / M1 |
| AC-10 | **Domain takeover / unverified claim**: merchant maps a hostname they do not own, or a dangling DNS/deleted-store host is reclaimed | T3 | H | DNS ownership proof before activation; deactivate on store removal; one active owner per host | Unverified host does not route; second tenant cannot claim an active host; deleted store host fails closed | THI-65 / M1 |
| AC-11 | **Open redirect** via return/redirect parameters | T1 | M | Redirect allowlist, same-origin or registered hosts only | Redirect to external or protocol-relative URL rejected | THI-66, THI-81 / M1, M5 |
| AC-35 | **Sibling-subdomain / shared-parent-domain attack**: XSS or cookie tossing/session fixation from one store's or user-content subdomain against other stores or the admin | T3, T1 | H | Separate registrable domains for admin, storefronts and user-content/media origins (or a documented justification); `__Host-` prefixed session cookies (no `Domain` attribute) | Cookie set from a sibling storefront/media origin does not reach or override the admin session; session cookie attributes asserted; script on a user-content origin cannot read admin state | THI-65, THI-66 / M1; THI-70 / M2 (media origin) |

### 6.3 Content, uploads and publishing

| ID | Abuse case | Adv. | Impact | Control summary | Required failure test | Owner / Gate |
| --- | --- | --- | --- | --- | --- | --- |
| AC-12 | **Stored XSS** through product fields and catalog storefront text (M2), or page JSON, rich text, theme tokens, SVG, filenames or metadata (M3) | T3 | H | Allowlisted block renderer, sanitized rich text, URL/size/depth limits, CSP, output encoding | Payload corpus (script, event handlers, `javascript:`/`data:` URLs, SVG script, CSS injection) is stripped or rejected in storefront, editor and admin. Transactional email output is a `gap`: no roadmap ticket owns transactional email, so its XSS/injection testing has no owner | Product fields and catalog storefront: THI-71 / M2. Page JSON, theme, editor: THI-72, THI-73, THI-74 / M3 |
| AC-13 | **Malicious upload**: wrong type/extension spoof, polyglot, oversized, decompression bomb, path traversal in name | T3 | M-H | Server-side type sniffing, size/dimension limits, generated storage keys, no execution from storage origin | Disallowed/spoofed/oversized files rejected; traversal names normalized; served with safe content type and `nosniff` | THI-70 / M2 |
| AC-14 | **Cross-tenant media access**: guess or reuse another tenant's object path or signed URL | T3, T1 | H | Tenant-prefixed keys, storage policies, short-lived signed URLs bound to tenant | Tenant A cannot read/list/overwrite/delete B's objects; expired signed URL denied | THI-70 / M2 |
| AC-15 | **Preview leak or persistence**: guessable/non-expiring preview exposes draft; preview populates public cache | T1 | M | Expiring, unguessable, tenant-bound preview tokens; no-store | Expired and cross-tenant preview token denied; response not cacheable | THI-74 / M3 |
| AC-16 | **Publish integrity**: partial/racy publish, rollback to schema-incompatible version, unauthorized publish | T3, T4 | M | Atomic publish/rollback, schema-compatibility check, role check | Concurrent publish race yields one consistent version; incompatible rollback refused; unauthorized role denied | THI-74 / M3 |
| AC-17 | **SSRF** through any server-side URL fetch (image import, link preview, oEmbed/webhook-URL fields, domain verification, redirects) reaching metadata endpoints, localhost or private ranges | T3 | H | Avoid server fetch of merchant URLs; where required, scheme/host allowlist, resolve-then-pin, block private/link-local/metadata ranges, cap redirects/size/time | Fetch of `127.0.0.1`, `169.254.169.254`, RFC1918, IPv6 loopback, DNS-rebind and redirect-to-internal all blocked | Every ticket introducing outbound fetch; THI-65, THI-70, THI-80 / M1+ |
| AC-18 | **Resource exhaustion**: huge page JSON, deeply nested blocks, unbounded list/export, noisy tenant | T1, T3 | M | Size/depth/count limits, pagination, per-tenant quotas and rate limits with defined failure behavior | Over-limit payloads rejected with bounded cost; one tenant's load does not starve another (readiness test) | THI-72, THI-87 / M3, M6 |
| AC-36 | **Hosting malicious or phishing content on KERNO-served domains**: a tenant publishes phishing/malware pages or media under KERNO-controlled hostnames, damaging domain reputation | T3 | M-H | Abuse reporting channel, takedown/suspension procedure, domain-reputation monitoring; scope of KERNO-served domains tied to AC-35 | Open decision, no test defined yet: a reported store can be suspended and its content stops serving | Unassigned (`gap`; owner approval needed to assign) / M6 (resolve or explicitly accept) |

### 6.4 Commerce, payments and billing

| ID | Abuse case | Adv. | Impact | Control summary | Required failure test | Owner / Gate |
| --- | --- | --- | --- | --- | --- | --- |
| AC-19 | **Client-trusted price, quantity, shipping or currency tampering** | T2 | H | Server-authoritative quote; integer minor units; currency fixed per store | Tampered price/currency/discount in request ignored; totals recomputed server-side | THI-69 / M2 (contracts); THI-75, THI-76 / M4 |
| AC-20 | **Oversell / reservation abuse**: last-unit race, reservation hoarding, expiry races | T2 | M | Transactional reservations with safe expiry, idempotency | Concurrent final-unit purchases yield one winner; expiry vs. payment race recovers | THI-77 / M4 |
| AC-21 | **IDOR on orders/customer data**: guess order ID or token to read another shopper's order | T2 | H | Unguessable identifiers plus authorization; minimal public projections | Order lookup across customers/tenants denied; responses omit unnecessary PII | THI-78 / M4 |
| AC-22 | **Webhook forgery**: unsigned or wrongly-signed event marks order paid/refunded | T5 | H | Signature verified over raw request bytes per provider rules before parsing | Missing/invalid/modified-body signature rejected with no state change | THI-81 / M5 |
| AC-23 | **Webhook replay and reordering**: valid old event re-sent; events arrive out of order or duplicated | T5, T8 | H | Persisted unique event ID, timestamp tolerance, idempotent transitions, allowed-transition table | Replay of a processed event is a no-op; out-of-order refund-before-payment handled; duplicate delivery safe | THI-81, THI-82 / M5 |
| AC-24 | **Account/tenant mismatch (cross-merchant event)**: event from merchant X's provider account applied to tenant Y's order, or wrong amount/currency | T5, T8 | H | Bind provider account to tenant; verify account, amount and currency against server order | Event with foreign account ID, or amount/currency mismatch, rejected and alerted | THI-80, THI-81 / M5 |
| AC-25 | **Redirect/browser callback treated as payment proof** | T2 | H | Order becomes paid only after verified provider evidence; reconcile missed events | Hitting success URL without verified event leaves order unpaid; reconciliation resolves missed webhook | THI-81, THI-82 / M5 |
| AC-26 | **Merchant provider credential theft or misuse**: stored plaintext, leaked in logs, used cross-tenant | T3, T7 | H | Encrypt at rest, decrypt only in adapters, never log, per-tenant binding, rotation/revocation | Credentials absent from logs/responses/bundles; adapter refuses cross-tenant use; secret scan passes | THI-80 / M5 |
| AC-27 | **Entitlement bypass**: client flag or stale/replayed billing event grants paid features; downgrade not enforced | T3, T5 | M | Server-side entitlement checks from verified subscription state; billing separated from purchase proceeds | Free-plan tenant denied paid feature by direct call; replayed/old subscription event cannot upgrade; downgrade enforced | THI-83 / M5 |
| AC-28 | **Platform diverting proceeds**: KERNO or a bug routes purchase funds through the wrong account or takes commission | T7, T8 | H | Merchant-owned accounts only; 0% commission invariant; hosted checkout; no card data handled | Contract test asserts destination is the merchant account and no platform fee/commission field is set on any provider call; no PAN fields in code/logs | THI-79, THI-81 / M5 |

### 6.5 Platform, data and delivery

| ID | Abuse case | Adv. | Impact | Control summary | Required failure test | Owner / Gate |
| --- | --- | --- | --- | --- | --- | --- |
| AC-29 | **Service-role key exposure** to client bundle or untrusted job | T6, T3 | H | Server-only module boundary, env separation, bundle scan | Bundle check fails if secret/service-role identifiers appear in client output (`scripts/check_bundles.py` extended per ticket) | THI-62, THI-64 / M0, M1 |
| AC-30 | **Supply-chain compromise**: malicious dependency, install script, workflow injection, fork-PR secret theft | T6 | H | Frozen lockfile, release-age policy, dependency/secret scans, least-privilege CI, pinned actions | Workflow validator and secret scan run in CI; fork PR has no secrets (THI-62 checks, re-verified at M6) | THI-62 / M0, M6 |
| AC-31 | **Sensitive data in logs/telemetry/errors**: tokens, raw provider payloads, PII, stack traces | T7 | M | Redaction, deliberate field projections, safe error messages, correlation IDs | Log fixtures with secrets/PII are redacted; error responses omit internals; provider raw payloads are redacted before logging or persistence | THI-81 / M5; THI-86 / M6 (design from M1) |
| AC-32 | **Unaudited sensitive action**: no record of who changed roles, domains, credentials, publishes or refunds | T4, T7 | M | Audit events with actor, tenant, action, outcome, correlation ID | Each sensitive action emits exactly one audit event; audit tenant-scoped and tamper-resistant by non-privileged roles | THI-65, THI-66 / M1; THI-68 / M2; THI-74 / M3; THI-80, THI-82 / M5; THI-86 / M6 |
| AC-33 | **Backup/restore or environment confusion**: prod data in dev/staging, unrestorable backup, cross-env secret reuse | T7 | H | Environment separation, restore rehearsal, rotation procedures | Restore rehearsal evidence; no shared secrets across environments | THI-86 / M6 |
| AC-34 | **Personal data over-collection/retention/erasure failure** | T7 | H | Data minimization, retention and erasure design, qualified legal review | Documented data inventory and erasure/export path verified | THI-85 / M6 |

## 7. Required scenario coverage

THI-63 requires these scenarios; each maps to the abuse cases and the test that must exist before the named gate.

| Scenario | Abuse cases | Verified by | Gate |
| --- | --- | --- | --- |
| Confused deputy | AC-3 (M1, M2, M3, M5), AC-24, AC-26 (M5) | Service-role/adapter tests and cross-tenant job tests | M1, M2, M3, M5 |
| Cross-tenant access | AC-1, AC-2, AC-8, AC-35 (M1), AC-14 (M2), AC-15 (M3), AC-21 (M4) | RLS integration suite, three-store Playwright (THI-67), media/preview/cache negatives, order IDOR negatives | M1–M4 |
| Webhook replay | AC-22, AC-23, AC-24, AC-25 | Provider contract tests with raw signed fixtures | M5 |
| SSRF | AC-17 | Outbound-fetch negative corpus in every ticket adding a fetch | M1+ |
| Stored XSS | AC-12 (M2 product fields/storefront; M3 page JSON/theme/editor), AC-13 (M2) | Payload corpus across renderer, editor, admin, SVG/media | M2–M3 |
| Privilege escalation | AC-4, AC-27 | Role-matrix tests by UI and direct API, entitlement tests | M1, M2, M5 |

## 8. Exclusions and accepted assumptions

Each exclusion needs an owner and a review trigger. Nothing here is a claim that the risk does not exist.

| ID | Exclusion / assumption | Rationale | Review trigger | Owner |
| --- | --- | --- | --- | --- |
| X-1 | Compromise of Supabase, hosting or provider infrastructure itself | Platform-provider risk is inherited; mitigate via provider selection, least privilege and recovery planning, not application code | Hosting decision (THI-86); provider selection (THI-79) | THI-86, THI-79 |
| X-2 | Card-data handling (PCI card-data scope) | Hosted provider checkout is mandatory; KERNO never receives raw card data. Hosted checkout does not remove all PCI obligations; merchants and providers define scope | THI-79; qualified payment-scope review | THI-79 |
| X-3 | Compromised merchant device or merchant-side malware | Outside platform control; mitigated by session hygiene and MFA only | MFA policy decision | Owner decision (MFA policy) |
| X-4 | Volumetric DDoS | Depends on hosting/CDN, not yet chosen; application-level rate limits still apply | Hosting decision | THI-86 |
| X-5 | Digital goods, subscriptions-as-products, marketplace payouts, mixed-currency carts, automatic tax | Not approved (physical goods first; no conversion or tax automation implied) | New product decision | Owner decision |
| X-6 | Regional data planes and data residency | Single initial backend region approved; regional planes need a new decision | Regional decision / THI-85 | Owner decision; THI-85 |
| X-7 | Legal conclusions (GDPR/LGPD, consumer, tax) | Require qualified review; this document is not legal assurance | THI-85 | THI-85 |
| X-8 | Side channels and physical/social attacks on KERNO staff | Operational security program, not this application model | Incident process (THI-86) | THI-86 |
| X-9 | Visual Blueprint v0.5 details | Document unavailable during bootstrap; do not infer | Reconcile when supplied (roadmap open inputs) | Owner decision (supply blueprint) |

## 9. Open decisions affecting this model

Roles matrix, MFA requirement, hosting and trusted-proxy topology, payment provider and onboarding model, inventory expiry, retention policy and incident ownership are unresolved in the [decision register](../decisions/README.md). Until decided, the related abuse cases above state controls at the policy level only. Record each decision as an ADR and update this model.

## 10. Maintenance

- Re-review at every milestone gate and when a boundary, provider or role changes.
- A ticket that adds a trust boundary, outbound fetch, upload path, privileged adapter or webhook updates this file and the evidence map in the same change.
- New abuse cases take the next free `AC-n`; never renumber, so references stay stable.
