import { expect, test, type APIRequestContext } from "@playwright/test";

// Real GoTrue + PostgREST + RLS against the LOCAL Supabase stack (`pnpm db:start`, migrations applied).
// Needs E2E_MERCHANT_AUTH=1, E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY. It creates its own
// uniquely named users and organization and removes them afterwards; it never truncates anything.
const ADMIN = "http://localhost:3100";
const SUPABASE = "http://localhost:54321";
const PASSWORD = "correct horse battery staple 1!";

test.describe("merchant authentication and server authorization", () => {
  if (process.env.CI && process.env.E2E_MERCHANT_AUTH !== "1") throw new Error("CI must run the merchant auth e2e (E2E_MERCHANT_AUTH=1)");
  test.skip(process.env.E2E_MERCHANT_AUTH !== "1", "set E2E_MERCHANT_AUTH=1 with a local Supabase stack");
  test.describe.configure({ mode: "serial" });

  const service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const run = Math.random().toString(36).slice(2, 10);
  const email = (who: string) => `${who}-${run}@auth-e2e.test`;
  const users: Record<string, string> = {};
  let orgId = "";
  let otherOrgId = "";

  const headers = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  async function createUser(request: APIRequestContext, who: string): Promise<string> {
    const res = await request.post(`${SUPABASE}/auth/v1/admin/users`, {
      headers,
      data: { email: email(who), password: PASSWORD, email_confirm: true },
    });
    expect(res.ok()).toBe(true);
    return ((await res.json()) as { id: string }).id;
  }
  const rpc = async (request: APIRequestContext, fn: string, data: object) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/${fn}`, { headers, data });
    expect(res.ok(), await res.text()).toBe(true);
    const text = await res.text();
    return text === "" ? null : (JSON.parse(text) as unknown); // void functions answer with an empty body
  };

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    for (const who of ["owner", "staff", "outsider"]) users[who] = await createUser(request, who);
    orgId = (await rpc(request, "create_organization", { org_name: `Auth E2E ${run}`, owner_user_id: users.owner })) as string;
    otherOrgId = (await rpc(request, "create_organization", { org_name: `Other ${run}`, owner_user_id: users.outsider })) as string;
    await rpc(request, "add_member", { org: orgId, member_user_id: users.staff, member_role: "staff", actor: users.owner });
    await request.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    for (const org of [orgId, otherOrgId]) await request.delete(`${SUPABASE}/rest/v1/organizations?id=eq.${org}`, { headers });
    for (const id of Object.values(users)) await request.delete(`${SUPABASE}/auth/v1/admin/users/${id}`, { headers });
    await request.dispose();
  });

  const signIn = async (page: import("@playwright/test").Page, who: string, password = PASSWORD) => {
    await page.goto(`${ADMIN}/login`);
    await page.getByLabel("Email").fill(email(who));
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  };
  const signInOk = async (page: import("@playwright/test").Page, who: string) => {
    await signIn(page, who);
    await page.waitForURL(`${ADMIN}/`);
  };
  const api = (org: string, user: string) => `${ADMIN}/api/organizations/${org}/members/${user}`;
  const sameOrigin = { origin: ADMIN, "content-type": "application/json" };

  test("unauthenticated pages redirect to login and API calls get 401", async ({ page, request }) => {
    await page.goto(ADMIN);
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    const res = await request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "manager" } });
    expect(res.status()).toBe(401);
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("rejects bad credentials with one generic message and no session", async ({ page }) => {
    await signIn(page, "owner", "wrong password");
    await expect(page.locator("#login-error")).toHaveText("Invalid email or password.");
    await signIn(page, "nobody");
    await expect(page.locator("#login-error")).toHaveText("Invalid email or password.");
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);
  });

  test("login sets HttpOnly session cookies and shows only the user's own organization", async ({ page }) => {
    await signInOk(page, "owner");
    await expect(page.getByText(`Auth E2E ${run} · owner`)).toBeVisible();
    await expect(page.getByText(`Other ${run}`)).toHaveCount(0);
    const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-"));
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("sb-");
    await page.goto(`${ADMIN}/login`);
    await expect(page).toHaveURL(`${ADMIN}/`);
  });

  test("CSRF: a cookie-authenticated mutation from a foreign or missing origin is refused", async ({ page }) => {
    await signInOk(page, "owner");
    await expect(page.getByRole("heading", { name: "KERNO Admin" })).toBeVisible();
    for (const h of [{ origin: "https://evil.test" }, {}, { "sec-fetch-site": "cross-site" }]) {
      const res = await page.request.patch(api(orgId, users.staff!), { headers: { "content-type": "application/json", ...h }, data: { role: "manager" } });
      expect(res.status(), JSON.stringify(h)).toBe(403);
    }
  });

  test("IDOR and escalation: another tenant's organization is invisible and bodies cannot carry tenant ids", async ({ page }) => {
    await signInOk(page, "owner");
    const other = await page.request.patch(api(otherOrgId, users.outsider!), { headers: sameOrigin, data: { role: "staff" } });
    const missing = await page.request.patch(api("10000000-0000-4000-8000-0000000000ff", users.outsider!), { headers: sameOrigin, data: { role: "staff" } });
    expect(other.status()).toBe(404);
    expect(await other.text()).toBe(await missing.text());
    const forged = await page.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "manager", organization_id: otherOrgId } });
    expect(forged.status()).toBe(400);
  });

  test("an owner can change a role; a staff member cannot escalate and the attempt is audited", async ({ browser, page, request }) => {
    await signInOk(page, "owner");
    const ok = await page.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "manager" } });
    expect(ok.status()).toBe(200);
    const back = await page.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "staff" } });
    expect(back.status()).toBe(200);

    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await signInOk(staffPage, "staff");
    await expect(staffPage.getByText(`Auth E2E ${run} · staff`)).toBeVisible();
    const denied = await staffPage.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "owner" } });
    expect(denied.status()).toBe(403);
    await staffContext.close();

    const res = await request.get(`${SUPABASE}/rest/v1/audit_events?organization_id=eq.${orgId}&select=action,outcome,actor_user_id,correlation_id&order=created_at`, { headers });
    const rows = (await res.json()) as { action: string; outcome: string; actor_user_id: string; correlation_id: string }[];
    expect(rows.map((r) => `${r.action}:${r.outcome}`)).toEqual([
      "organization.created:success",
      "membership.added:success", // the owner, added by create_organization
      "membership.added:success", // the staff member
      "membership.role_changed:success",
      "membership.role_changed:success",
      "member.role_change.denied:denied",
    ]);
    expect(rows.at(-1)?.actor_user_id).toBe(users.staff);
    expect(rows.at(-2)?.actor_user_id).toBe(users.owner);
    for (const r of rows) expect(r.correlation_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test("revocation: a still-valid session loses privilege on the very next request", async ({ page, request }) => {
    users.admin = await createUser(request, "admin");
    await rpc(request, "add_member", { org: orgId, member_user_id: users.admin, member_role: "admin", actor: users.owner });
    await signInOk(page, "admin");
    await expect(page.getByText(`Auth E2E ${run} · admin`)).toBeVisible();
    const before = await page.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "manager" } });
    expect(before.status()).toBe(200);
    // Revoke the membership as the platform would; the session and its token stay valid.
    const del = await request.delete(`${SUPABASE}/rest/v1/memberships?organization_id=eq.${orgId}&user_id=eq.${users.admin}`, { headers });
    expect(del.status()).toBeLessThan(300);
    const after = await page.request.patch(api(orgId, users.staff!), { headers: sameOrigin, data: { role: "staff" } });
    expect(after.status()).toBe(404);
    await page.goto(ADMIN);
    await expect(page.getByText("You are not a member of any organization.")).toBeVisible();
  });

  test("logout revokes the session: a copied cookie stops working", async ({ page, request }) => {
    await signInOk(page, "outsider");
    await expect(page.getByText(`Other ${run} · owner`)).toBeVisible();
    const stolen = (await page.context().cookies()).filter((c) => c.name.startsWith("sb-")).map((c) => `${c.name}=${c.value}`).join("; ");
    const live = await request.patch(api(otherOrgId, users.outsider!), { headers: { ...sameOrigin, cookie: stolen }, data: { role: "owner" } });
    expect(live.status()).toBe(200);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.context().cookies()).filter((c) => c.name.startsWith("sb-"))).toEqual([]);

    const replay = await request.patch(api(otherOrgId, users.outsider!), { headers: { ...sameOrigin, cookie: stolen }, data: { role: "owner" } });
    expect(replay.status()).toBe(401);
  });
});
