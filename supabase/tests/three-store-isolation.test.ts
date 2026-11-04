import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anon, as, type Context, type Db, migrationFiles, migrationsDir, newDatabase, rejection, service, user } from "./harness";

// THI-67: the two-tenant suites prove each control; this one proves the three-store POC as a full
// 3x3 matrix. Identifiers differ only in the last hex digit on purpose (overlapping-looking).
const PERMISSION = "42501";
const T = ["1", "2", "3"] as const;
type Tenant = (typeof T)[number];
const id = (prefix: string, tenant: Tenant, kind = "0") => `${prefix}0000000-0000-4000-8000-00000000${kind}0c${tenant}`;
const org = (t: Tenant) => id("1", t);
const store = (t: Tenant) => id("2", t);
const draftStore = (t: Tenant) => id("2", t, "1");
const owner = (t: Tenant) => id("3", t);
const staff = (t: Tenant) => id("4", t);
const host = (t: Tenant) => `shop-${t}.tenant-matrix.test`;
const pairs = T.flatMap((viewer) => T.filter((target) => target !== viewer).map((target) => [viewer, target] as const));
const asOwner = (t: Tenant): Context => user(owner(t));

let db: Db;
beforeAll(async () => {
  db = await newDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(`
    truncate public.organizations, auth.users cascade;
    ${T.map((t) => `insert into auth.users (id, email) values ('${owner(t)}', 'owner-${t}@example.test'), ('${staff(t)}', 'staff-${t}@example.test');`).join("\n")}
    ${T.map((t) => `insert into public.organizations (id, name) values ('${org(t)}', 'Acme Goods');`).join("\n")}
    ${T.map((t) => `insert into public.memberships (organization_id, user_id, role) values ('${org(t)}', '${owner(t)}', 'owner'), ('${org(t)}', '${staff(t)}', 'staff');`).join("\n")}
    ${T.map(
      (t) => `insert into public.stores (id, organization_id, slug, name, status, contact_email, internal_notes) values
        ('${store(t)}', '${org(t)}', 'matrix-${t}', 'Main Store', 'active', 'secret-${t}@example.test', 'private note ${t}'),
        ('${draftStore(t)}', '${org(t)}', 'matrix-draft-${t}', 'Draft Store', 'draft', null, 'private draft ${t}');
      insert into public.store_public_profiles (store_id, display_name, default_locale, currency, homepage_mode) values
        ('${store(t)}', 'Main Store ${t}', '${["en", "pt-BR", "pl"][Number(t) - 1]}', '${["USD", "BRL", "PLN"][Number(t) - 1]}', 'landing'),
        ('${draftStore(t)}', 'Draft ${t}', 'en', 'USD', 'landing');`,
    ).join("\n")}
  `);
  for (const t of T) {
    const domain = (await as<{ domain_id: string }>(db, service, "select * from public.claim_domain($1, $2, $3)", [store(t), host(t), "kerno.app"])).rows[0]?.domain_id;
    await as(db, service, "select public.confirm_domain($1, true)", [domain]);
  }
});

const rows = async (ctx: Context, sql: string, params: unknown[] = []) => (await as(db, ctx, sql, params)).rows;

describe("each tenant sees exactly its own rows", () => {
  for (const t of T) {
    it(`owner of tenant ${t} reads only tenant ${t} across every tenant table`, async () => {
      const ctx = asOwner(t);
      expect((await rows(ctx, "select id from public.organizations")).map((r) => r.id)).toEqual([org(t)]);
      expect((await rows(ctx, "select id from public.stores order by id")).map((r) => r.id)).toEqual([store(t), draftStore(t)]);
      expect((await rows(ctx, "select organization_id from public.memberships")).every((r) => r.organization_id === org(t))).toBe(true);
      expect((await rows(ctx, "select store_id from public.store_domains")).map((r) => r.store_id)).toEqual([store(t)]);
      // Non-empty on purpose: the fixture's own changes were audited, so an empty result would mean a broken policy.
      const audit = await rows(ctx, "select organization_id from public.audit_events");
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.every((r) => r.organization_id === org(t))).toBe(true);
    });
  }
});

describe("cross-tenant reads fail for every ordered pair", () => {
  for (const [viewer, target] of pairs) {
    it(`tenant ${viewer} cannot read tenant ${target} (owner and staff, by id and by scan)`, async () => {
      for (const ctx of [asOwner(viewer), user(staff(viewer))]) {
        expect(await rows(ctx, "select 1 from public.organizations where id = $1", [org(target)])).toEqual([]);
        expect(await rows(ctx, "select 1 from public.stores where id = $1 or organization_id = $2", [store(target), org(target)])).toEqual([]);
        expect(await rows(ctx, "select 1 from public.memberships where organization_id = $1 or user_id = $2", [org(target), owner(target)])).toEqual([]);
        expect(await rows(ctx, "select 1 from public.store_domains where store_id = $1 or hostname = $2", [store(target), host(target)])).toEqual([]);
        expect(await rows(ctx, "select 1 from public.audit_events where organization_id = $1", [org(target)])).toEqual([]);
        // Control: the rows being hidden really exist.
        expect((await rows(service, "select 1 from public.audit_events where organization_id = $1", [org(target)])).length).toBeGreaterThan(0);
        // Private fields never reach another tenant; the draft profile is invisible too.
        expect(await rows(ctx, "select 1 from public.store_public_profiles where store_id = $1", [draftStore(target)])).toEqual([]);
      }
    });
  }
});

describe("cross-tenant writes fail for every ordered pair", () => {
  for (const [viewer, target] of pairs) {
    it(`tenant ${viewer} cannot modify, delete, forge or take over tenant ${target}`, async () => {
      const ctx = asOwner(viewer);
      const update = async (sql: string, params: unknown[]) => (await as(db, ctx, sql, params)).affectedRows;
      expect(await update("update public.stores set name = 'pwned' where id = $1", [store(target)])).toBe(0);
      expect(await update("update public.store_public_profiles set display_name = 'pwned' where store_id = $1", [store(target)])).toBe(0);
      expect(await update("update public.organizations set name = 'pwned' where id = $1", [org(target)])).toBe(0);
      expect(await update("update public.memberships set role = 'owner' where user_id = $1", [staff(target)])).toBe(0);
      expect(await update("delete from public.memberships where organization_id = $1", [org(target)])).toBe(0);
      expect(await update("delete from public.stores where id = $1", [store(target)])).toBe(0);
      expect(await update("delete from public.organizations where id = $1", [org(target)])).toBe(0);
      // Forged tenant identifiers on insert, and re-parenting an own store into the other tenant.
      await expect(
        rejection(as(db, ctx, "insert into public.stores (organization_id, slug, name) values ($1, 'forged', 'x')", [org(target)])),
      ).resolves.toMatchObject({ code: PERMISSION });
      // The target's draft profile is removed first so a primary-key clash cannot mask a missing RLS check.
      await as(db, service, "delete from public.store_public_profiles where store_id = $1", [draftStore(target)]);
      await expect(
        rejection(as(db, ctx, "insert into public.store_public_profiles (store_id, display_name, default_locale, currency) values ($1, 'x', 'en', 'USD')", [draftStore(target)])),
      ).resolves.toMatchObject({ code: PERMISSION });
      await expect(
        rejection(as(db, ctx, "update public.stores set organization_id = $1 where id = $2", [org(target), store(viewer)])),
      ).resolves.toMatchObject({ code: PERMISSION });
      // Server-only entry points are not callable by an authenticated merchant.
      await expect(
        rejection(as(db, ctx, "select public.add_member($1, $2, 'owner', $3)", [org(target), owner(viewer), owner(viewer)])),
      ).resolves.toMatchObject({ code: PERMISSION });
      await expect(rejection(as(db, ctx, "select public.claim_domain($1, 'evil.test', 'kerno.app')", [store(target)]))).resolves.toMatchObject({ code: PERMISSION });
      // Nothing changed for the victim.
      const after = await rows(service, "select name, (select display_name from public.store_public_profiles where store_id = $1) as dn from public.stores where id = $1", [store(target)]);
      expect(after).toEqual([{ name: "Main Store", dn: `Main Store ${target}` }]);
      expect(await rows(service, "select 1 from public.memberships where organization_id = $1", [org(target)])).toHaveLength(2);
    });
  }
});

describe("public (anonymous) surface across three stores", () => {
  it("lists exactly the three active public profiles with no private fields, never the drafts", async () => {
    const profiles = await rows(anon, "select * from public.store_public_profiles order by store_id");
    expect(profiles.map((p) => p.store_id)).toEqual(T.map(store));
    for (const p of profiles) expect(Object.keys(p).sort()).toEqual(["currency", "default_locale", "display_name", "homepage_mode", "store_id", "updated_at"]);
    expect(profiles.map((p) => [p.default_locale, p.currency])).toEqual([["en", "USD"], ["pt-BR", "BRL"], ["pl", "PLN"]]);
  });

  it("resolves each host and slug to its own store only", async () => {
    for (const t of T) {
      const byHost = await rows(anon, "select store_id, slug from public.resolve_store_by_host($1)", [host(t)]);
      expect(byHost).toEqual([{ store_id: store(t), slug: `matrix-${t}` }]);
      const bySlug = await rows(anon, "select store_id from public.resolve_store_by_slug($1)", [`matrix-${t}`]);
      expect(bySlug).toEqual([{ store_id: store(t) }]);
      expect(await rows(anon, "select 1 from public.resolve_store_by_slug($1)", [`matrix-draft-${t}`])).toEqual([]);
    }
  });

  it("stops resolving one tenant's host when only that tenant is suspended", async () => {
    await as(db, service, "update public.stores set status = 'suspended' where id = $1", [store("2")]);
    expect(await rows(anon, "select 1 from public.resolve_store_by_host($1)", [host("2")])).toEqual([]);
    expect(await rows(anon, "select 1 from public.resolve_store_by_host($1)", [host("1")])).toHaveLength(1);
    expect(await rows(anon, "select 1 from public.resolve_store_by_host($1)", [host("3")])).toHaveLength(1);
  });

  it("cannot read or write any tenant table (reads and writes both denied)", async () => {
    for (const table of ["organizations", "stores", "memberships", "store_domains", "audit_events"]) {
      await expect(rejection(as(db, anon, `select 1 from public.${table}`))).resolves.toMatchObject({ code: PERMISSION });
      await expect(rejection(as(db, anon, `delete from public.${table}`))).resolves.toMatchObject({ code: PERMISSION });
    }
  });
});

describe("audit trails are per tenant", () => {
  it("a change in tenant 2 is visible to its owner only", async () => {
    await as(db, asOwner("2"), "update public.organizations set name = 'Renamed' where id = $1", [org("2")]);
    const own = await rows(asOwner("2"), "select organization_id from public.audit_events");
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.organization_id === org("2"))).toBe(true);
    for (const t of ["1", "3"] as const) expect(await rows(asOwner(t), "select 1 from public.audit_events where organization_id = $1", [org("2")])).toEqual([]);
  });
});

describe("media paths (storage) are not yet exposed", () => {
  // Media upload and delivery arrive with THI-70. Until then no migration, seed or local config may
  // create a bucket, a storage policy or a public path, so there is no cross-tenant object path to
  // leak. THI-70 must replace this tripwire with per-tenant object-path policy tests for all three tenants.
  const strip = (sql: string) => sql.replace(/--.*$/gm, "").replace(/"/g, "");
  const STORAGE = /\bstorage\s*\.\s*(buckets|objects)\b|\bon\s+storage\b/i;

  it("has no storage buckets, policies or object paths in any migration or the seed", () => {
    const sqlDir = join(migrationsDir, "..");
    const files = [...migrationFiles().map((f) => join(migrationsDir, f)), join(sqlDir, "seed.sql")];
    for (const file of files) expect(strip(readFileSync(file, "utf8")), file).not.toMatch(STORAGE);
  });

  it("the tripwire matches quoted and spaced spellings", () => {
    for (const sql of ['create policy p on "storage"."objects" for select using (true);', "insert into storage . buckets (id) values ('x');"]) {
      expect(strip(sql)).toMatch(STORAGE);
    }
  });

  it("declares no local storage bucket in supabase/config.toml", () => {
    const config = readFileSync(join(migrationsDir, "..", "config.toml"), "utf8");
    expect(config.replace(/^\s*#.*$/gm, "")).not.toMatch(/^\s*\[storage\.buckets\./m);
  });
});
