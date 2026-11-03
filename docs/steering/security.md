# Security steering

Target OWASP ASVS 5.0 Level 2 and applicable API Top 10 risks. Maintain a requirement-to-control-to-test evidence matrix in the threat-model ticket. Record applicability and justified exceptions; never claim certification from a checklist. Security work starts in M0 and is a condition of every milestone.

## Authorization and isolation

Default deny. Derive identity from verified sessions and roles from current memberships. Check authorization for every object/action; ownership cannot come from submitted tenant IDs. Enable RLS for tenant tables, storage policies and public/private distinctions. Test direct APIs and database policies as well as application paths. Treat service-role access as privileged. Do not share cached private data between requests or tenants.

Validate Host/forwarded-host trust and domain ownership; unknown hosts fail closed. Enforce origin/CSRF protections on cookie-authenticated mutations. Constrain redirects, outbound URLs and upload content; protect against SSRF, stored XSS, path traversal and resource exhaustion. Rate limits and quotas need server enforcement with documented failure behavior.

## Credentials and personal data

Keep secrets in environment/managed secret storage, with least privilege, separation by environment and rotation/revocation procedures. Commit env variable names only. Encrypt merchant credentials at rest and limit decryption to adapters. Do not log tokens, raw provider payloads, card data or unnecessary order/customer PII. Redact telemetry and audit sensitive actions with actor, tenant, action, outcome and correlation ID.

## Commerce and billing

Use provider-hosted purchase checkout and the correct merchant-owned account. Prices, permissions, inventory, shipping, currency and order state are server-authoritative. Verify webhook signatures against original request bytes according to provider rules, account/tenant binding, amount/currency and replay protections. Persist unique event processing and tolerate retries and reordering. Confirm provider evidence before marking payment/refund final. Reconcile missing events.

Keep KERNO subscription billing separate from purchase proceeds. Enforce entitlements on server; browser state never grants access. No platform transaction commission. Never test live money before documented provider, security, privacy/market and operational release gates and owner authorization.

## Delivery and incidents

Use reproducible lockfile installs, least-privilege CI and dependency/secret scans. Untrusted PR jobs cannot access production secrets. Separate development, staging and production. Document incident ownership, containment, credential rotation, backup/restore and data exposure response. Qualified review must establish GDPR/LGPD, consumer/tax obligations and payment scope; this guidance is not legal assurance.
