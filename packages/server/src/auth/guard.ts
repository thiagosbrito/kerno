import type { OrgRole } from "@kerno/contracts";
import { uuidParamSchema } from "@kerno/contracts";
import { isOriginAllowed } from "./origin";
import { roleAllows, type Action } from "./permissions";
import type { AuthDependencies } from "./types";

export type Denial = {
  readonly status: 400 | 401 | 403 | 404 | 503;
  /** Machine-readable and deliberately coarse: it must not reveal whether an object exists. */
  readonly code: "invalid_request" | "unauthenticated" | "forbidden" | "not_found" | "unavailable";
  /** For logs and audit only; never put it in a response body. */
  readonly reason: string;
};

export type Authorized = { readonly ok: true; readonly userId: string; readonly role: OrgRole };
export type Refused = { readonly ok: false; readonly denial: Denial };

const deny = (status: Denial["status"], code: Denial["code"], reason: string): Refused => ({
  ok: false,
  denial: { status, code, reason },
});

/**
 * Centralized gate for every tenant-scoped server action or API route: origin (CSRF) -> verified
 * session -> CURRENT membership -> role permission. Each step fails closed. Non-members get
 * `not_found`, identical to a missing organization, so organization ids cannot be probed (IDOR);
 * members lacking the role get `forbidden` and the attempt is audited.
 */
export async function authorizeOrgAction(
  deps: AuthDependencies,
  request: { readonly method: string; readonly headers: { get(name: string): string | null } },
  input: { readonly organizationId: string; readonly action: Action },
): Promise<Authorized | Refused> {
  if (!isOriginAllowed(request.method, request.headers, { allowedOrigins: deps.allowedOrigins })) {
    return deny(403, "forbidden", "origin_not_allowed");
  }
  if (!uuidParamSchema.safeParse(input.organizationId).success) {
    return deny(400, "invalid_request", "malformed_organization_id");
  }

  const session = await deps.getSession();
  if (session.status === "unavailable") return deny(503, "unavailable", "session_check_unavailable");
  if (session.status !== "authenticated") return deny(401, "unauthenticated", "no_valid_session");

  const lookup = await deps.members.getRole(input.organizationId, session.userId);
  if (lookup.status === "unavailable") return deny(503, "unavailable", "membership_check_unavailable");
  if (lookup.status === "not_member") return deny(404, "not_found", "not_a_member");

  if (!roleAllows(lookup.role, input.action)) {
    await recordDenied(deps, {
      organizationId: input.organizationId,
      userId: session.userId,
      action: input.action,
      targetType: "organization",
      targetId: input.organizationId,
      reason: "role_not_permitted",
      role: lookup.role,
    });
    return deny(403, "forbidden", "role_not_permitted");
  }
  return { ok: true, userId: session.userId, role: lookup.role };
}

/** Best-effort: a failing audit write must not turn a denial into an allow, nor leak into the response. */
export async function recordDenied(
  deps: AuthDependencies,
  event: {
    organizationId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    role: OrgRole;
  },
): Promise<void> {
  try {
    await deps.audit.record({
      organizationId: event.organizationId,
      actorUserId: event.userId,
      action: `${event.action}.denied`,
      targetType: event.targetType,
      targetId: event.targetId,
      outcome: "denied",
      correlationId: deps.correlationId,
      details: { reason: event.reason, actor_role: event.role },
    });
  } catch {
    deps.log({ event: event.action, correlationId: deps.correlationId, outcome: "error", reason: "audit_write_failed" });
  }
}
