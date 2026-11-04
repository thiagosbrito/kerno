import { describe, expect, it } from "vitest";
import { createSupabaseDirectory } from "./supabase-directory";

const STORE = { store_id: "20000000-0000-4000-8000-0000000000e1", slug: "acme-sneakers", canonical_hostname: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function directory(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return { requests, dir: createSupabaseDirectory({ url: "http://127.0.0.1:54321/", anonKey: "anon-key", fetchImpl }) };
}

describe("createSupabaseDirectory", () => {
  it("calls the host resolver RPC with the anon key and maps the row", async () => {
    const { dir, requests } = directory(() => json([STORE]));
    expect(await dir.byHost("shop.acme-sneakers.test")).toEqual({
      status: "found",
      store: { storeId: STORE.store_id, slug: "acme-sneakers", canonicalHostname: null },
    });
    const [request] = requests;
    expect(request?.url).toBe("http://127.0.0.1:54321/rest/v1/rpc/resolve_store_by_host");
    expect(JSON.parse(String(request?.init.body))).toEqual({ host: "shop.acme-sneakers.test" });
    expect(request?.init.headers).toMatchObject({ apikey: "anon-key", Authorization: "Bearer anon-key" });
    expect(request?.init.cache).toBe("no-store");
    expect(request?.init.redirect).toBe("error");
  });

  it("treats an empty result as not_found", async () => {
    const { dir } = directory(() => json([]));
    expect(await dir.bySlug("nope-store")).toEqual({ status: "not_found" });
  });

  it.each([
    ["HTTP 500", () => json({ message: "boom" }, 500)],
    ["HTTP 401", () => json({ message: "bad key" }, 401)],
    ["network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["non-JSON body", () => new Response("<html>", { status: 200 })],
    ["object instead of array", () => json(STORE)],
    ["multiple rows", () => json([STORE, STORE])],
    ["extra private field", () => json([{ ...STORE, organization_id: "10000000-0000-4000-8000-0000000000e1" }])],
    ["malformed row", () => json([{ store_id: "not-a-uuid", slug: "x", canonical_hostname: null }])],
  ])("fails closed as unavailable on %s", async (_name, handler) => {
    const { dir } = directory(handler);
    expect(await dir.byHost("shop.acme-sneakers.test")).toEqual({ status: "unavailable" });
  });

  it("reads the public profile projection and refuses non-UUID ids without a request", async () => {
    const profile = { display_name: "Acme Livros", default_locale: "pt-BR", currency: "BRL", homepage_mode: "landing" };
    const { dir, requests } = directory(() => json([profile]));
    expect(await dir.profile("20000000-0000-4000-8000-0000000000e2")).toEqual({
      status: "found",
      profile: { displayName: "Acme Livros", defaultLocale: "pt-BR", currency: "BRL", homepageMode: "landing" },
    });
    expect(requests[0]?.url).toContain("/rest/v1/store_public_profiles?select=display_name,default_locale,currency,homepage_mode&store_id=eq.20000000-0000-4000-8000-0000000000e2");
    expect(await dir.profile("x&store_id=neq.1")).toEqual({ status: "not_found" });
    expect(requests).toHaveLength(1);
  });

  it("times out as unavailable", async () => {
    const fetchImpl = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const dir = createSupabaseDirectory({ url: "http://127.0.0.1:54321", anonKey: "k", fetchImpl, timeoutMs: 20 });
    expect(await dir.byHost("shop.acme-sneakers.test")).toEqual({ status: "unavailable" });
  });
});
