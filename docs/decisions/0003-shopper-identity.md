# 0003 · Shopper accounts and identity

- Status: **accepted** (owner approval in the THI-64 session, 2026-11-04: passwordless login, shared identity with per-store relations, store-bound sessions). Implementation and the spike belong to THI-89; transactional email ownership and the GDPR/LGPD review remain open.
- Date: 2026-11-03
- Related: [THI-64](https://linear.app/thiagosbrito/issue/THI-64/model-tenants-memberships-and-deny-by-default-rls), THI-65, THI-66, THI-78; threat-model cases AC-2, AC-3, AC-21; [THI-89](https://linear.app/thiagosbrito/issue/THI-89/implement-passwordless-shopper-accounts-with-per-store-isolation)

## Context

The roadmap had no ticket for shopper accounts, although shoppers need order history and tracking. Supabase Auth has one global email namespace per project; tenant-scoped email uniqueness is an open upstream request, not a feature. Measured on the local stack: signing up an existing email returns `user_already_exists` when email confirmation is off, and client-supplied `user_metadata` is stored as sent.

## Alternatives

- Shared identity in `auth.users` plus a per-store relation (chosen, with the controls below).
- Per-store derived identities (an HMAC of store and email as the login address): isolates credentials, but needs a mail hook and custom reset and email-change flows; worked in a signup test only.
- Own customer authentication outside Supabase: moves password and session security (ASVS V6, V7, V9) onto us.
- A Supabase project per store: contradicts the approved single multi-tenant platform.
- External CIAM: new provider decision and cost; a fallback.

## Decision

- One `auth.users` row per person. A `customers` table keyed by `(store_id, user_id)` holds the per-store relation and the personal data for that store (name, phone, marketing consent, accepted terms version and time, an email copy for the merchant). No personal data in `auth.users` metadata.
- Passwordless only: email code or magic link, proven per store on every sign-in. No shopper passwords.
- Signup and sign-in run on the server. The store comes from the verified host, never from the client. Join always answers "check your email"; the auth user and the `customers` row are created only after the code is confirmed, so existence is never revealed.
- **Session isolation (requirement):** being signed in at one store never signs a shopper in at another, even though they share one auth account. Sessions are store-bound: after the server verifies the email code with Supabase, it discards the Supabase session and issues its own opaque random token (only its hash is stored, with `store_id`, `user_id`, expiry, rotation and revocation). The cookie is `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite` and host-only (no `Domain`), so browsers never send it to another store and sibling subdomains cannot overwrite it. Each request requires the session's store to equal the verified host's store and a `customers` row for that pair. Fallback if we want less session code: Supabase's own session in an HttpOnly host-only cookie, which is not bound to a store and relies on the server-side store check alone.
- Shoppers do not call Supabase data tables directly. The customer tables get no `authenticated` policies, and the server scopes every access by store and session. Memberships and shopper relations stay separate: a shopper row grants no merchant access.
- Erasure at one store removes that relation and anonymizes its orders; the auth user is removed when the last relation is gone.

## Consequences

Credentials are shared across stores (shoppers have none), sessions are not, and KERNO becomes controller of the identity record while each merchant controls its shop relationship; this needs qualified GDPR/LGPD review. We own a small session store (ASVS V7). Transactional email ownership (an open gap in the threat model) must be decided. A later move to per-store identities would be a migration. The threat model and ASVS map need new cases (cross-store enumeration, token reach, erasure) in the same change that implements this.

## Verification and rollback

Two-store tests: same email joins both stores, store B cannot see store A's relation or data, signup responses are uniform for new and existing emails, a store A token cannot read store B data, erasure at one store leaves the other intact. Reverting is a forward migration plus disabling the join flow.
