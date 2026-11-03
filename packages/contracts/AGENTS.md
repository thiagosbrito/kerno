# contracts scope

Root AGENTS.md applies. Zod schemas and serializable contracts only: no secrets, database clients or provider SDKs. `publicEnvSchema` may contain only `NEXT_PUBLIC_*` names; anything else goes in `serverEnvSchema`. Error messages name variables, never echo submitted values.
