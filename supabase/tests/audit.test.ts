import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anon, as, type Db, ids, newDatabase, rejection, seed, service, user } from "./harness";

const PERMISSION = "42501";
const CHECK_VIOLATION = "23514";

const owner = user(ids.ownerA);
const admin = user(ids.adminA);
const manager = user(ids.managerA);
const staff = user(ids.staffA);
const ownerOfB = user(ids.ownerB);

let db: Db;
beforeAll(async () => {
  db = await newDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await seed(db);
});

type Event = {
  organization_id: string;
  store_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  correlation_id: string;
  metadata: Record<string, unknown>;
};
const events = (where = "true") =>
  as<Event>(db, service, `select * from public.audit_events where ${where} order by created_at, id`);

describe("row-change auditing", () => {
  it("records a role change with actor, tenant, action, outcome and correlation id, and no PII", async () => {
    await as(db, owner, `update public.memberships set role = 'manager' where user_id = '${ids.staffA}'`);
    const { rows } = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ids.orgA,
      actor_user_id: ids.ownerA,
      action: "membership.role_changed",
      target_type: "membership",
      target_id: ids.staffA,
      outcome: "success",
      metadata: { from: "staff", to: "manager" },
    });
    expect(rows[0]?.correlation_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("audits member removal and store changes, storing column names but never values", async () => {
    await as(db, admin, `delete from public.memberships where user_id = '${ids.staffA}'`);
    await as(db, admin, `update public.stores set contact_email = 'new-secret@example.test', status = 'active', name = 'Renamed' where id = '${ids.storeADraft}'`);
    const { rows } = await events();
    expect(rows.map((r) => r.action)).toEqual(["membership.removed", "store.updated"]);
    expect(rows[1]?.metadata).toEqual({
      changed: ["contact_email", "name", "status"],
      status_from: "draft",
      status_to: "active",
    });
    expect(JSON.stringify(rows)).not.toContain("new-secret@example.test");
  });

  it("audits store creation and deletion, organization rename, and service-role (system) changes", async () => {
    await as(db, owner, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'extra-a', 'Extra')`);
    await as(db, owner, `delete from public.stores where slug = 'extra-a'`);
    await as(db, owner, `update public.organizations set name = 'Acme Renamed' where id = '${ids.orgA}'`);
    await as(db, service, `update public.stores set status = 'suspended' where id = '${ids.storeA}'`);
    const { rows } = await events();
    expect(rows.map((r) => [r.action, r.actor_user_id])).toEqual([
      ["store.created", ids.ownerA],
      ["store.deleted", ids.ownerA],
      ["organization.renamed", ids.ownerA],
      ["store.updated", null],
    ]);
  });

  it("records the actor passed to add_member as the actor of the added membership", async () => {
    await as(db, service, `select public.add_member('${ids.orgA}', '${ids.outsider}', 'staff', '${ids.ownerA}')`);
    const { rows } = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "membership.added", actor_user_id: ids.ownerA, metadata: { role: "staff" } });
  });

  it("does not record failed or no-op changes", async () => {
    await as(db, staff, `update public.memberships set role = 'owner' where user_id = '${ids.staffA}'`);
    await as(db, owner, `update public.stores set name = name where id = '${ids.storeA}'`);
    expect((await events()).rows).toEqual([]);
  });

  it("uses a well-formed forwarded correlation id and ignores a malformed one", async () => {
    const run = async (header: string) => {
      await db.exec("begin");
      try {
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: ids.ownerA })]);
        await db.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-correlation-id": header })]);
        await db.exec(`update public.organizations set name = 'N-${Math.random()}' where id = '${ids.orgA}'`);
        await db.exec("commit");
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    };
    await run("req-1234abcd");
    await run("bad id; drop table");
    const ids_ = (await events()).rows.map((r) => r.correlation_id);
    expect(ids_[0]).toBe("req-1234abcd");
    expect(ids_[1]).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("audit visibility and tamper resistance", () => {
  beforeEach(async () => {
    await as(db, owner, `update public.memberships set role = 'manager' where user_id = '${ids.staffA}'`);
    await as(db, ownerOfB, `update public.organizations set name = 'B Renamed' where id = '${ids.orgB}'`);
  });

  it("owners and admins read only their own organization's trail", async () => {
    for (const ctx of [owner, admin]) {
      const { rows } = await as<Event>(db, ctx, "select * from public.audit_events");
      expect(rows.map((r) => r.organization_id)).toEqual([ids.orgA]);
    }
    const b = await as<Event>(db, ownerOfB, "select * from public.audit_events");
    expect(b.rows.map((r) => r.organization_id)).toEqual([ids.orgB]);
  });

  it("managers, staff, non-members and anonymous cannot read it", async () => {
    for (const ctx of [manager, staff, user(ids.outsider)]) {
      expect((await as(db, ctx, "select * from public.audit_events")).rows).toEqual([]);
    }
    expect((await rejection(as(db, anon, "select * from public.audit_events"))).code).toBe(PERMISSION);
  });

  it("API roles cannot insert, update, delete or truncate", async () => {
    const insert = `insert into public.audit_events (organization_id, action, target_type, outcome, correlation_id) values ('${ids.orgA}', 'fake.event', 'store', 'success', 'abcdefgh12')`;
    for (const ctx of [owner, admin, anon]) {
      expect((await rejection(as(db, ctx, insert))).code).toBe(PERMISSION);
      expect((await rejection(as(db, ctx, "update public.audit_events set outcome = 'denied'"))).code).toBe(PERMISSION);
      expect((await rejection(as(db, ctx, "delete from public.audit_events"))).code).toBe(PERMISSION);
      expect((await rejection(as(db, ctx, "truncate public.audit_events"))).code).toBe(PERMISSION);
    }
  });

  it("even the service role cannot rewrite or delete history", async () => {
    expect((await rejection(as(db, service, "update public.audit_events set outcome = 'denied'"))).code).toBe(PERMISSION);
    expect((await rejection(as(db, service, "delete from public.audit_events"))).code).toBe(PERMISSION);
    // The table owner is stopped by the row trigger even though it holds the privileges.
    expect((await rejection(db.exec("update public.audit_events set outcome = 'denied'"))).message).toContain("append-only");
    expect((await rejection(db.exec("delete from public.audit_events"))).message).toContain("append-only");
  });

  it("even the service role cannot truncate, forge rows directly or delete (only record_audit_event writes)", async () => {
    expect((await rejection(as(db, service, "truncate public.audit_events"))).code).toBe(PERMISSION);
    const forged = `insert into public.audit_events (organization_id, action, target_type, outcome, correlation_id) values ('${ids.orgA}', 'fake.event', 'store', 'success', 'abcdefgh12')`;
    expect((await rejection(as(db, service, forged))).code).toBe(PERMISSION);
    // Even the table owner's TRUNCATE is stopped by the statement trigger.
    expect((await rejection(db.exec("truncate public.audit_events"))).message).toContain("append-only");
    expect((await events()).rows.length).toBeGreaterThan(0);
  });

  it("survives deletion of the organization it describes", async () => {
    await as(db, owner, `delete from public.organizations where id = '${ids.orgA}'`);
    const { rows } = await events(`organization_id = '${ids.orgA}'`);
    expect(rows.map((r) => r.action)).toContain("organization.deleted");
  });

  it("API roles cannot call the trigger or correlation helpers", async () => {
    for (const fn of ["private.audit_row_change()", "private.current_correlation_id()"]) {
      expect((await rejection(as(db, owner, `select ${fn}`))).code).toBe(PERMISSION);
    }
  });
});

describe("record_audit_event", () => {
  const call = (ctx: Parameters<typeof as>[1], actor: string, org = ids.orgA, outcome = "denied") =>
    as(
      db,
      ctx,
      `select public.record_audit_event('${org}', null, '${actor}', 'membership.role_change', 'membership', 'x', '${outcome}', 'corr-12345678', '{"required":"admin"}')`,
    );

  it("is callable only by the service role", async () => {
    for (const ctx of [anon, owner, admin]) {
      expect((await rejection(call(ctx, ids.ownerA))).code).toBe(PERMISSION);
    }
  });

  it("records a denied attempt by a current member", async () => {
    await call(service, ids.staffA);
    const { rows } = await events();
    expect(rows[0]).toMatchObject({ actor_user_id: ids.staffA, outcome: "denied", correlation_id: "corr-12345678", metadata: { required: "admin" } });
  });

  it("refuses to write into an organization the actor does not belong to (no cross-tenant log spam)", async () => {
    expect((await rejection(call(service, ids.ownerB, ids.orgA))).code).toBe(PERMISSION);
    expect((await rejection(call(service, ids.outsider))).code).toBe(PERMISSION);
    expect((await events()).rows).toEqual([]);
  });

  it("rejects malformed events and oversized metadata", async () => {
    const bad = `select public.record_audit_event('${ids.orgA}', null, '${ids.ownerA}', 'Bad Action!', 'store', null, 'denied', 'corr-12345678', null)`;
    expect((await rejection(as(db, service, bad))).code).toBe(CHECK_VIOLATION);
    const big = JSON.stringify({ blob: "x".repeat(4000) });
    expect(
      (await rejection(as(db, service, `select public.record_audit_event('${ids.orgA}', null, '${ids.ownerA}', 'a.b', 'store', null, 'denied', 'corr-12345678', '${big}')`))).code,
    ).toBe(CHECK_VIOLATION);
  });
});
