# server scope

Root AGENTS.md applies. Everything here is server-only (`import "server-only"` guards the entry point). Never import this package from a client component; `pnpm test:bundles` must stay clean. Service-role access needs narrow use and equivalent explicit authorization.
