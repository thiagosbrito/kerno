import { expect, test } from "@playwright/test";

test("admin starts", async ({ page }) => {
  await page.goto("http://localhost:3100");
  await expect(page.getByRole("heading", { name: "KERNO Admin" })).toBeVisible();
});

test("storefront starts", async ({ page }) => {
  await page.goto("http://localhost:3101");
  await expect(page.getByRole("heading", { name: "KERNO Storefront" })).toBeVisible();
});
