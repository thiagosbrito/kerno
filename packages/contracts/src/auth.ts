import { z } from "zod";

/** Organization roles, highest privilege first (ADR 0002). Mirrors the `org_role` enum. */
export const ORG_ROLES = ["owner", "admin", "manager", "staff"] as const;
export const orgRoleSchema = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** Identifiers in URLs are untrusted input: accept only the canonical UUID form. */
export const uuidParamSchema = z.uuid();

/**
 * Credentials. Length is bounded (resource exhaustion) but the password policy itself is owned by
 * Supabase Auth; this schema must not leak which half of a credential was wrong.
 */
export const loginInputSchema = z
  .object({
    email: z.string().max(254).trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Body of a member role change. Unknown keys are rejected so no extra field can be smuggled in. */
export const memberRoleChangeSchema = z.object({ role: orgRoleSchema }).strict();
export type MemberRoleChange = z.infer<typeof memberRoleChangeSchema>;

export const AUDIT_OUTCOMES = ["success", "denied", "failure"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Request header carrying the correlation id; the shape is enforced again by the database. */
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Where to send a user after login. Only same-origin absolute paths are allowed, so the login
 * page cannot be used as an open redirect (`//evil.test`, `/\evil.test` and schemes all fail).
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length > 200) return fallback;
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(value)) return fallback;
  return value;
}
