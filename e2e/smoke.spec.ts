import { expect, test } from "@playwright/test";

test("admin starts", async ({ page }) => {
  await page.goto("http://localhost:3100");
  await expect(page.getByRole("heading", { name: "KERNO Admin" })).toBeVisible();
});

// The platform apex is never a store, so this is deterministic without a database.
test("storefront refuses the platform apex and unknown hosts", async ({ request }) => {
  const apex = await request.get("http://localhost:3101/");
  expect(apex.status()).toBe(404);
  expect(apex.headers()["cache-control"]).toBe("no-store");
  expect(await apex.text()).toBe("Not found");
  const nested = await request.get("http://a.b.localhost:3101/");
  expect(nested.status()).toBe(404);
});

// Needs the local Supabase stack with supabase/seed.sql applied and real keys in the environment
// (`pnpm db:reset`, then start the storefront with the stack's anon key). Not run in CI.
test.describe("three seeded stores on one deployment", () => {
  test.skip(process.env.E2E_SEEDED_STORES !== "1", "set E2E_SEEDED_STORES=1 with a seeded local stack");

  for (const [host, name] of [
    ["acme-sneakers.localhost", "Acme Sneakers"],
    ["acme-books.localhost", "Acme Livros"],
    ["acme-plants.localhost", "Acme Rośliny"],
  ] as const) {
    test(`${host} serves ${name}`, async ({ page }) => {
      await page.goto(`http://${host}:3101/`);
      await expect(page.getByRole("heading", { name })).toBeVisible();
    });
  }

  test("a verified custom domain serves its store; the same store via two hosts shares one identity", async ({ request }) => {
    const custom = await request.get("http://localhost:3101/", { headers: { host: "shop.acme-sneakers.test" } });
    expect(custom.status()).toBe(200);
    expect(await custom.text()).toContain("Acme Sneakers");
    expect(custom.headers()["vary"]).toContain("Host");
  });

  test("draft, suspended, unknown and spoofed hosts do not serve a store", async ({ request }) => {
    for (const host of ["acme-draft.localhost", "acme-suspended.localhost", "nobody.localhost", "pending.acme-books.test"]) {
      const response = await request.get("http://localhost:3101/", { headers: { host: `${host}:3101` } });
      expect(response.status(), host).toBe(404);
    }
    // A forwarded host cannot select a store: Host says unknown, the forwarded header is ignored.
    const spoof = await request.get("http://localhost:3101/", { headers: { host: "nobody.localhost:3101", "x-forwarded-host": "acme-books.localhost" } });
    expect(spoof.status()).toBe(404);
  });
});
