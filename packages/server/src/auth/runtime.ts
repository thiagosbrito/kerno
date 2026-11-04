import "server-only";
import { parsePublicEnv, parseServerEnv } from "@kerno/contracts";
import { randomUUID } from "node:crypto";
import { toOriginSet } from "./origin";
import {
  createAuditSink,
  createMemberStore,
  createSessionClient,
  verifySession,
  type CookieAdapter,
} from "./supabase";
import type { AuthDependencies, LogEntry } from "./types";

let auditSink: ReturnType<typeof createAuditSink> | undefined;

const writeLog = (entry: LogEntry): void => {
  // Single-line JSON with ids and reasons only (no tokens, emails, bodies).
  console.info(JSON.stringify({ scope: "auth", ...entry }));
};

/**
 * Builds the dependencies for ONE request. Nothing is cached across requests: each request gets
 * its own Supabase client bound to that request's cookies, so identities cannot leak between users.
 */
export function createRequestAuth(cookies: CookieAdapter): AuthDependencies & {
  readonly client: ReturnType<typeof createSessionClient>;
} {
  const env = parsePublicEnv(process.env);
  const correlationId = randomUUID().replaceAll("-", "");
  const client = createSessionClient(env, cookies, { correlationId, production: process.env.NODE_ENV === "production" });
  return {
    client,
    allowedOrigins: toOriginSet([env.NEXT_PUBLIC_ADMIN_URL]),
    getSession: () => verifySession(client),
    members: createMemberStore(client),
    audit: {
      record: (event) => {
        const server = parseServerEnv(process.env);
        auditSink ??= createAuditSink(server.NEXT_PUBLIC_SUPABASE_URL, server.SUPABASE_SERVICE_ROLE_KEY);
        return auditSink.record(event);
      },
    },
    log: writeLog,
    correlationId,
  };
}
