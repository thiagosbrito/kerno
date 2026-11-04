import { expect, test } from "@playwright/test";

// THI-67 browser proof: three seeded stores on ONE storefront deployment, each rendering its own
// configuration, never another's. Needs the seeded local stack (E2E_SEEDED_STORES=1). Screenshots
// land in docs/evidence/thi-67/ when E2E_EVIDENCE=1.
const PORT = 3101;
const stores = [
  { host: "acme-sneakers.localhost", name: "Acme Sneakers", locale: "en", currency: "USD", mode: "catalog" },
  { host: "acme-books.localhost", name: "Acme Livros", locale: "pt-BR", currency: "BRL", mode: "landing" },
  { host: "acme-plants.localhost", name: "Acme Rośliny", locale: "pl", currency: "PLN", mode: "landing" },
] as const;

test.describe("three-store isolation", () => {
  if (process.env.CI && process.env.E2E_SEEDED_STORES !== "1") throw new Error("CI must run the seeded stores (E2E_SEEDED_STORES=1)");
  test.skip(process.env.E2E_SEEDED_STORES !== "1", "set E2E_SEEDED_STORES=1 with a seeded local stack");

  for (const s of stores) {
    test(`${s.host} renders only its own content and configuration`, async ({ page }) => {
      await page.goto(`http://${s.host}:${PORT}/`);
      await expect(page.getByRole("heading", { name: s.name })).toBeVisible();
      await expect(page.getByTestId("locale")).toHaveText(s.locale);
      await expect(page.getByTestId("currency")).toHaveText(s.currency);
      await expect(page.getByTestId("homepage-mode")).toHaveText(s.mode);
      await expect(page.locator("div[data-homepage-mode]")).toHaveAttribute("lang", s.locale);
      const html = await page.content();
      for (const other of stores.filter((o) => o !== s)) expect(html).not.toContain(other.name);
      if (process.env.E2E_EVIDENCE === "1") await page.screenshot({ path: `docs/evidence/thi-67/${s.host.split(".")[0]}.png`, fullPage: true });
    });
  }

  test("concurrent interleaved requests never receive another store's page", async ({ request }) => {
    const jobs = Array.from({ length: 30 }, () => stores).flat(); // 90 requests, interleaved a,b,c,a,b,c...
    const bodies = await Promise.all(
      jobs.map(async (s) => {
        const res = await request.get(`http://localhost:${PORT}/`, { headers: { host: `${s.host}:${PORT}` } });
        return { s, status: res.status(), cache: res.headers()["cache-control"] ?? "", body: await res.text() };
      }),
    );
    for (const { s, status, cache, body } of bodies) {
      expect(status).toBe(200);
      expect(cache).toMatch(/no-store|private/); // explicit, not merely "not public"
      expect(cache).not.toMatch(/public|s-maxage|max-age=[1-9]/);
      expect(body).toContain(s.name);
      for (const o of stores.filter((x) => x !== s)) expect(body).not.toContain(o.name);
    }
  });

  test("path, query and header tricks cannot select or reach another tenant", async ({ request }) => {
    const base = `http://localhost:${PORT}`;
    const asBooks = { host: `acme-books.localhost:${PORT}` };
    for (const url of ["/?store=acme-sneakers", "/?storeId=20000000-0000-4000-8000-0000000000e1", "/acme-sneakers", "/..%2Facme-sneakers", "/%2e%2e/acme-plants"]) {
      const res = await request.get(base + url, { headers: asBooks });
      const body = await res.text();
      // Query strings are ignored, so the host's own store still renders; paths have no route (404).
      if (url.startsWith("/?")) {
        expect(res.status(), url).toBe(200);
        expect(body, url).toContain("Acme Livros");
      } else {
        expect(res.status(), url).toBe(404);
      }
      expect(body, url).not.toContain("Acme Sneakers");
      expect(body, url).not.toContain("Acme Rośliny");
    }
    for (const forged of [{ "x-forwarded-host": "acme-sneakers.localhost" }, { forwarded: "host=acme-plants.localhost" }, { "x-tenant-id": "20000000-0000-4000-8000-0000000000e3" }]) {
      const res = await request.get(base + "/", { headers: { ...asBooks, ...forged } });
      expect(await res.text()).toContain("Acme Livros");
    }
  });

  test("media paths: static files and the image optimizer are gated by host", async ({ request }) => {
    // No tenant media exists before THI-70; public files and the optimizer must still not be an
    // ungated side door. The proxy's own plain-text 404 distinguishes "gated" from "file not found".
    const asHost = (host: string) => ({ host: `${host}:${PORT}` });
    const ok = await request.get(`http://localhost:${PORT}/kerno-mark.svg`, { headers: asHost("acme-books.localhost") });
    expect(ok.status()).toBe(200); // positive control: the file exists and an active host may read it
    for (const host of ["nobody.localhost", "acme-draft.localhost", "acme-suspended.localhost"]) {
      for (const path of ["/kerno-mark.svg", "/_next/image?url=%2Fkerno-mark.svg&w=64&q=75"]) {
        const res = await request.get(`http://localhost:${PORT}${path}`, { headers: asHost(host) });
        expect(res.status(), `${host}${path}`).toBe(404);
        expect(await res.text(), `${host}${path}`).toBe("Not found");
        expect(res.headers()["cache-control"]).toBe("no-store");
      }
    }
  });
});
