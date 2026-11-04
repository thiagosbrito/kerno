import { CORRELATION_ID_HEADER, orgRoleSchema, type OrgRole, type PublicEnv } from "@kerno/contracts";
import { createServerClient } from "@supabase/ssr";
import { createClient, isAuthApiError, isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import type { AuditSink, DeniedAudit, MemberStore, MutationResult, RoleLookup, SessionResult } from "./types";

export interface CookieToSet {
  readonly name: string;
  readonly value: string;
  readonly options: Record<string, unknown>;
}

/** Framework-neutral cookie access, implemented by the app with its own request/response cookies. */
export interface CookieAdapter {
  getAll(): readonly { name: string; value: string }[];
  /** May throw where cookies are read-only (server components); the proxy refreshes them instead. */
  setAll(cookies: readonly CookieToSet[]): void;
}

/**
 * Session cookies are HttpOnly (no script can read the tokens), SameSite=Lax (not sent on
 * cross-site sub-requests) and Secure outside local development. Supabase's defaults leave
 * HttpOnly off because its browser client reads the cookie; this app never does.
 */
export function sessionCookieOptions(production: boolean) {
  return { httpOnly: true, sameSite: "lax", secure: production, path: "/" } as const;
}

export function createSessionClient(
  env: Pick<PublicEnv, "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY">,
  cookies: CookieAdapter,
  options: { correlationId: string; production: boolean },
): SupabaseClient {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: sessionCookieOptions(options.production),
    // The database copies this into audit rows written by triggers (private.current_correlation_id).
    global: { headers: { [CORRELATION_ID_HEADER]: options.correlationId } },
    cookies: {
      getAll: () => [...cookies.getAll()],
      setAll: (toSet) => {
        try {
          cookies.setAll(toSet.map((c) => ({ name: c.name, value: c.value, options: { ...c.options } })));
        } catch {
          // Read-only cookie context: the proxy has already refreshed the session for this request.
        }
      },
    },
  });
}

/**
 * Verifies the session with the auth server (`getUser`), which rejects expired, revoked and
 * signed-out sessions. `getSession()` only decodes the cookie and must never gate access.
 * A transport failure is "unavailable" (fail closed, 503) rather than "unauthenticated".
 */
export async function verifySession(client: SupabaseClient): Promise<SessionResult> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (isAuthRetryableFetchError(error)) return { status: "unavailable" };
    if (error.name === "AuthSessionMissingError") return { status: "unauthenticated" };
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500) return { status: "unauthenticated" };
    return { status: "unavailable" };
  }
  return data.user ? { status: "authenticated", userId: data.user.id } : { status: "unauthenticated" };
}

/**
 * Member operations through the caller's credentials. Never use a service-role client here: RLS
 * is the second authorization layer and must see the real user.
 */
export function createMemberStore(client: SupabaseClient): MemberStore {
  async function getRole(organizationId: string, userId: string): Promise<RoleLookup> {
    const { data, error } = await client
      .from("memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { status: "unavailable" };
    if (data === null) return { status: "not_member" };
    const role = orgRoleSchema.safeParse((data as { role?: unknown }).role);
    // An unknown role value is treated as no privilege at all.
    return role.success ? { status: "member", role: role.data } : { status: "not_member" };
  }

  const settle = (rows: unknown[] | null, error: { code?: string } | null): MutationResult => {
    if (error) return error.code === "P0001" ? "conflict" : error.code === "42501" ? "forbidden" : "unavailable";
    return rows !== null && rows.length > 0 ? "ok" : "not_found";
  };

  return {
    getRole,
    async changeRole(organizationId: string, userId: string, role: OrgRole) {
      const { data, error } = await client
        .from("memberships")
        .update({ role })
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .select("user_id");
      return settle(data, error);
    },
    async remove(organizationId: string, userId: string) {
      const { data, error } = await client
        .from("memberships")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .select("user_id");
      return settle(data, error);
    },
  };
}

/**
 * Writes application-level audit events with the service role. This is the only service-role use
 * in the auth path and it is narrow: one RPC that refuses actors who are not members of the
 * organization, called only after the session was verified (AC-3 equivalent authorization).
 */
export function createAuditSink(url: string, serviceRoleKey: string): AuditSink {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async record(event: DeniedAudit) {
      const { error } = await client.rpc("record_audit_event", {
        org: event.organizationId,
        store: null,
        actor: event.actorUserId,
        action_name: event.action,
        target_type_name: event.targetType,
        target_identifier: event.targetId,
        result: event.outcome,
        correlation: event.correlationId,
        details: event.details,
      });
      if (error) throw new Error("audit write failed");
    },
  };
}

export type SignInResult =
  | { readonly status: "signed_in" }
  | { readonly status: "invalid_credentials" }
  | { readonly status: "rate_limited" }
  | { readonly status: "unavailable" };

/**
 * Password sign-in. Wrong email, wrong password, unconfirmed or unknown accounts all collapse to
 * `invalid_credentials` so the response cannot be used to enumerate accounts. Brute-force limits
 * are enforced by Supabase Auth ([auth.rate_limit]); a 429 is surfaced as `rate_limited`.
 */
export async function signInWithPassword(
  client: SupabaseClient,
  credentials: { readonly email: string; readonly password: string },
): Promise<SignInResult> {
  const { error } = await client.auth.signInWithPassword(credentials);
  if (!error) return { status: "signed_in" };
  if (isAuthRetryableFetchError(error)) return { status: "unavailable" };
  if (isAuthApiError(error)) {
    if (error.status === 429) return { status: "rate_limited" };
    if (error.status >= 500) return { status: "unavailable" };
    return { status: "invalid_credentials" };
  }
  return { status: "unavailable" };
}
