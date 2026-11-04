# CI and branch protection

Workflow: `.github/workflows/ci.yml`. It runs on `pull_request` and pushes to `main` with `permissions: contents: read`, no repository secrets, `persist-credentials: false`, and third-party actions pinned to full commit SHAs (the tag is in a trailing comment; Dependabot proposes updates). Fork and other untrusted PRs therefore run without secrets and with a read-only token. Do not add `pull_request_target`, or `workflow_run` that checks out PR code, and do not add secrets to these jobs; deployment credentials belong in a separate, protected-environment workflow created by the deployment ticket.

## Required checks and local equivalents

| CI job | Local equivalent |
| --- | --- |
| Quality | `pnpm install --frozen-lockfile`, `pnpm lint` (workspace packages plus `e2e/` and `playwright.config.ts`), `pnpm typecheck`, `pnpm test`, `pnpm test:bundles:self`, `pnpm test:bundles`, `pnpm docs:check`, `git diff --check <base> HEAD` (CI) / `git diff --check` (local, working tree), `git diff --exit-code` |
| Browser (Playwright) | `pnpm exec playwright install chromium` once, then `pnpm test:e2e`; CI also re-runs `e2e/three-store-isolation.spec.ts` with `E2E_PRODUCTION_SERVER=1` against `next build && next start` |
| Security | `pnpm test:secrets:self`, `pnpm scan:secrets`, `pnpm test:workflows:self`, `pnpm check:workflows`, `pnpm audit:deps` |

`scripts/scan_secrets.py` is an offline pattern scan of tracked files (private keys, cloud/provider tokens, JWT-shaped values, credential-like assignments). It prints file, line and rule only, never the value. Placeholder and sentinel values are ignored; a line may carry `secret-scan: allow` for a documented fixture, but the marker is honoured only in `scripts/test_*.py`; anywhere else it is ignored and the finding stands. Quoted keys (`"API_KEY": "..."`) and Supabase `sb_secret_` keys are detected, and a placeholder on a line does not hide a later real value. It complements, not replaces, GitHub secret scanning with push protection, which is enabled for this public repository. A real finding means rotate the credential first, then remove it.

`scripts/check_workflows.py` statically checks every `.github/workflows/*.y*ml` (line/regex, no YAML parser, offline) and prints `file:line: rule`. It fails on the triggers `pull_request_target` and `workflow_run`, any `secrets.` reference or bare `secrets` inside a single-line `${{ }}` expression or `if:` (for example `toJSON(secrets)`), a missing top-level `permissions` block (job-level blocks do not satisfy it) or any `permissions` value other than `contents: read` (including job-level overrides), any `uses:` not pinned to a 40-hex commit SHA (local `./` actions are allowed; a `uses:` value on the next line or in flow style `{ uses: ... }` is also reported), and any `actions/checkout` step (case-insensitive) without `persist-credentials: false`. This guards the untrusted-PR rules above against accidental regressions in review; `pnpm test:workflows:self` exercises it with synthetic good and bad workflow text. It is an accidental-change guard, not a security boundary: comment stripping is naive (a ` #` inside a quoted string hides the rest of the line), multi-line expressions are not analysed, and it does not validate YAML or prove runtime behaviour. Branch protection and review remain the real controls.

Whitespace and generated-file checks: in CI the Quality job fetches full history and runs `git diff --check "$BASE" HEAD`, where `BASE` is the pull request base SHA (or the push `before` SHA, falling back to the empty tree for a new branch or an all-zero value). It is passed through `env`, never interpolated into the script. After lint, typecheck, test and build, `git diff --exit-code` fails if any tracked file was modified or regenerated and not committed (untracked files are not detected). Locally, `git diff --check` inspects only uncommitted working-tree changes, so run `git diff --check <base> HEAD` to mirror CI for committed work.

`pnpm audit:deps` fails on high or critical advisories and needs network access. Lower severities are reported but do not block; triage them in the PR.

## Branch protection (applied)

The repository is public, so GitHub rulesets are available. Ruleset `Main` is active on `main` with an empty bypass list (it applies to administrators):

- restrict deletions and block force pushes;
- require a pull request, 0 required approvals while there is a single contributor (raise to 1 when a second reviewer exists), dismiss stale approvals on push, require conversation resolution;
- require status checks, branch up to date before merging: `Quality (lint, typecheck, test, build, bundles, docs)`, `Browser (Playwright)`, `Security (secret scan, dependency audit)`.

Also set: Settings → Actions → General → workflow token "Read repository contents" and approval required for workflows from outside collaborators; secret scanning and push protection enabled. Rulesets live in GitHub settings, not in the repository; re-check them with `gh api repos/thiagosbrito/kerno/rulesets`. Because the repository is public, never commit credentials, production data or customer information.

Verified 2026-11-03: a throwaway PR with a lint error and a whitespace error failed the Quality job and GitHub reported it as blocked (`gh pr merge` refused).

## Verifying that failures block

On a throwaway branch, introduce each failure and confirm the named job goes red: a lint error, a type error, a failing test, a lockfile mismatch (edit `package.json` without `pnpm install`), a broken doc link, and a synthetic credential-shaped value such as an AWS-style key id. Then confirm the branch-protection rule prevents merging.
