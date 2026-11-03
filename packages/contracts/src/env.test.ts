import { describe, expect, it } from "vitest";
import { EnvError, parsePublicEnv, parseServerEnv } from "./env";

const valid = {
  NEXT_PUBLIC_ADMIN_URL: "http://localhost:3000",
  NEXT_PUBLIC_STOREFRONT_URL: "http://localhost:3001",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
};

describe("env contracts", () => {
  it("accepts a complete configuration", () => {
    expect(parseServerEnv(valid).SUPABASE_SERVICE_ROLE_KEY).toBe("service-test");
  });

  it("public parse strips server-only names", () => {
    expect(parsePublicEnv(valid)).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("rejects missing, empty and malformed values", () => {
    const missing: Record<string, string | undefined> = { ...valid };
    delete missing.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseServerEnv(missing)).toThrow(EnvError);
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })).toThrow(EnvError);
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_ADMIN_URL: "not a url" })).toThrow(EnvError);
  });

  it("does not leak submitted values in error messages", () => {
    try {
      parseServerEnv({ ...valid, NEXT_PUBLIC_ADMIN_URL: "bad-secret-value" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("bad-secret-value");
    }
  });
});
