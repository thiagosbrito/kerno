# Decision register

## Recorded baseline — 2026-11-03

Source: [KERNO Linear project](https://linear.app/thiagosbrito/project/kerno-ef4b1e3f582c/overview), which records the approved planning decisions. Earlier chat assistant content and the user-managed Visual Blueprint v0.5 were not retrievable as full source during bootstrap. Do not infer missing details.

Approved: platform-hosted shared Next.js/Supabase multi-tenancy; RLS plus server checks; one initial backend region; pnpm/Turborepo and stack described in [architecture](../steering/architecture.md); versioned page data; landing/catalog homepage; physical goods first; en/pt-BR/pl and USD/BRL/PLN; merchant-owned hosted payment checkout; subscription-only platform revenue with 0% transaction commission; ASVS 5.0 L2 target; M0–M6 ordering. No hosting provider or deadlines were selected.

## Open decisions

- Toolchain pinned in THI-61 (Node 24.16.0, pnpm 11.22.0, Next 16.4.5, React 19.3.1, TypeScript 6.0.3 because typescript-eslint supports `<6.1`, Vitest 5.1.0, Zod 4.6.7, Tailwind 4.3.4, Playwright 1.64.1). shadcn/ui with Base UI, `packages/domain` and `supabase/` are deferred to the tickets that first need them.
- Threat model and applicable ASVS evidence/exception policy: security foundation.
- Payment providers, country/currency support, onboarding model and payment scope: provider selection before payment adapters.
- Plan prices/limits and grace/downgrade policy: subscription implementation.
- Shipping integrations, taxation, returns/refunds, retention and legal responsibilities: relevant domain tickets and qualified market review.
- Hosting, SLOs, RPO/RTO, performance budgets and incident ownership: operations/readiness tickets.
- Unavailable blueprint details: reconcile when supplied; record any conflicts before implementation.

## Recording a new decision

Create a numbered Markdown record with status (proposed/accepted/superseded), date, owner/approval evidence, related issue, context, alternatives, decision, consequences and verification/rollback implications. Do not label a proposal accepted without evidence. Routine naming choices do not need an ADR.
