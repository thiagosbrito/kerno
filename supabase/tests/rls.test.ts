import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type Db,
  anon,
  as,
  ids,
  migrationFiles,
  migrationsDir,
  newDatabase,
  rejection,
  rollbackFile,
  seed,
  service,
  user,
} from "./harness";

const PERMISSION = "42501"; // insufficient_privilege, also raised for RLS WITH CHECK violations
const owner = user(ids.ownerA);
const admin = user(ids.adminA);
const staff = user(ids.staffA);
const manager = user(ids.managerA);
const ownerOfB = user(ids.ownerB);
const outsider = user(ids.outsider);

let db: Db;
beforeAll(async () => {
  db = await newDatabase(); // replays every migration on an empty database
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await seed(db);
});

const count = async (ctx: Parameters<typeof as>[1], table: string, where = "true") =>
  (await as<{ n: number }>(db, ctx, `select count(*)::int as n from public.${table} where ${where}`)).rows[0]?.n;

describe("catalog: deny by default", () => {
  it("enables RLS on every table in public and defines policies for each", async () => {
    const { rows } = await db.query<{ relname: string; rls: boolean; policies: number }>(`
      select c.relname, c.relrowsecurity as rls,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')`);
    expect(rows.map((r) => r.relname).sort()).toEqual(
      ["memberships", "organizations", "store_public_profiles", "stores"],
    );
    for (const r of rows) {
      expect(r.rls, `${r.relname} must have RLS`).toBe(true);
      expect(r.policies, `${r.relname} must have policies`).toBeGreaterThan(0);
    }
  });

  it("keeps every tenant table keyed by organization_id or store_id (silo-ready, ADR 0004)", async () => {
    const { rows } = await db.query<{ table_name: string; keys: number }>(`
      select c.relname as table_name,
        (select count(*)::int from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
            and a.attname in ('organization_id', 'store_id')) as keys
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    // organizations is the tenant root: its own primary key is the tenant id.
    const roots = new Set(["organizations"]);
    const unkeyed = rows.filter((r) => r.keys === 0 && !roots.has(r.table_name)).map((r) => r.table_name);
    expect(unkeyed).toEqual([]);
  });

  it("has no views without security_invoker and no unreviewed SECURITY DEFINER functions", async () => {
    const views = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private') and c.relkind in ('v', 'm')
        and not coalesce((select 'security_invoker=true' = any (c.reloptions)), false)`);
    expect(views.rows).toEqual([]);

    const definers = await db.query<{ fn: string }>(`
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef order by 1`);
    // Reviewed in the migration; adding to this list needs a justification there.
    expect(definers.rows.map((r) => r.fn)).toEqual([
      "private.has_org_role",
      "private.is_org_member",
      "private.protect_last_owner",
      "private.store_is_active",
    ]);
    const unpinned = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not coalesce((select 'search_path=""' = any (p.proconfig)), false)`);
    expect(unpinned.rows).toEqual([]);
  });

  it("grants anonymous only the public projection, with no private columns", async () => {
    const { rows } = await db.query<{ table_name: string; column_name: string; privilege_type: string }>(`
      select table_name, column_name, privilege_type from information_schema.column_privileges
      where grantee = 'anon' and table_schema = 'public' order by 1, 2, 3`);
    expect(new Set(rows.map((r) => r.table_name))).toEqual(new Set(["store_public_profiles"]));
    expect(new Set(rows.map((r) => r.privilege_type))).toEqual(new Set(["SELECT"]));
  });

  it("denies a table created later by default (default privileges revoked)", async () => {
    await db.exec("create table public.future_table (id int)");
    try {
      const error = await rejection(as(db, anon, "select * from public.future_table"));
      expect(error.code).toBe(PERMISSION);
      const asUser = await rejection(as(db, owner, "select * from public.future_table"));
      expect(asUser.code).toBe(PERMISSION);
    } finally {
      await db.exec("drop table public.future_table");
    }
  });
});

describe("anonymous", () => {
  it.each(["organizations", "memberships", "stores"])("cannot read %s", async (table) => {
    expect((await rejection(as(db, anon, `select * from public.${table}`))).code).toBe(PERMISSION);
  });

  it("reads only active stores' public profiles", async () => {
    const { rows } = await as<{ store_id: string }>(db, anon, "select store_id from public.store_public_profiles");
    expect(rows.map((r) => r.store_id).sort()).toEqual([ids.storeA, ids.storeB]);
  });

  it("cannot write anything", async () => {
    for (const sql of [
      `insert into public.store_public_profiles (store_id, display_name, default_locale, currency) values ('${ids.storeA}', 'x', 'en', 'USD')`,
      `update public.store_public_profiles set display_name = 'hacked'`,
      `delete from public.store_public_profiles`,
      `insert into public.organizations (name) values ('x')`,
      `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'evil-store', 'x')`,
    ]) {
      expect((await rejection(as(db, anon, sql))).code, sql).toBe(PERMISSION);
    }
    expect((await rejection(as(db, anon, `select public.create_organization('x', '${ids.outsider}')`))).code).toBe(PERMISSION);
  });

  it("cannot invoke the SECURITY DEFINER trigger function directly", async () => {
    expect((await rejection(as(db, anon, "select private.protect_last_owner()"))).code).toBe(PERMISSION);
    expect((await rejection(as(db, owner, "select private.protect_last_owner()"))).code).toBe(PERMISSION);
    const grants = await db.query<{ routine_name: string }>(
      `select distinct routine_name from information_schema.routine_privileges
       where routine_schema = 'private' and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1`,
    );
    // Only the policy helpers are callable by API roles.
    expect(grants.rows.map((r) => r.routine_name)).toEqual(["has_org_role", "is_org_member", "store_is_active"]);
  });
});

describe("member (organization A) vs tenant B", () => {
  it("sees only its own organization's rows, including private store fields", async () => {
    expect(await count(owner, "organizations")).toBe(1);
    expect(await count(owner, "stores")).toBe(2);
    expect(await count(owner, "memberships")).toBe(4);
    expect(await count(owner, "stores", `organization_id = '${ids.orgB}'`)).toBe(0);
    const { rows } = await as<{ contact_email: string }>(db, owner, `select contact_email from public.stores where id = '${ids.storeA}'`);
    expect(rows[0]?.contact_email).toBe("secret-a@example.test");
  });

  it("cannot read tenant B by id, even with an overlapping-looking identifier", async () => {
    expect((await as(db, owner, `select * from public.stores where id = '${ids.storeB}'`)).rows).toEqual([]);
    expect((await as(db, owner, `select * from public.organizations where id = '${ids.orgB}'`)).rows).toEqual([]);
    expect((await as(db, ownerOfB, `select * from public.stores where id = '${ids.storeA}'`)).rows).toEqual([]);
  });

  it("cannot update or delete tenant B rows (zero rows affected, data unchanged)", async () => {
    expect((await as(db, owner, `update public.stores set name = 'pwned' where id = '${ids.storeB}'`)).affectedRows).toBe(0);
    expect((await as(db, owner, `update public.organizations set name = 'pwned' where id = '${ids.orgB}'`)).affectedRows).toBe(0);
    expect((await as(db, owner, `delete from public.stores where id = '${ids.storeB}'`)).affectedRows).toBe(0);
    expect((await as(db, owner, `delete from public.memberships where organization_id = '${ids.orgB}'`)).affectedRows).toBe(0);
    expect((await as(db, service, `select name from public.stores where id = '${ids.storeB}'`)).rows).toEqual([{ name: "Main Store" }]);
    expect(await count(service, "memberships", `organization_id = '${ids.orgB}'`)).toBe(1);
  });

  it("rejects forged tenant IDs on insert", async () => {
    const forgedStore = await rejection(
      as(db, owner, `insert into public.stores (organization_id, slug, name) values ('${ids.orgB}', 'forged-store', 'x')`),
    );
    expect(forgedStore.code).toBe(PERMISSION);
    const forgedMember = await rejection(
      as(db, owner, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgB}', '${ids.ownerA}', 'owner')`),
    );
    expect(forgedMember.code).toBe(PERMISSION);
    const forgedProfile = await rejection(
      as(db, owner, `insert into public.store_public_profiles (store_id, display_name, default_locale, currency) values ('${ids.storeB}', 'x', 'en', 'USD')`),
    );
    expect(forgedProfile.code).toBe(PERMISSION);
    expect(await count(service, "stores")).toBe(3);
  });

  it("cannot move a store or membership between tenants or change identifiers", async () => {
    for (const sql of [
      `update public.stores set organization_id = '${ids.orgB}' where id = '${ids.storeA}'`,
      `update public.stores set id = '${ids.storeB}' where id = '${ids.storeA}'`,
      `update public.memberships set organization_id = '${ids.orgB}' where user_id = '${ids.staffA}'`,
      `update public.memberships set user_id = '${ids.ownerB}' where user_id = '${ids.staffA}'`,
      `update public.store_public_profiles set store_id = '${ids.storeB}' where store_id = '${ids.storeA}'`,
    ]) {
      expect((await rejection(as(db, owner, sql))).code, sql).toBe(PERMISSION);
    }
  });

  it("cannot forge created_by", async () => {
    await as(db, owner, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', 'staff')`);
    const { rows } = await as<{ created_by: string }>(db, service, `select created_by from public.memberships where user_id = '${ids.outsider}'`);
    expect(rows[0]?.created_by).toBe(ids.ownerA);
    expect((await rejection(as(db, owner, `update public.memberships set created_by = '${ids.ownerB}'`))).code).toBe(PERMISSION);
  });
});

describe("authenticated non-member", () => {
  it("sees no tenant rows and only active public profiles", async () => {
    for (const table of ["organizations", "memberships", "stores"]) {
      expect(await count(outsider, table), table).toBe(0);
    }
    expect(await count(outsider, "store_public_profiles")).toBe(2);
  });

  it("cannot add itself to an organization or write tenant data", async () => {
    for (const role of ["staff", "admin", "owner"]) {
      const error = await rejection(
        as(db, outsider, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', '${role}')`),
      );
      expect(error.code, role).toBe(PERMISSION);
    }
    expect((await rejection(as(db, outsider, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'sneaky', 'x')`))).code).toBe(PERMISSION);
    expect((await rejection(as(db, outsider, `insert into public.organizations (name) values ('direct')`))).code).toBe(PERMISSION);
    expect((await as(db, outsider, `update public.stores set name = 'x'`)).affectedRows).toBe(0);
    expect((await as(db, outsider, `delete from public.stores`)).affectedRows).toBe(0);
  });

  it("cannot create organizations: only the trusted server can, naming the owner explicitly", async () => {
    // Shoppers are authenticated users too, so no API role may bootstrap a tenant.
    const call = `select public.create_organization('Fresh Co', '${ids.outsider}') as id`;
    expect((await rejection(as(db, outsider, call))).code).toBe(PERMISSION);
    expect((await rejection(as(db, owner, `select public.create_organization('Mine', '${ids.ownerA}')`))).code).toBe(PERMISSION);

    const { rows } = await as<{ id: string }>(db, service, call);
    const orgId = rows[0]?.id;
    expect(await count(outsider, "organizations", `id = '${orgId}'`)).toBe(1);
    const roles = await as<{ role: string; user_id: string }>(db, service, `select role, user_id from public.memberships where organization_id = '${orgId}'`);
    expect(roles.rows).toEqual([{ role: "owner", user_id: ids.outsider }]);

    expect((await rejection(as(db, service, "select public.create_organization('', gen_random_uuid())"))).code).toBe("23514");
    expect((await rejection(as(db, service, "select public.create_organization('Orphan', gen_random_uuid())"))).code).toBe("23503");
    expect(await count(service, "organizations", "name = 'Orphan'")).toBe(0);
  });

  it("is not tricked by forged claims, user_metadata or unknown subjects", async () => {
    const forged = user(ids.outsider, {
      role: "service_role",
      organization_id: ids.orgA,
      app_metadata: { role: "owner", organization_id: ids.orgA },
      user_metadata: { role: "owner", organization_id: ids.orgA },
    });
    expect(await count(forged, "stores")).toBe(0);
    expect((await rejection(as(db, forged, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'claims-store', 'x')`))).code).toBe(PERMISSION);
    expect(await count(user("00000000-0000-4000-8000-0000000000ff"), "organizations")).toBe(0);
  });

  it("loses access immediately when membership is revoked, despite a still-valid token", async () => {
    expect(await count(staff, "stores")).toBe(2);
    await as(db, owner, `delete from public.memberships where user_id = '${ids.staffA}'`);
    expect(await count(staff, "stores")).toBe(0);
    expect((await rejection(as(db, staff, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'after-revoke', 'x')`))).code).toBe(PERMISSION);
  });
});

describe("roles and membership transitions", () => {
  it("staff can read the organization but cannot change configuration or membership", async () => {
    expect(await count(staff, "stores")).toBe(2);
    expect((await rejection(as(db, staff, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'staff-store', 'x')`))).code).toBe(PERMISSION);
    expect((await as(db, staff, `update public.stores set name = 'x'`)).affectedRows).toBe(0);
    expect((await as(db, staff, `update public.store_public_profiles set display_name = 'x'`)).affectedRows).toBe(0);
    expect((await rejection(as(db, staff, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', 'staff')`))).code).toBe(PERMISSION);
    expect((await as(db, staff, `update public.memberships set role = 'owner' where user_id = '${ids.staffA}'`)).affectedRows).toBe(0);
    expect((await as(db, staff, `delete from public.memberships where user_id = '${ids.adminA}'`)).affectedRows).toBe(0);
    expect((await as(db, staff, `delete from public.organizations`)).affectedRows).toBe(0);
  });

  it("admin manages stores and staff only", async () => {
    await as(db, admin, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'admin-store', 'Admin Store')`);
    expect((await as(db, admin, `update public.store_public_profiles set display_name = 'New' where store_id = '${ids.storeA}'`)).affectedRows).toBe(1);
    await as(db, admin, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', 'staff')`);
    expect((await as(db, admin, `delete from public.memberships where user_id = '${ids.outsider}'`)).affectedRows).toBe(1);

    for (const role of ["admin", "owner"]) {
      expect((await rejection(as(db, admin, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', '${role}')`))).code, role).toBe(PERMISSION);
    }
    expect((await rejection(as(db, admin, `update public.memberships set role = 'admin' where user_id = '${ids.staffA}'`))).code).toBe(PERMISSION);
    expect((await as(db, admin, `update public.memberships set role = 'owner' where user_id = '${ids.adminA}'`)).affectedRows).toBe(0);
    expect((await as(db, admin, `update public.memberships set role = 'staff' where user_id = '${ids.ownerA}'`)).affectedRows).toBe(0);
    expect((await as(db, admin, `delete from public.memberships where user_id = '${ids.ownerA}'`)).affectedRows).toBe(0);
    expect((await as(db, admin, `delete from public.stores where id = '${ids.storeA}'`)).affectedRows).toBe(0);
    expect((await as(db, admin, `update public.organizations set name = 'x'`)).affectedRows).toBe(0);
    expect(await count(service, "memberships", `organization_id = '${ids.orgA}'`)).toBe(4);
  });

  it("admin also manages managers, but cannot create or touch admins and owners", async () => {
    await as(db, admin, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', 'manager')`);
    expect((await as(db, admin, `update public.memberships set role = 'staff' where user_id = '${ids.outsider}'`)).affectedRows).toBe(1);
    expect((await as(db, admin, `update public.memberships set role = 'manager' where user_id = '${ids.staffA}'`)).affectedRows).toBe(1);
    expect((await as(db, admin, `delete from public.memberships where user_id = '${ids.managerA}'`)).affectedRows).toBe(1);
    // Promoting a manager to admin or owner is not allowed.
    for (const role of ["admin", "owner"]) {
      expect((await rejection(as(db, admin, `update public.memberships set role = '${role}' where user_id = '${ids.staffA}'`))).code, role).toBe(PERMISSION);
    }
  });

  it("manager can read the organization but cannot change settings, public profiles or membership", async () => {
    expect(await count(manager, "stores")).toBe(2);
    expect(await count(manager, "memberships")).toBe(4);
    expect((await rejection(as(db, manager, `insert into public.stores (organization_id, slug, name) values ('${ids.orgA}', 'manager-store', 'x')`))).code).toBe(PERMISSION);
    expect((await as(db, manager, `update public.stores set name = 'x'`)).affectedRows).toBe(0);
    expect((await as(db, manager, `update public.store_public_profiles set display_name = 'x'`)).affectedRows).toBe(0);
    expect((await as(db, manager, `delete from public.store_public_profiles`)).affectedRows).toBe(0);
    for (const role of ["staff", "manager"]) {
      expect((await rejection(as(db, manager, `insert into public.memberships (organization_id, user_id, role) values ('${ids.orgA}', '${ids.outsider}', '${role}')`))).code, role).toBe(PERMISSION);
    }
    expect((await as(db, manager, `update public.memberships set role = 'admin' where user_id = '${ids.managerA}'`)).affectedRows).toBe(0);
    expect((await as(db, manager, `update public.memberships set role = 'staff' where user_id = '${ids.staffA}'`)).affectedRows).toBe(0);
    expect((await as(db, manager, `delete from public.memberships where user_id = '${ids.staffA}'`)).affectedRows).toBe(0);
    expect((await as(db, manager, `update public.organizations set name = 'x'`)).affectedRows).toBe(0);
    // A manager may leave the organization.
    expect((await as(db, manager, `delete from public.memberships where user_id = '${ids.managerA}'`)).affectedRows).toBe(1);
  });

  it("owner manages roles, and any member may leave", async () => {
    await as(db, owner, `update public.memberships set role = 'admin' where user_id = '${ids.staffA}'`);
    await as(db, owner, `update public.memberships set role = 'owner' where user_id = '${ids.adminA}'`);
    expect((await as(db, user(ids.adminA), `update public.organizations set name = 'Renamed'`)).affectedRows).toBe(1);
    expect((await as(db, staff, `delete from public.memberships where user_id = '${ids.staffA}'`)).affectedRows).toBe(1);
  });

  it("keeps at least one owner on demotion and removal", async () => {
    for (const sql of [
      `update public.memberships set role = 'admin' where user_id = '${ids.ownerA}'`,
      `delete from public.memberships where user_id = '${ids.ownerA}'`,
    ]) {
      const error = await rejection(as(db, owner, sql));
      expect(error.message).toContain("at least one owner");
    }
    expect((await rejection(as(db, service, `delete from public.memberships where user_id = '${ids.ownerA}'`))).message).toContain("at least one owner");
    // Once a second owner exists, the first may step down.
    await as(db, owner, `update public.memberships set role = 'owner' where user_id = '${ids.adminA}'`);
    expect((await as(db, owner, `update public.memberships set role = 'staff' where user_id = '${ids.ownerA}'`)).affectedRows).toBe(1);
    // ...and now the remaining owner is protected.
    const error = await rejection(as(db, admin, `update public.memberships set role = 'staff' where user_id = '${ids.adminA}'`));
    expect(error.message).toContain("at least one owner");
  });

  it("deleting an organization removes its memberships and stores and nothing else", async () => {
    expect((await as(db, owner, `delete from public.organizations where id = '${ids.orgA}'`)).affectedRows).toBe(1);
    expect(await count(service, "memberships", `organization_id = '${ids.orgA}'`)).toBe(0);
    expect(await count(service, "stores", `organization_id = '${ids.orgA}'`)).toBe(0);
    expect(await count(service, "stores", `organization_id = '${ids.orgB}'`)).toBe(1);
  });

  it("rejects a user deletion that would orphan an organization", async () => {
    // Run as the database owner: real Supabase deletes users via the Auth service, not service_role.
    const error = await rejection(db.query(`delete from auth.users where id = '${ids.ownerB}'`));
    expect(error.message).toContain("at least one owner");
    expect(await count(service, "memberships", `organization_id = '${ids.orgB}'`)).toBe(1);
  });
});

describe("public vs private store data and suspension", () => {
  it("keeps private fields out of the public table and shows draft profiles only to members", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'store_public_profiles'`,
    );
    expect(columns.rows.map((r) => r.column_name).sort()).toEqual(
      ["currency", "default_locale", "display_name", "homepage_mode", "store_id", "updated_at"],
    );
    expect(await count(owner, "store_public_profiles", `store_id = '${ids.storeADraft}'`)).toBe(1);
    expect(await count(anon, "store_public_profiles", `store_id = '${ids.storeADraft}'`)).toBe(0);
    expect(await count(outsider, "store_public_profiles", `store_id = '${ids.storeADraft}'`)).toBe(0);
  });

  it("merchants cannot suspend a store or lift a suspension; the platform can", async () => {
    expect((await rejection(as(db, owner, `update public.stores set status = 'suspended' where id = '${ids.storeA}'`))).code).toBe(PERMISSION);
    expect((await rejection(as(db, owner, `insert into public.stores (organization_id, slug, name, status) values ('${ids.orgA}', 'born-suspended', 'x', 'suspended')`))).code).toBe(PERMISSION);
    await as(db, service, `update public.stores set status = 'suspended' where id = '${ids.storeA}'`);
    expect(await count(anon, "store_public_profiles", `store_id = '${ids.storeA}'`)).toBe(0);
    expect((await rejection(as(db, owner, `update public.stores set status = 'active' where id = '${ids.storeA}'`))).code).toBe(PERMISSION);
    // Other edits to a suspended store remain allowed for members.
    expect((await as(db, owner, `update public.stores set name = 'Renamed' where id = '${ids.storeA}'`)).affectedRows).toBe(1);
  });

  it("enforces unique slugs across tenants without leaking the other tenant's store", async () => {
    const error = await rejection(as(db, ownerOfB, `insert into public.stores (organization_id, slug, name) values ('${ids.orgB}', 'main-a', 'x')`));
    expect(error.code).toBe("23505");
  });
});

describe("service context", () => {
  it("bypasses RLS across tenants, which is why the service-role key is server-only", async () => {
    expect(await count(service, "organizations")).toBe(2);
    expect(await count(service, "stores")).toBe(3);
  });
});

describe("migration replay and rollback", () => {
  it("replays on an empty database and the manual rollback restores a clean slate that replays again", async () => {
    const fresh = await newDatabase();
    try {
      await fresh.exec(readFileSync(rollbackFile, "utf8"));
      const left = await fresh.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`,
      );
      expect(left.rows).toEqual([]);
      for (const file of migrationFiles()) {
        await fresh.exec(readFileSync(`${migrationsDir}/${file}`, "utf8"));
      }
      await seed(fresh);
      const stores = await fresh.query<{ n: number }>("select count(*)::int as n from public.stores");
      expect(stores.rows[0]?.n).toBe(3);
    } finally {
      await fresh.close();
    }
  });
});
