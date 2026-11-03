# KERNO roadmap

[Linear project](https://linear.app/thiagosbrito/project/kerno-ef4b1e3f582c/overview) owns live status, priorities, blockers and acceptance criteria. This index is a bootstrap snapshot, not a second status tracker. Read [AGENTS.md](../AGENTS.md) and [workflow](steering/workflow.md) before taking a ticket. High = P2 in Linear's numeric API (priority 2); Medium = priority 3. No deadlines are assigned.

Milestone gates proceed M0 → M1 → M2 → M3 → M4 → M5 → M6. Native ticket blockers record specific prerequisites; milestone security and exit evidence also apply. Security work is continuous. This commit addresses the guidance ticket only; it does not complete the toolchain, CI or threat-model work in M0.

## M0 · Repository & Agent Foundation

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-60](https://linear.app/thiagosbrito/issue/THI-60/version-repository-owned-agent-guidance-and-roadmap) | Version repository-owned agent guidance and roadmap | High | None |
| [THI-61](https://linear.app/thiagosbrito/issue/THI-61/bootstrap-the-approved-monorepo-and-local-development) | Bootstrap the approved monorepo and local development | High | THI-60 |
| [THI-62](https://linear.app/thiagosbrito/issue/THI-62/enforce-ci-quality-dependency-and-secret-checks) | Enforce CI quality, dependency and secret checks | High | THI-61 |
| [THI-63](https://linear.app/thiagosbrito/issue/THI-63/define-threat-model-asvs-evidence-map-and-trust-boundaries) | Define threat model, ASVS evidence map and trust boundaries | High | THI-60 |

## M1 · Multi-tenant Proof of Concept

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-64](https://linear.app/thiagosbrito/issue/THI-64/model-tenants-memberships-and-deny-by-default-rls) | Model tenants, memberships and deny-by-default RLS | High | THI-61, THI-63 |
| [THI-65](https://linear.app/thiagosbrito/issue/THI-65/implement-verified-hostname-to-store-routing) | Implement verified hostname-to-store routing | High | THI-64 |
| [THI-66](https://linear.app/thiagosbrito/issue/THI-66/implement-merchant-authentication-and-server-authorization) | Implement merchant authentication and server authorization | High | THI-64 |
| [THI-67](https://linear.app/thiagosbrito/issue/THI-67/prove-three-stores-with-end-to-end-tenant-isolation) | Prove three stores with end-to-end tenant isolation | High | THI-65, THI-66, THI-62 |

## M2 · Merchant Admin & Catalog

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-68](https://linear.app/thiagosbrito/issue/THI-68/build-merchant-onboarding-store-settings-and-roles) | Build merchant onboarding, store settings and roles | High | THI-67 |
| [THI-69](https://linear.app/thiagosbrito/issue/THI-69/implement-catalog-variants-and-exact-money-contracts) | Implement catalog, variants and exact money contracts | High | THI-68 |
| [THI-70](https://linear.app/thiagosbrito/issue/THI-70/secure-product-media-uploads-and-delivery) | Secure product media uploads and delivery | High | THI-69 |
| [THI-71](https://linear.app/thiagosbrito/issue/THI-71/deliver-localized-catalog-storefront-and-basic-seo) | Deliver localized catalog storefront and basic SEO | Medium | THI-69, THI-70 |

## M3 · Visual Page Builder & Publishing

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-72](https://linear.app/thiagosbrito/issue/THI-72/define-versioned-page-schemas-theme-tokens-and-block-registry) | Define versioned page schemas, theme tokens and block registry | High | THI-71 |
| [THI-73](https://linear.app/thiagosbrito/issue/THI-73/build-accessible-visual-editor-with-draft-persistence) | Build accessible visual editor with draft persistence | Medium | THI-72 |
| [THI-74](https://linear.app/thiagosbrito/issue/THI-74/implement-isolated-previews-atomic-publishing-and-rollback) | Implement isolated previews, atomic publishing and rollback | High | THI-73 |

## M4 · Commerce, Shipping & Rules

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-75](https://linear.app/thiagosbrito/issue/THI-75/implement-server-authoritative-cart-and-price-quotation) | Implement server-authoritative cart and price quotation | High | THI-69, THI-74 |
| [THI-76](https://linear.app/thiagosbrito/issue/THI-76/implement-country-rules-and-shipping-rate-quotes) | Implement country rules and shipping rate quotes | High | THI-75 |
| [THI-77](https://linear.app/thiagosbrito/issue/THI-77/implement-inventory-reservations-with-safe-expiry) | Implement inventory reservations with safe expiry | High | THI-75 |
| [THI-78](https://linear.app/thiagosbrito/issue/THI-78/implement-order-state-machine-and-fulfillment-foundation) | Implement order state machine and fulfillment foundation | High | THI-76, THI-77 |

## M5 · Merchant Payments & SaaS Billing

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-79](https://linear.app/thiagosbrito/issue/THI-79/select-merchant-payment-and-platform-billing-providers) | Select merchant payment and platform billing providers | High | THI-78, THI-63 |
| [THI-80](https://linear.app/thiagosbrito/issue/THI-80/implement-merchant-payment-account-connection) | Implement merchant payment account connection | High | THI-79, THI-66 |
| [THI-81](https://linear.app/thiagosbrito/issue/THI-81/integrate-hosted-purchase-checkout-and-verified-webhooks) | Integrate hosted purchase checkout and verified webhooks | High | THI-80, THI-78 |
| [THI-82](https://linear.app/thiagosbrito/issue/THI-82/implement-refunds-disputes-and-payment-reconciliation) | Implement refunds, disputes and payment reconciliation | High | THI-81 |
| [THI-83](https://linear.app/thiagosbrito/issue/THI-83/implement-kerno-subscriptions-and-server-entitlements) | Implement KERNO subscriptions and server entitlements | High | THI-79, THI-68 |

## M6 · Secure Beta & Production Readiness

| Ticket | Scope | Priority | Blocked by |
| --- | --- | --- | --- |
| [THI-84](https://linear.app/thiagosbrito/issue/THI-84/complete-asvs-l2-verification-and-remediate-findings) | Complete ASVS L2 verification and remediate findings | High | THI-82, THI-83, THI-62, THI-63 |
| [THI-85](https://linear.app/thiagosbrito/issue/THI-85/validate-brazilpoland-privacy-and-commerce-readiness) | Validate Brazil/Poland privacy and commerce readiness | High | THI-79, THI-76, THI-83 |
| [THI-86](https://linear.app/thiagosbrito/issue/THI-86/establish-deployment-telemetry-backup-and-recovery) | Establish deployment, telemetry, backup and recovery | High | THI-81, THI-83, THI-62 |
| [THI-87](https://linear.app/thiagosbrito/issue/THI-87/validate-performance-accessibility-and-release-beta-gates) | Validate performance, accessibility and release beta gates | High | THI-84, THI-85, THI-86 |

## Open product inputs

The user-managed Visual Blueprint v0.5 was unavailable during bootstrap. Reconcile it before implementing unspecified product details. Provider, hosting, plan and market-policy decisions are explicitly gated in their tickets; the initial stack and commercial principles remain as recorded in the [decision register](decisions/README.md).
