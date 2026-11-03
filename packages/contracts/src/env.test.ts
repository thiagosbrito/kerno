import { describe, expect, it } from "vitest";
import { EnvError, parseHostRoutingEnv, parsePublicEnv, parseServerEnv } from "./env";

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

  it("accepts only http and https URLs", () => {
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_ADMIN_URL: "https://admin.example.com" })).not.toThrow();
    for (const bad of ["javascript:alert(1)", "ftp://x", "data:text/html,x"]) {
      expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_ADMIN_URL: bad })).toThrow(EnvError);
      expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: bad })).toThrow(EnvError);
    }
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

describe("host routing env", () => {
  it("accepts a platform domain and an optional trusted header", () => {
    expect(parseHostRoutingEnv({ PLATFORM_DOMAIN: "localhost" })).toEqual({ PLATFORM_DOMAIN: "localhost" });
    expect(parseHostRoutingEnv({ PLATFORM_DOMAIN: "kerno.app", TRUSTED_FORWARDED_HOST_HEADER: "x-forwarded-host" }).TRUSTED_FORWARDED_HOST_HEADER).toBe("x-forwarded-host");
    // An empty value in an env file means "not configured", not "trust the empty header".
    expect(parseHostRoutingEnv({ PLATFORM_DOMAIN: "kerno.app", TRUSTED_FORWARDED_HOST_HEADER: "" }).TRUSTED_FORWARDED_HOST_HEADER).toBeUndefined();
  });

  it("rejects malformed platform domains and header names", () => {
    for (const bad of [undefined, "", "KERNO.APP", "kerno.app.", "kerno.app:3000", "http://kerno.app", "a b.test", ".kerno.app", "-x.test"]) {
      expect(() => parseHostRoutingEnv({ PLATFORM_DOMAIN: bad }), String(bad)).toThrow(EnvError);
    }
    for (const bad of ["host", "forwarded", "X-Forwarded-Host", "x-forwarded host", "x-"]) {
      expect(() => parseHostRoutingEnv({ PLATFORM_DOMAIN: "kerno.app", TRUSTED_FORWARDED_HOST_HEADER: bad }), bad).toThrow(EnvError);
    }
  });
});
