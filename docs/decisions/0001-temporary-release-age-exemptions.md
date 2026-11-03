# 0001 · Temporary pnpm release-age exemptions

- Status: accepted (time-limited)
- Date: 2026-11-03
- Owner / approval evidence: repository owner instructed in the THI-61 session on 2026-11-03 to record this as a time-limited decision.
- Related: THI-61, PR #1

## Context

pnpm 11 quarantines package versions younger than its minimum release age (about one day by default). Supply-chain delay is a deliberate control. At bootstrap, the pinned `next@16.4.5` (published 2026-11-03T18:01Z) and `tailwindcss@4.3.4` (published 2026-11-02T21:30Z) were inside that window, so `pnpm install` added `minimumReleaseAgeExclude` entries for them and their platform binaries (`@next/*`, `@tailwindcss/*`) to `pnpm-workspace.yaml`.

## Alternatives

- Pin older, already-aged versions: rejected for bootstrap because the registry's current releases were the tested baseline.
- Disable the quarantine globally: rejected; it weakens the control for every future dependency.

## Decision

Keep the exemptions only for the exact pinned versions listed in `pnpm-workspace.yaml`, until the quarantine window has elapsed. Remove every `minimumReleaseAgeExclude` entry on or after **2026-11-04T18:02Z** (24 hours after the newest exempted release) and verify with `pnpm install --frozen-lockfile`. Any new exemption needs its own record with an expiry.

## Consequences and verification

- Versions in the lockfile are exact, so the exemption cannot admit a different, unreviewed release.
- Residual risk: a malicious release published inside the window would not have been quarantined. The lockfile integrity hashes were created at install time on 2026-11-03; no independent review of those versions was performed.
- Rollback: delete the exclusion list; if install fails, the version is still inside the window, so wait or pin an older version.
- The CI frozen-install check was added by THI-62; the follow-up removal of the exemptions is still open.
