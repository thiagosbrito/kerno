import { describe, expect, it } from "vitest";
import { createSupabaseDirectory } from "./supabase-directory";

// Runs the real directory against a seeded local Supabase stack (PostgREST + grants + schema).
// Skipped locally unless KERNO_TEST_SUPABASE_URL and KERNO_TEST_SUPABASE_ANON_KEY are set; the Browser CI job runs it against the seeded stack.
//   pnpm db:reset && KERNO_TEST_SUPABASE_URL=http://127.0.0.1:54321 KERNO_TEST_SUPABASE_ANON_KEY=<anon> pnpm --filter @kerno/server test
const url = process.env.KERNO_TEST_SUPABASE_URL;
const anonKey = process.env.KERNO_TEST_SUPABASE_ANON_KEY;

// The Browser CI job sets KERNO_REQUIRE_STACK_TESTS=1 so a missing stack fails instead of skipping.
if (process.env.KERNO_REQUIRE_STACK_TESTS && (!url || !anonKey)) throw new Error("directory integration test requires the seeded local stack");

describe.skipIf(!url || !anonKey)("directory against the seeded local stack", () => {
  const dir = createSupabaseDirectory({ url: url ?? "", anonKey: anonKey ?? "" });

  it("resolves the three seeded stores by slug and the verified custom domain by host", async () => {
    for (const slug of ["acme-sneakers", "acme-books", "acme-plants"]) {
      const found = await dir.bySlug(slug);
      expect(found.status, slug).toBe("found");
    }
    const custom = await dir.byHost("shop.acme-sneakers.test");
    expect(custom).toMatchObject({ status: "found", store: { slug: "acme-sneakers", canonicalHostname: "shop.acme-sneakers.test" } });
  });

  it("does not resolve pending, draft, suspended or unknown hosts", async () => {
    expect(await dir.byHost("pending.acme-books.test")).toEqual({ status: "not_found" });
    expect(await dir.byHost("shop.acme-suspended.test")).toEqual({ status: "not_found" });
    expect(await dir.bySlug("acme-draft")).toEqual({ status: "not_found" });
    expect(await dir.bySlug("acme-suspended")).toEqual({ status: "not_found" });
    expect(await dir.byHost("nobody.example.test")).toEqual({ status: "not_found" });
  });

  it("reads each store's public profile", async () => {
    const found = await dir.bySlug("acme-books");
    if (found.status !== "found") throw new Error("seed missing");
    expect(await dir.profile(found.store.storeId)).toMatchObject({ status: "found", profile: { displayName: "Acme Livros", currency: "BRL" } });
  });
});
