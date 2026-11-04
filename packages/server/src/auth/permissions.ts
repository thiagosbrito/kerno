import type { OrgRole } from "@kerno/contracts";

/**
 * The one place that maps roles to actions on the server (ADR 0002, docs/security/tenancy-and-rls.md).
 * It mirrors the RLS policies but does not replace them: RLS still rejects a write this table
 * would wrongly allow, and this table rejects it earlier with an audit trail and a clear status.
 * Default deny: an action that is not listed is denied.
 */
export const ACTIONS = {
  "org.read": ["owner", "admin", "manager", "staff"],
  "org.rename": ["owner"],
  "org.delete": ["owner"],
  "store.write": ["owner", "admin"],
  "store.delete": ["owner"],
  "member.read": ["owner", "admin", "manager", "staff"],
  "audit.read": ["owner", "admin"],
} as const satisfies Record<string, readonly OrgRole[]>;

export type Action = keyof typeof ACTIONS;

export function roleAllows(role: OrgRole, action: Action): boolean {
  return (ACTIONS[action] as readonly OrgRole[]).includes(role);
}

const MANAGEABLE_BY_ADMIN: readonly OrgRole[] = ["manager", "staff"];

/**
 * Whether `actor` may change a member currently holding `current` to `next`. Owners manage every
 * role; admins manage only managers and staff and may not mint admins or owners (no escalation,
 * no lateral moves); managers and staff manage nobody.
 */
export function canChangeRole(actor: OrgRole, current: OrgRole, next: OrgRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return MANAGEABLE_BY_ADMIN.includes(current) && MANAGEABLE_BY_ADMIN.includes(next);
  return false;
}

/** Removing a member follows the same hierarchy; anyone may remove themselves (leave). */
export function canRemoveMember(actor: OrgRole, current: OrgRole, isSelf: boolean): boolean {
  if (isSelf) return true;
  if (actor === "owner") return true;
  if (actor === "admin") return MANAGEABLE_BY_ADMIN.includes(current);
  return false;
}
