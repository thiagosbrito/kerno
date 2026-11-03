import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { anon, as, type Db, ids, newDatabase, rejection, seed, service, user } from "./harness";

const PERMISSION = "42501";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const PLATFORM = "kerno.app";

const owner = user(ids.ownerA);
const ownerOfB = user(ids.ownerB);
const outsider = user(ids.outsider);

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

const claim = (store: string, host: string, platform = PLATFORM) =>
  as<{ domain_id: string; verification_token: string }>(db, service, "select * from public.claim_domain($1, $2, $3)", [store, host, platform]);
const confirm = (domain: string, primary = false) =>
  as(db, service, "select public.confirm_domain($1, $2)", [domain, primary]);
const verified = async (store: string, host: string, primary = false) => {
  const id = (await claim(store, host)).rows[0]?.domain_id as string;
  await confirm(id, primary);
  return id;
};
const byHost = (ctx: Parameters<typeof as>[1], host: string) =>
  as<{ store_id: string; slug: string; canonical_hostname: string | null }>(db, ctx, "select * from public.resolve_store_by_host($1)", [host]);
const bySlug = (ctx: Parameters<typeof as>[1], slug: string) =>
  as<{ store_id: string; slug: string; canonical_hostname: string | null }>(db, ctx, "select * from public.resolve_store_by_slug($1)", [slug]);

describe("host resolution", () => {
  it("resolves only a verified hostname of an active store, for any API role", async () => {
    await verified(ids.storeA, "shop.a.example.test", true);
    for (const ctx of [anon, outsider, owner, ownerOfB, service]) {
      const { rows } = await byHost(ctx, "shop.a.example.test");
      expect(rows).toEqual([{ store_id: ids.storeA, slug: "main-a", canonical_hostname: "shop.a.example.test" }]);
    }
  });

  it("never resolves a pending (unverified) claim", async () => {
    await claim(ids.storeA, "pending.a.example.test");
    expect((await byHost(anon, "pending.a.example.test")).rows).toEqual([]);
  });

  it("does not resolve hostnames of draft or suspended stores, and stops when a store is suspended", async () => {
    await verified(ids.storeADraft, "draft.a.example.test");
    expect((await byHost(anon, "draft.a.example.test")).rows).toEqual([]);
    await verified(ids.storeA, "live.a.example.test");
    expect((await byHost(anon, "live.a.example.test")).rows).toHaveLength(1);
    await as(db, service, `update public.stores set status = 'suspended' where id = '${ids.storeA}'`);
    expect((await byHost(anon, "live.a.example.test")).rows).toEqual([]);
    expect((await bySlug(anon, "main-a")).rows).toEqual([]);
  });

  it("matches exactly: unnormalized spellings do not resolve (callers must normalize)", async () => {
    await verified(ids.storeA, "shop.a.example.test");
    for (const host of ["Shop.A.Example.Test", "shop.a.example.test.", "shop.a.example.test:443", " shop.a.example.test", "shop.a.example.test\n", "x.shop.a.example.test", "shop.a.example.test@evil.test"]) {
      expect((await byHost(anon, host)).rows, JSON.stringify(host)).toEqual([]);
    }
  });

  it("resolves platform slugs for active stores only, case-sensitively, with no private fields", async () => {
    const { rows } = await bySlug(anon, "main-a");
    expect(rows).toEqual([{ store_id: ids.storeA, slug: "main-a", canonical_hostname: null }]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["canonical_hostname", "slug", "store_id"]);
    expect((await bySlug(anon, "draft-a")).rows).toEqual([]);
    expect((await bySlug(anon, "MAIN-A")).rows).toEqual([]);
    expect((await bySlug(anon, "nope")).rows).toEqual([]);
  });

  it("keeps two stores' hostnames separate", async () => {
    await verified(ids.storeA, "a.example.test");
    await verified(ids.storeB, "b.example.test");
    expect((await byHost(anon, "a.example.test")).rows[0]?.store_id).toBe(ids.storeA);
    expect((await byHost(anon, "b.example.test")).rows[0]?.store_id).toBe(ids.storeB);
  });
});

describe("claims and duplicate claims", () => {
  it("is idempotent for the same store and hostname", async () => {
    const first = await claim(ids.storeA, "shop.a.example.test");
    const again = await claim(ids.storeA, "shop.a.example.test");
    expect(again.rows).toEqual(first.rows);
    expect(first.rows[0]?.verification_token).toHaveLength(64);
    expect(await countDomains("hostname = 'shop.a.example.test'")).toBe(1);
  });

  it("lets two stores hold pending claims, but only the first verification wins", async () => {
    const a = (await claim(ids.storeA, "shared.example.test")).rows[0]?.domain_id as string;
    const b = (await claim(ids.storeB, "shared.example.test")).rows[0]?.domain_id as string;
    expect((await byHost(anon, "shared.example.test")).rows).toEqual([]);
    await confirm(a);
    expect((await rejection(confirm(b))).code).toBe(UNIQUE_VIOLATION);
    expect((await byHost(anon, "shared.example.test")).rows[0]?.store_id).toBe(ids.storeA);
    // Once verified elsewhere, a fresh claim is refused outright.
    expect((await rejection(claim(ids.storeADraft, "shared.example.test"))).code).toBe(UNIQUE_VIOLATION);
  });

  it("reserves the platform domain and everything under it, but not lookalikes", async () => {
    for (const host of ["kerno.app", "shop.kerno.app", "a.b.kerno.app"]) {
      expect((await rejection(claim(ids.storeA, host))).code, host).toBe(PERMISSION);
    }
    for (const host of ["evilkerno.app", "kerno.app.evil.test", "kerno.apps.test"]) {
      await claim(ids.storeA, host);
    }
    expect((await rejection(claim(ids.storeA, "x.example.test", ""))).code).toBe("22023");
  });

  it("rejects malformed hostnames at the table level", async () => {
    const bad = [
      "Shop.Example.Test", // uppercase
      "shop.example.test.", // trailing dot
      "shop.example.test:8080", // port
      "user@shop.example.test", // userinfo
      "127.0.0.1", // IPv4 literal
      "2130706433", // numeric host
      "[::1]", // IPv6 literal
      "localhost", // single label
      "-bad.example.test", // leading hyphen
      "bad_name.example.test", // underscore
      "a..example.test", // empty label
      "shop.example.test/path", // path
      "shop.example.test\nHost: evil.test", // header injection
      `${"a".repeat(64)}.example.test`, // label too long
      `${"a.".repeat(130)}test`, // total too long
      "shop.example.1", // numeric TLD
      "bücher.example.test", // not punycode
    ];
    for (const host of bad) {
      expect((await rejection(claim(ids.storeA, host))).code, JSON.stringify(host)).toBe(CHECK_VIOLATION);
    }
    await claim(ids.storeA, "xn--bcher-kva.example.test"); // punycode is fine
  });

  it("requires verification before a hostname can be primary, with one primary per store", async () => {
    const unverified = (await claim(ids.storeA, "one.a.example.test")).rows[0]?.domain_id as string;
    expect((await rejection(as(db, service, `update public.store_domains set is_primary = true where id = '${unverified}'`))).code).toBe(CHECK_VIOLATION);
    const first = await verified(ids.storeA, "first.a.example.test", true);
    const second = await verified(ids.storeA, "second.a.example.test", true);
    const primaries = await as<{ id: string }>(db, service, `select id from public.store_domains where store_id = '${ids.storeA}' and is_primary`);
    expect(primaries.rows).toEqual([{ id: second }]);
    expect(first).not.toBe(second);
    expect((await byHost(anon, "first.a.example.test")).rows[0]?.canonical_hostname).toBe("second.a.example.test");
    expect((await bySlug(anon, "main-a")).rows[0]?.canonical_hostname).toBe("second.a.example.test");
  });

  it("stops resolving once released, and removes claims with the store", async () => {
    const id = await verified(ids.storeA, "shop.a.example.test");
    await as(db, service, "select public.release_domain($1)", [id]);
    expect((await byHost(anon, "shop.a.example.test")).rows).toEqual([]);
    await verified(ids.storeA, "again.a.example.test");
    await as(db, service, `delete from public.stores where id = '${ids.storeA}'`);
    expect(await countDomains(`store_id = '${ids.storeA}'`)).toBe(0);
    await expect(confirm("00000000-0000-4000-8000-00000000dead")).rejects.toMatchObject({ code: "P0002" });
  });
});

describe("access control", () => {
  it("hides store_domains from anonymous and non-members, and across tenants", async () => {
    await claim(ids.storeA, "shop.a.example.test");
    await claim(ids.storeB, "shop.b.example.test");
    expect((await rejection(as(db, anon, "select * from public.store_domains"))).code).toBe(PERMISSION);
    expect((await as(db, outsider, "select * from public.store_domains")).rows).toEqual([]);
    const own = await as<{ hostname: string }>(db, owner, "select hostname from public.store_domains");
    expect(own.rows).toEqual([{ hostname: "shop.a.example.test" }]);
    const other = await as<{ hostname: string }>(db, ownerOfB, "select hostname from public.store_domains");
    expect(other.rows).toEqual([{ hostname: "shop.b.example.test" }]);
  });

  it("has no API write path: members cannot insert, verify, re-point or delete claims", async () => {
    const id = (await claim(ids.storeA, "shop.a.example.test")).rows[0]?.domain_id as string;
    const stmts = [
      `insert into public.store_domains (store_id, hostname, verified_at) values ('${ids.storeA}', 'x.a.example.test', now())`,
      `insert into public.store_domains (store_id, hostname) values ('${ids.storeB}', 'y.b.example.test')`,
      `update public.store_domains set verified_at = now() where id = '${id}'`,
      `update public.store_domains set store_id = '${ids.storeB}' where id = '${id}'`,
      `delete from public.store_domains where id = '${id}'`,
    ];
    for (const sql of stmts) {
      for (const ctx of [owner, outsider, anon]) {
        expect((await rejection(as(db, ctx, sql))).code, sql).toBe(PERMISSION);
      }
    }
    expect((await byHost(anon, "shop.a.example.test")).rows).toEqual([]);
  });

  it("keeps claim, confirm and release server-only", async () => {
    const calls = [
      `select public.claim_domain('${ids.storeA}', 'x.a.example.test', '${PLATFORM}')`,
      `select public.confirm_domain('${ids.storeA}', false)`,
      `select public.release_domain('${ids.storeA}')`,
    ];
    for (const sql of calls) {
      for (const ctx of [anon, outsider, owner]) {
        expect((await rejection(as(db, ctx, sql))).code, sql).toBe(PERMISSION);
      }
    }
  });
});

async function countDomains(where: string): Promise<number> {
  const { rows } = await as<{ n: number }>(db, service, `select count(*)::int as n from public.store_domains where ${where}`);
  return rows[0]?.n ?? 0;
}
