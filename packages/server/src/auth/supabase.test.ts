import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { sessionCookieOptions, signInWithPassword, verifySession } from "./supabase";

const clientWith = (auth: object) => ({ auth }) as unknown as SupabaseClient;
const getUser = (result: object) => clientWith({ getUser: async () => result });
const signIn = (error: unknown) => clientWith({ signInWithPassword: async () => ({ error }) });

describe("sessionCookieOptions", () => {
  it("is HttpOnly and SameSite=Lax always, Secure in production", () => {
    expect(sessionCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    expect(sessionCookieOptions(false)).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false });
  });
});

describe("verifySession", () => {
  it("authenticates only when the auth server returns a user", async () => {
    expect(await verifySession(getUser({ data: { user: { id: "u1" } }, error: null }))).toEqual({ status: "authenticated", userId: "u1" });
    expect(await verifySession(getUser({ data: { user: null }, error: null }))).toEqual({ status: "unauthenticated" });
  });

  it("treats missing, expired and revoked sessions as unauthenticated", async () => {
    expect(await verifySession(getUser({ data: { user: null }, error: new AuthSessionMissingError() }))).toEqual({ status: "unauthenticated" });
    for (const status of [401, 403]) {
      const error = new AuthApiError("session_not_found", status, "session_not_found");
      expect(await verifySession(getUser({ data: { user: null }, error }))).toEqual({ status: "unauthenticated" });
    }
  });

  it("fails closed as unavailable on transport and server errors (not as anonymous or allowed)", async () => {
    for (const error of [new AuthRetryableFetchError("down", 0), new AuthApiError("boom", 500, "unexpected_failure"), new Error("???")]) {
      expect(await verifySession(getUser({ data: { user: null }, error }))).toEqual({ status: "unavailable" });
    }
  });
});

describe("signInWithPassword", () => {
  it("collapses every credential failure into one result", async () => {
    for (const code of ["invalid_credentials", "email_not_confirmed", "user_not_found"]) {
      expect(await signInWithPassword(signIn(new AuthApiError(code, 400, code)), { email: "a@b.test", password: "x" })).toEqual({ status: "invalid_credentials" });
    }
  });

  it("maps rate limits and outages separately and succeeds without an error", async () => {
    const creds = { email: "a@b.test", password: "x" };
    expect(await signInWithPassword(signIn(new AuthApiError("over_request_rate_limit", 429, "over_request_rate_limit")), creds)).toEqual({ status: "rate_limited" });
    expect(await signInWithPassword(signIn(new AuthRetryableFetchError("down", 0)), creds)).toEqual({ status: "unavailable" });
    expect(await signInWithPassword(signIn(new AuthApiError("boom", 502, "unexpected_failure")), creds)).toEqual({ status: "unavailable" });
    expect(await signInWithPassword(signIn(null), creds)).toEqual({ status: "signed_in" });
  });
});
