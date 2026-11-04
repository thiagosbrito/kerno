import { describe, expect, it } from "vitest";
import { loginInputSchema, memberRoleChangeSchema, safeRedirectPath, uuidParamSchema } from "./auth";

describe("loginInputSchema", () => {
  it("normalizes the email and rejects malformed or oversized input", () => {
    expect(loginInputSchema.parse({ email: " Owner@Example.TEST ", password: "pw" }).email).toBe("owner@example.test");
    for (const bad of [
      { email: "not-an-email", password: "pw" },
      { email: "a@example.test", password: "" },
      { email: "a@example.test", password: "x".repeat(257) },
      { email: "a@example.test", password: "pw", role: "owner" },
      { email: ["a@example.test"], password: "pw" },
    ]) {
      expect(loginInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("memberRoleChangeSchema", () => {
  it("accepts only a known role and no extra keys", () => {
    expect(memberRoleChangeSchema.parse({ role: "staff" })).toEqual({ role: "staff" });
    for (const bad of [{ role: "root" }, { role: "staff", organization_id: "x" }, {}, { role: ["owner"] }]) {
      expect(memberRoleChangeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("uuidParamSchema", () => {
  it("rejects non-UUID path parameters", () => {
    expect(uuidParamSchema.safeParse("10000000-0000-4000-8000-00000000000a").success).toBe(true);
    for (const bad of ["1", "../etc/passwd", "10000000-0000-4000-8000-00000000000a' or 1=1"]) {
      expect(uuidParamSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("safeRedirectPath", () => {
  it("keeps same-origin paths and rejects open-redirect shapes", () => {
    expect(safeRedirectPath("/stores/1?tab=a")).toBe("/stores/1?tab=a");
    for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "javascript:alert(1)", "evil", "/a\nb", undefined, 5]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/");
    }
  });
});
