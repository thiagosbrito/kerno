# KERNO

Multi-tenant, customizable e-commerce SaaS for merchants in Brazil and Poland. Merchants receive purchase proceeds through their own payment-provider accounts; KERNO earns subscriptions with 0% platform transaction commission.

## Repository status

Foundation documentation only. There is no installable application, package manifest, database migration or deployment yet. Runtime setup and automated application checks are backlog work.

- [Agent entry point](AGENTS.md)
- [Roadmap and Linear tickets](docs/roadmap.md)
- [Architecture](docs/steering/architecture.md)
- [Security](docs/steering/security.md)
- [Testing](docs/steering/testing.md)
- [Workflow](docs/steering/workflow.md)
- [Decision register](docs/decisions/README.md)

Linear owns priorities, status, dependencies and acceptance criteria. This private repository owns source, implementation decisions and agent guidance. The planning source is the [KERNO project](https://linear.app/thiagosbrito/project/kerno-ef4b1e3f582c/overview); the user-managed Visual Blueprint v0.5 was not available during this bootstrap and must be reconciled before conflicting product details are implemented.

Validate this documentation with `python3 scripts/validate_docs.py` and `git diff --check`. Application commands will be documented when the monorepo is bootstrapped.
