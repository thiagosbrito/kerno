# Workflow steering

Linear is authoritative for scope, priority, dependencies, milestone and acceptance criteria. Repository guidance and decision records are authoritative for implementation conventions. Resolve conflicts explicitly against approved user decisions. Read the linked issue and blockers before coding; do not create duplicate tickets or mark unverified work done.

Use a focused branch associated with the issue identifier, inspect working changes and avoid unrelated edits. Agree interface/schema changes before dependent work. Do not spawn or message other agents unless authorized. Keep commits reviewable and include issue references. Before pushing, verify the repository root, remote destination and branch; never force-push or reset user work. Use existing Git identity/configuration; do not invent an author or change global settings.

For each implementation: inspect current behavior, identify trust boundaries, make the smallest coherent change, run relevant checks and attach acceptance evidence. Include security/failure cases and migration/deployment/rollback effects in review. Bootstrap has no package scripts; once created, document exact commands and require frozen install, lint, typecheck, unit/integration, browser and build checks appropriate to the change.

Do not make production, provider, DNS or real-money changes merely because a ticket describes them. Follow the task's authorized scope and explicit release gates. Never print credentials during troubleshooting. Record blockers accurately and distinguish local validation from CI or production verification.

## Milestone gates

M0 establishes source and toolchain guardrails. M1 must prove three isolated stores before broad feature work. M2 provides merchant/catalog contracts; M3 publishes safe storefront configuration; M4 proves commerce consistency; M5 proves merchant payments and separate subscriptions; M6 requires evidence and owner sign-off for beta/real-money launch. Security is tested within each milestone. Native Linear blockers capture ticket dependencies; milestone gates also apply even where individual tickets could be explored earlier.

## Completion report

State resulting behavior/files, tests actually run and their result, acceptance evidence, known risks and any unfinished work. Update decision records and links when contracts change. Do not present a pushed commit, passing CI, completed milestone or compliant system without verifying it.
