<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## KERNO admin rules

Root AGENTS.md applies. Every server action and route handler authorizes itself through `@kerno/server` (`authorizeOrgAction` or a handler built on it): the proxy only refreshes sessions and redirects, and is not the authorization boundary. Never accept an organization or store id from the body, derive authority from the current membership, use the caller's own Supabase client for writes, and never import the service-role key into this app. See [merchant auth](../../docs/security/merchant-auth.md).
