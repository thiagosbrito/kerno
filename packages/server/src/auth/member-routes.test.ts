import type { OrgRole } from "@kerno/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { handleMemberRemoval, handleMemberRoleChange } from "./member-routes";
import type { AuthDependencies, DeniedAudit, LogEntry, MemberStore, MutationResult, SessionResult } from "./types";

const ORIGIN = "https://admin.kerno.test";
const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000a2";
const MANAGER = "00000000-0000-4000-8000-0000000000a4";
const STAFF = "00000000-0000-4000-8000-0000000000a3";
const OWNER_B = "00000000-0000-4000-8000-0000000000b1";
const OUTSIDER = "00000000-0000-4000-8000-0000000000c1";

/** In-memory stand-in for memberships; RLS itself is proven by supabase/tests, not here. */
class FakeMembers implements MemberStore {
  rows = new Map<string, OrgRole>();
  down = false;
  writes: string[] = [];
  nextWrite: MutationResult = "ok";
  private key = (org: string, user: string) => `${org}:${user}`;
  set(org: string, user: string, role: OrgRole) {
    this.rows.set(this.key(org, user), role);
  }
  revoke(org: string, user: string) {
    this.rows.delete(this.key(org, user));
  }
  async getRole(org: string, user: string) {
    if (this.down) return { status: "unavailable" as const };
    const role = this.rows.get(this.key(org, user));
    return role ? { status: "member" as const, role } : { status: "not_member" as const };
  }
  async changeRole(org: string, user: string, role: OrgRole) {
    this.writes.push(`role:${org}:${user}:${role}`);
    return this.nextWrite;
  }
  async remove(org: string, user: string) {
    this.writes.push(`remove:${org}:${user}`);
    return this.nextWrite;
  }
}

let members: FakeMembers;
let session: SessionResult;
let audits: DeniedAudit[];
let logs: LogEntry[];
let auditDown: boolean;

const deps = (): AuthDependencies => ({
  allowedOrigins: new Set([ORIGIN]),
  getSession: async () => session,
  members,
  audit: {
    record: async (event) => {
      if (auditDown) throw new Error("audit store down");
      audits.push(event);
    },
  },
  log: (entry) => logs.push(entry),
  correlationId: "corr1234abcd",
});

const as = (userId: string): SessionResult => ({ status: "authenticated", userId });

const patch = (role: unknown, headers: Record<string, string> = { origin: ORIGIN }, raw?: string) =>
  new Request("https://admin.kerno.test/api", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify({ role }),
  });
const del = (headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request("https://admin.kerno.test/api", { method: "DELETE", headers });

beforeEach(() => {
  members = new FakeMembers();
  members.set(ORG_A, OWNER, "owner");
  members.set(ORG_A, ADMIN, "admin");
  members.set(ORG_A, MANAGER, "manager");
  members.set(ORG_A, STAFF, "staff");
  members.set(ORG_B, OWNER_B, "owner");
  session = as(OWNER);
  audits = [];
  logs = [];
  auditDown = false;
});

const change = (role: unknown, target: string, org = ORG_A, req = patch(role)) =>
  handleMemberRoleChange(req, { organizationId: org, userId: target }, deps());

describe("unauthenticated requests", () => {
  it("get 401 with no side effects when there is no valid session", async () => {
    session = { status: "unauthenticated" };
    const res = await change("staff", MANAGER);
    expect(res.status).toBe(401);
    expect(members.writes).toEqual([]);
    expect(await handleMemberRemoval(del(), { organizationId: ORG_A, userId: STAFF }, deps())).toHaveProperty("status", 401);
  });

  it("fail closed with 503 when the session or membership check is unavailable", async () => {
    session = { status: "unavailable" };
    expect((await change("staff", MANAGER)).status).toBe(503);
    session = as(OWNER);
    members.down = true;
    expect((await change("staff", MANAGER)).status).toBe(503);
    expect(members.writes).toEqual([]);
  });
});

describe("CSRF / origin checks", () => {
  it.each([
    ["foreign origin", { origin: "https://evil.test" }],
    ["null origin", { origin: "null" }],
    ["no origin or fetch metadata", {}],
    ["cross-site fetch metadata only", { "sec-fetch-site": "cross-site" }],
  ])("rejects a state change with %s before any lookup or write", async (_name, headers) => {
    const res = await handleMemberRoleChange(patch("staff", headers), { organizationId: ORG_A, userId: MANAGER }, deps());
    expect(res.status).toBe(403);
    expect(members.writes).toEqual([]);
    const removal = await handleMemberRemoval(del(headers), { organizationId: ORG_A, userId: STAFF }, deps());
    expect(removal.status).toBe(403);
    expect(members.writes).toEqual([]);
  });

  it("accepts a same-origin fetch that omits Origin", async () => {
    const res = await change("staff", MANAGER, ORG_A, patch("staff", { "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(200);
  });
});

describe("IDOR", () => {
  it("answers a non-member the same way for another tenant's organization and a nonexistent one", async () => {
    session = as(OWNER_B);
    const other = await change("staff", STAFF, ORG_A);
    const missing = await change("staff", STAFF, "10000000-0000-4000-8000-0000000000ff");
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.text()).toBe(await missing.text());
    expect(members.writes).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("does not let an owner of one tenant act on a member of another via a forged path", async () => {
    session = as(OWNER);
    // OWNER_B belongs to ORG_B only; addressing it through ORG_A must look like a missing member.
    const res = await change("staff", OWNER_B, ORG_A);
    expect(res.status).toBe(404);
    expect(members.writes).toEqual([]);
    // And ORG_B is closed to OWNER entirely.
    expect((await change("staff", OWNER_B, ORG_B)).status).toBe(404);
  });

  it("keeps three tenants apart: every owner is denied on every other organization and nothing is written", async () => {
    const ORG_C = "10000000-0000-4000-8000-00000000000c";
    const OWNER_C = "00000000-0000-4000-8000-0000000000d1";
    const STAFF_C = "00000000-0000-4000-8000-0000000000d2";
    members.set(ORG_C, OWNER_C, "owner");
    members.set(ORG_C, STAFF_C, "staff");
    const tenants = [
      { org: ORG_A, owner: OWNER, member: STAFF },
      { org: ORG_B, owner: OWNER_B, member: OWNER_B },
      { org: ORG_C, owner: OWNER_C, member: STAFF_C },
    ];
    for (const actor of tenants) {
      for (const target of tenants.filter((t) => t !== actor)) {
        session = as(actor.owner);
        expect((await change("staff", target.member, target.org)).status, `${actor.org} -> ${target.org}`).toBe(404);
        expect((await handleMemberRemoval(del(), { organizationId: target.org, userId: target.member }, deps())).status).toBe(404);
      }
    }
    expect(members.writes).toEqual([]);
    expect(audits).toEqual([]);
    // Control: the same owner can act inside its own organization.
    session = as(OWNER_C);
    expect((await change("manager", STAFF_C, ORG_C)).status).toBe(200);
    expect(members.writes).toEqual([`role:${ORG_C}:${STAFF_C}:manager`]);
  });

  it("ignores a client-submitted organization id in the body (strict schema)", async () => {
    const res = await change(undefined, STAFF, ORG_A, patch(undefined, { origin: ORIGIN }, JSON.stringify({ role: "staff", organization_id: ORG_B })));
    expect(res.status).toBe(400);
    expect(members.writes).toEqual([]);
  });

  it.each(["not-a-uuid", "../../etc/passwd", "10000000-0000-4000-8000-00000000000a' or '1'='1"])("rejects malformed ids %s", async (bad) => {
    expect((await change("staff", bad)).status).toBe(400);
    expect((await change("staff", STAFF, bad)).status).toBe(400);
    expect(members.writes).toEqual([]);
  });
});

describe("revoked membership and stale privilege", () => {
  it("denies the very next request after a revocation, even though the session is still valid", async () => {
    expect((await change("staff", MANAGER)).status).toBe(200);
    members.revoke(ORG_A, OWNER);
    const res = await change("staff", MANAGER);
    expect(res.status).toBe(404);
    expect(members.writes).toHaveLength(1);
  });

  it("uses the current role, so a demotion takes effect immediately", async () => {
    members.set(ORG_A, ADMIN, "staff");
    session = as(ADMIN);
    const res = await change("manager", STAFF);
    expect(res.status).toBe(403);
    expect(members.writes).toEqual([]);
  });

  it("reports a write that RLS filtered (concurrent revocation) as not found", async () => {
    members.nextWrite = "not_found";
    expect((await change("staff", MANAGER)).status).toBe(404);
  });
});

describe("role escalation", () => {
  it.each<[string, OrgRole, string, OrgRole]>([
    ["admin promoting staff to owner", "admin", STAFF, "owner"],
    ["admin promoting staff to admin", "admin", STAFF, "admin"],
    ["admin demoting another owner", "admin", OWNER, "staff"],
    ["manager promoting itself to owner", "manager", MANAGER, "owner"],
    ["staff promoting itself to admin", "staff", STAFF, "admin"],
  ])("denies and audits %s", async (_name, actorRole, target, newRole) => {
    const actor = actorRole === "admin" ? ADMIN : actorRole === "manager" ? MANAGER : STAFF;
    session = as(actor);
    const res = await change(newRole, target);
    expect(res.status).toBe(403);
    expect(members.writes).toEqual([]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId: ORG_A,
      actorUserId: actor,
      action: "member.role_change.denied",
      outcome: "denied",
      correlationId: "corr1234abcd",
    });
  });

  it("lets an owner and (within limits) an admin change roles", async () => {
    expect((await change("admin", STAFF)).status).toBe(200);
    session = as(ADMIN);
    expect((await change("staff", MANAGER)).status).toBe(200);
    expect(members.writes).toHaveLength(2);
  });

  it("returns 403 and audits when the database refuses a write the server check allowed (concurrent demotion)", async () => {
    members.nextWrite = "forbidden";
    expect((await change("staff", MANAGER)).status).toBe(403);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "member.role_change.denied", details: { reason: "rejected_by_database" } });
  });

  it("surfaces the last-owner protection as a conflict", async () => {
    members.nextWrite = "conflict";
    expect((await change("staff", OWNER)).status).toBe(409);
  });

  it("still denies when the audit write fails, without leaking the failure", async () => {
    auditDown = true;
    session = as(STAFF);
    const res = await change("admin", STAFF);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("audit");
    expect(logs.some((l) => l.reason === "audit_write_failed")).toBe(true);
  });

  it("does not audit probes by non-members (no cross-tenant log spam)", async () => {
    session = as(OUTSIDER);
    await change("owner", STAFF);
    expect(audits).toEqual([]);
  });
});

describe("removal", () => {
  it("lets members leave, but not remove peers or higher roles", async () => {
    session = as(STAFF);
    expect((await handleMemberRemoval(del(), { organizationId: ORG_A, userId: STAFF }, deps())).status).toBe(200);
    session = as(MANAGER);
    expect((await handleMemberRemoval(del(), { organizationId: ORG_A, userId: STAFF }, deps())).status).toBe(403);
    session = as(ADMIN);
    expect((await handleMemberRemoval(del(), { organizationId: ORG_A, userId: OWNER }, deps())).status).toBe(403);
    expect(audits.map((a) => a.action)).toEqual(["member.remove.denied", "member.remove.denied"]);
  });
});

describe("session and data leakage", () => {
  it("never caches, never sets cookies and never echoes identifiers or internal reasons", async () => {
    const responses = [
      await change("staff", MANAGER),
      await change("owner", STAFF, ORG_A, patch("owner", { origin: "https://evil.test" })),
      await (async () => {
        session = { status: "unauthenticated" };
        return change("staff", MANAGER);
      })(),
      await (async () => {
        session = as(STAFF);
        return change("admin", STAFF);
      })(),
      await (async () => {
        session = as(OUTSIDER);
        return change("admin", STAFF);
      })(),
    ];
    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-correlation-id")).toBe("corr1234abcd");
      const body = await res.text();
      for (const secret of [ORG_A, ORG_B, OWNER, ADMIN, STAFF, OUTSIDER, "role_not_permitted", "origin_not_allowed", "not_a_member"]) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it("keeps internal reasons in the log only, with no ids of users or tokens", async () => {
    session = as(OUTSIDER);
    await change("admin", STAFF);
    expect(logs).toEqual([{ event: "member.role_change", correlationId: "corr1234abcd", outcome: "denied", reason: "not_a_member" }]);
  });
});
