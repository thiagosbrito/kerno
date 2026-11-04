# Merchant authentication and server authorization (THI-66)

Status: implemented in `packages/server/src/auth`, `apps/admin` and `supabase/migrations/20261104120000_audit_events.sql`. Roles follow [ADR 0002](../decisions/0002-organization-roles.md). Abuse cases: AC-2, AC-5, AC-6, AC-7 (partly), AC-11, AC-32 in the [threat model](threat-model.md); chapters V4, V6, V7, V8, V9, V16 in the [ASVS evidence map](asvs-evidence-map.md). ASVS L2 is a target, not a certification.

## Design

- **Identity** is a Supabase Auth session (email and password). The admin app never trusts the cookie's contents: every decision calls `auth.getUser()`, which asks the auth server and therefore rejects expired, revoked and signed-out sessions. `getSession()` is not used for access decisions. If the auth server is unreachable the answer is `unavailable` (503), not "anonymous" and not "allowed".
- **Authority** comes from the caller's *current* `memberships` row, read on every request through the caller's own credentials (so RLS applies too). It never comes from the token, a cookie, `user_metadata`, a cache or a submitted tenant id. Revoking or demoting a member therefore takes effect on their next request even though their session stays valid.
- **One gate.** `authorizeOrgAction` (`packages/server/src/auth/guard.ts`) runs origin check, then session, then membership, then role permission, and fails closed at each step. `permissions.ts` is the only role-to-action table on the server; `canChangeRole` and `canRemoveMember` mirror the RLS rules so an escalation is refused early and audited, while RLS still rejects it if this layer were wrong.
- **Two layers.** Writes use the user-scoped client, so a server bug cannot exceed what RLS grants. The service role appears in one place only: `createAuditSink`, which calls `record_audit_event` after the session was verified; the function refuses actors who are not members of the target organization.
- **Per-request state.** `createRequestAuth` builds a new Supabase client from that request's cookies each time. Nothing about an identity is held in module state or shared caches.

## Responses

| Situation | Status | Notes |
| --- | --- | --- |
| Foreign, `null` or missing origin on a mutation | 403 | Checked before any lookup or write |
| No valid session | 401 | API routes; pages redirect to `/login?next=<safe path>` |
| Auth server or membership lookup unavailable | 503 | Fails closed |
| Caller is not a member (another tenant's or a nonexistent organization), or the target is not in the organization | 404 | Identical body, so organization ids cannot be probed (IDOR) |
| Member whose role is insufficient (including escalation) | 403 | Audited as `<action>.denied` with the actor |
| Malformed id or body (unknown keys, bad role) | 400 | Zod strict schemas in `@kerno/contracts` |
| Last-owner protection | 409 | From the database trigger |

Every response is `Cache-Control: no-store`, carries `X-Correlation-Id`, and contains only a coarse error code. Internal reasons go to a structured log line with ids and reasons only (no tokens, emails or bodies).

## Sessions, login and logout

- Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` outside development, path `/`. The app never reads tokens in the browser. **Gap:** the `__Host-` prefix the evidence map mentions is not applied: it requires HTTPS, which local development does not have, and a production-only cookie name would be untested here. Decide with the hosting ticket (THI-86).
- `apps/admin/src/proxy.ts` verifies the session on each request, which refreshes an expiring access token and rewrites the cookies, and redirects unauthenticated page requests. It is a convenience layer, not the boundary: pages, server actions and routes re-check on their own.
- Login returns one message for malformed input, unknown account and wrong password. A 429 from Supabase becomes "too many attempts"; an outage becomes "temporarily unavailable". The `next` parameter is accepted only as a same-origin path (`safeRedirectPath`).
- Logout calls `signOut({ scope: "local" })`, which revokes the refresh token on the auth server, and also deletes the `sb-*` cookies even if that call fails. A copied cookie stops working (tested).
- Server actions get Next.js's Origin/Host comparison plus the explicit allowed-origin check (`NEXT_PUBLIC_ADMIN_URL`). If the admin sits behind a proxy whose public origin differs, set `NEXT_PUBLIC_ADMIN_URL` to the public origin.
- Session lifetime is Supabase's: access token `jwt_expiry = 3600`, refresh-token rotation on (`supabase/config.toml`). Password minimum length is 12 locally. Absolute and inactivity timeouts (`[auth.sessions]`) are hosted-plan features and are **not** configured or tested here.

## Audit

`public.audit_events` (no role can update, delete, truncate or insert directly, `service_role` included: a row trigger blocks UPDATE/DELETE, a statement trigger blocks TRUNCATE even for the table owner, and `service_role` privileges are revoked, leaving `record_audit_event` as the only service-side writer; the owner/superuser can still bypass via DDL, which is outside the application threat model; no foreign keys, so evidence outlives the organization, store or user). Fields: organization, optional store, actor, action, target type and id, outcome (`success`, `denied`, `failure`), correlation id, small metadata object. Metadata holds ids, roles and changed column *names*, never values (contact emails, notes).

- **Successes** are written by `SECURITY DEFINER` triggers on `memberships`, `stores` and `organizations`, so they cover every path (admin app, direct Data API, service role, SQL). The actor is `auth.uid()`; `null` means a trusted or system context. For `add_member`, the actor is the acting user it was given.
- **Denials** (insufficient role, escalation attempts) are written by the server through `record_audit_event`. Probes by non-members are only logged, because writing them into a guessed organization's trail would let anyone spam it.
- Successes are audited on every path, but denials only on server routes: a denied direct Data API call is filtered by RLS to zero rows and leaves no row. Writes made with the service role carry a null actor unless the function takes one (as `add_member` does), so future service-role flows must pass the actor explicitly.
- The correlation id the server generates is forwarded to Postgres as an `x-correlation-id` header, so trigger rows and denial rows for one request share it. A malformed value is replaced. A signed-in user calling the Data API directly can still choose a well-formed id for their own trigger rows, so treat the correlation id as untrusted for direct API activity.
- Owners and admins of an organization can read its trail through RLS; nobody else can. There is no admin UI for it yet.
- **Not audited yet:** logins and logouts (user-level, not tenant-scoped; they are structured log lines), and events from tables that later tickets add (domains, publishing, payments). Each such ticket must add its own audit coverage (AC-32).

## Verification

| Evidence | Where | Run |
| --- | --- | --- |
| Audit triggers, visibility, append-only, no log spam, rollback | `supabase/tests/audit.test.ts`, `rls.test.ts` | `pnpm --filter @kerno/supabase test` |
| Role matrix, origin/CSRF, IDOR, revoked membership, escalation, leakage, fail-closed | `packages/server/src/auth/*.test.ts` | `pnpm test` |
| Input schemas, open redirect | `packages/contracts/src/auth.test.ts` | `pnpm test` |
| Real login, bad credentials, HttpOnly cookies, CSRF, IDOR, role change and denied escalation with audit rows, revocation with a live session, logout invalidating a copied cookie | `e2e/merchant-auth.spec.ts` | `pnpm db:start`, then `E2E_MERCHANT_AUTH=1 E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_ROLE_KEY=... pnpm test:e2e` (keys from `pnpm exec supabase status -o env`) |
| Service-role key absent from client bundles | `pnpm test:bundles`, `supabase/tests/service-role-boundary.test.ts` | as named |

CI runs the e2e in the `Browser (Playwright)` job. Unit tests use in-memory fakes for the decision logic; only the database suite and the e2e prove RLS and real session behavior.

## Known limits and open decisions

- **Session expiry** is delegated to Supabase and is not exercised by a test (the e2e does not wait out a token lifetime). Refresh happens in the proxy; a refresh failure results in a redirect to login.
- **Rate limiting** of sign-in relies on Supabase Auth's limits; no KERNO-side limit or lockout exists and the numbers are not decided (open item in the evidence map). Role-change endpoints have no rate limit yet.
- **MFA, password reset, invitations and account creation** are not implemented (MFA policy is open in ADR 0002; invitations belong to THI-68). `enable_signup` is still on in the local config: a signed-up user has no membership and therefore no access, but onboarding must decide whether merchant sign-up stays open.
- **Cookies** lack the `__Host-` prefix (above). No CSP is set; the admin app sends `X-Frame-Options: DENY`, `nosniff` and a same-origin referrer policy only.
- The admin UI has only login, logout and a read-only list of the caller's organizations. The member-role API (`/api/organizations/:organizationId/members/:userId`, PATCH and DELETE) is the first guarded write and the pattern for later tickets; store and catalog writes are not built yet.
- Concurrent revocation during a request is covered by RLS filtering the write to zero rows (reported as 404); a race between the role check and the write is not separately tested.

## Rollback

Run `supabase/rollbacks/20261104130000_audit_events_harden.down.sql` first, then `supabase/rollbacks/20261104120000_audit_events.down.sql`, which drops the triggers, the function, the table (**destroying the audit trail**) and the type; run it first, before the other rollbacks. Pre-production only. Afterwards, roll forward with a new migration. Application code that calls `record_audit_event` then fails to audit denials but still denies (audit failures never turn a denial into an allow).
