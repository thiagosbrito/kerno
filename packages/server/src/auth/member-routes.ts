import { memberRoleChangeSchema, uuidParamSchema, type OrgRole } from "@kerno/contracts";
import { authorizeOrgAction, recordDenied, type Denial } from "./guard";
import { canChangeRole, canRemoveMember } from "./permissions";
import type { AuthDependencies, MutationResult } from "./types";

const MAX_BODY_BYTES = 1024;

/** Every response is private and uncacheable; the correlation id lets support find the audit row. */
function respond(deps: AuthDependencies, status: number, body: Record<string, unknown> | null): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Correlation-Id": deps.correlationId,
    },
  });
}

function refuse(deps: AuthDependencies, event: string, denial: Denial): Response {
  deps.log({ event, correlationId: deps.correlationId, outcome: "denied", reason: denial.reason });
  return respond(deps, denial.status, { error: denial.code });
}

function fromMutation(deps: AuthDependencies, event: string, result: MutationResult): Response {
  deps.log({ event, correlationId: deps.correlationId, outcome: result === "ok" ? "allowed" : "error", reason: result });
  switch (result) {
    case "ok":
      return respond(deps, 200, { ok: true });
    case "forbidden":
      // The database refused what the server check allowed (for example the actor was demoted mid-request).
      return respond(deps, 403, { error: "forbidden" });
    case "conflict":
      return respond(deps, 409, { error: "conflict" });
    case "not_found":
      // RLS filtered the row (for example a concurrent revocation): same answer as a missing object.
      return respond(deps, 404, { error: "not_found" });
    default:
      return respond(deps, 503, { error: "unavailable" });
  }
}

function auditDatabaseRefusal(
  deps: AuthDependencies,
  event: string,
  params: MemberRouteParams,
  targetId: string,
  gate: { userId: string; role: OrgRole },
): Promise<void> {
  return recordDenied(deps, {
    organizationId: params.organizationId,
    userId: gate.userId,
    action: event,
    targetType: "membership",
    targetId,
    reason: "rejected_by_database",
    role: gate.role,
  });
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface MemberRouteParams {
  readonly organizationId: string;
  readonly userId: string;
}

/**
 * PATCH /api/organizations/:organizationId/members/:userId  { "role": "..." }
 * The organization id in the URL is untrusted: authority comes from the caller's CURRENT
 * membership of that organization. The target must be a member of the same organization, which
 * the database also enforces (RLS filters other tenants' rows to zero).
 */
export async function handleMemberRoleChange(
  request: Request,
  params: MemberRouteParams,
  deps: AuthDependencies,
): Promise<Response> {
  const event = "member.role_change";
  // `member.read` is the lowest bar; the fine-grained rule below depends on the target's role.
  const gate = await authorizeOrgAction(deps, request, { organizationId: params.organizationId, action: "member.read" });
  if (!gate.ok) return refuse(deps, event, gate.denial);

  const target = uuidParamSchema.safeParse(params.userId);
  if (!target.success) return refuse(deps, event, { status: 400, code: "invalid_request", reason: "malformed_user_id" });
  const body = memberRoleChangeSchema.safeParse(await readJson(request));
  if (!body.success) return refuse(deps, event, { status: 400, code: "invalid_request", reason: "invalid_body" });

  const current = await deps.members.getRole(params.organizationId, target.data);
  if (current.status === "unavailable") return refuse(deps, event, { status: 503, code: "unavailable", reason: "target_lookup_unavailable" });
  // A target outside the caller's organization looks exactly like a missing one.
  if (current.status === "not_member") return refuse(deps, event, { status: 404, code: "not_found", reason: "target_not_member" });

  if (!canChangeRole(gate.role, current.role, body.data.role)) {
    await recordDenied(deps, {
      organizationId: params.organizationId,
      userId: gate.userId,
      action: event,
      targetType: "membership",
      targetId: target.data,
      reason: "role_change_not_permitted",
      role: gate.role,
    });
    return refuse(deps, event, { status: 403, code: "forbidden", reason: "role_change_not_permitted" });
  }

  // The write uses the caller's own credentials: RLS and the last-owner trigger apply again.
  // The trigger on `memberships` writes the success audit row (actor = auth.uid()).
  const result = await deps.members.changeRole(params.organizationId, target.data, body.data.role);
  if (result === "forbidden") await auditDatabaseRefusal(deps, event, params, target.data, gate);
  return fromMutation(deps, event, result);
}

/** DELETE /api/organizations/:organizationId/members/:userId  (also how a member leaves) */
export async function handleMemberRemoval(
  request: Request,
  params: MemberRouteParams,
  deps: AuthDependencies,
): Promise<Response> {
  const event = "member.remove";
  const gate = await authorizeOrgAction(deps, request, { organizationId: params.organizationId, action: "member.read" });
  if (!gate.ok) return refuse(deps, event, gate.denial);

  const target = uuidParamSchema.safeParse(params.userId);
  if (!target.success) return refuse(deps, event, { status: 400, code: "invalid_request", reason: "malformed_user_id" });

  const current = await deps.members.getRole(params.organizationId, target.data);
  if (current.status === "unavailable") return refuse(deps, event, { status: 503, code: "unavailable", reason: "target_lookup_unavailable" });
  if (current.status === "not_member") return refuse(deps, event, { status: 404, code: "not_found", reason: "target_not_member" });

  const targetRole: OrgRole = current.role;
  if (!canRemoveMember(gate.role, targetRole, target.data === gate.userId)) {
    await recordDenied(deps, {
      organizationId: params.organizationId,
      userId: gate.userId,
      action: event,
      targetType: "membership",
      targetId: target.data,
      reason: "removal_not_permitted",
      role: gate.role,
    });
    return refuse(deps, event, { status: 403, code: "forbidden", reason: "removal_not_permitted" });
  }
  const result = await deps.members.remove(params.organizationId, target.data);
  if (result === "forbidden") await auditDatabaseRefusal(deps, event, params, target.data, gate);
  return fromMutation(deps, event, result);
}
