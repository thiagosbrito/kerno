import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(here, "..", "migrations");
export const rollbacksDir = join(here, "..", "rollbacks");

/** Manual undo scripts, newest first (a later migration may depend on an earlier one). */
export function rollbackFiles(): string[] {
  return readdirSync(rollbacksDir).filter((f) => f.endsWith(".sql")).sort().reverse();
}

/**
 * Stand-in for what Supabase provides before user migrations run: API roles,
 * auth.users, auth.uid() (same claim lookup as Supabase) and default grants on new
 * public tables, so the migration must revoke them itself.
 */
const SUPABASE_BOOTSTRAP = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant all on all tables in schema public, auth to service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

/** Minimal database surface shared by the in-process (PGlite) and real (pg) backends. */
export interface Db {
  exec(sql: string): Promise<void>;
  query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  close(): Promise<void>;
}

/**
 * Set KERNO_TEST_DATABASE_URL to run the same suite against a real local Supabase stack
 * (after `pnpm db:reset`, which applies the migrations). Destructive: it truncates tenant
 * tables and temporarily drops and re-creates them, so only point it at a disposable
 * local database. Unset, the suite replays the migrations in PGlite and needs no Docker.
 */
export const realDatabaseUrl = process.env.KERNO_TEST_DATABASE_URL;

async function connectReal(url: string): Promise<Db> {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error("KERNO_TEST_DATABASE_URL must point at a local database; refusing destructive tests");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    exec: async (sql) => {
      await client.query(sql);
    },
    query: async (sql, params) => {
      const r = await client.query(sql, params as unknown[] | undefined);
      return { rows: r.rows, affectedRows: r.rowCount ?? 0 };
    },
    close: () => client.end(),
  };
}

function wrapPglite(db: PGlite): Db {
  return {
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: (sql, params) => db.query(sql, params) as never,
    close: () => db.close(),
  };
}

export async function newDatabase(): Promise<Db> {
  if (realDatabaseUrl) {
    const db = await connectReal(realDatabaseUrl);
    const { rows } = await db.query<{ t: string | null }>("select to_regclass('public.stores')::text as t");
    if (!rows[0]?.t) throw new Error("Migrations are not applied: run `pnpm db:reset` first");
    return db;
  }
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return wrapPglite(db);
}

export type Context =
  | { kind: "anon" }
  | { kind: "service" }
  | { kind: "user"; sub: string; claims?: Record<string, unknown> };

export const ids = {
  ownerA: "00000000-0000-4000-8000-0000000000a1",
  adminA: "00000000-0000-4000-8000-0000000000a2",
  staffA: "00000000-0000-4000-8000-0000000000a3",
  managerA: "00000000-0000-4000-8000-0000000000a4",
  ownerB: "00000000-0000-4000-8000-0000000000b1",
  outsider: "00000000-0000-4000-8000-0000000000c1",
  orgA: "10000000-0000-4000-8000-00000000000a",
  orgB: "10000000-0000-4000-8000-00000000000b",
  // Overlapping-looking identifiers: differ only in the last hex digit.
  storeA: "20000000-0000-4000-8000-0000000000a1",
  storeADraft: "20000000-0000-4000-8000-0000000000a2",
  storeB: "20000000-0000-4000-8000-0000000000b1",
} as const;

/** Reset to the two-tenant fixture as superuser. Orgs/stores deliberately look alike. */
export async function seed(db: Db): Promise<void> {
  await db.exec(`
    truncate public.organizations, auth.users cascade;
    insert into auth.users (id, email) values
      ('${ids.ownerA}', 'owner-a@example.test'), ('${ids.adminA}', 'admin-a@example.test'),
      ('${ids.staffA}', 'staff-a@example.test'), ('${ids.managerA}', 'manager-a@example.test'), ('${ids.ownerB}', 'owner-b@example.test'),
      ('${ids.outsider}', 'outsider@example.test');
    insert into public.organizations (id, name) values
      ('${ids.orgA}', 'Acme Goods'), ('${ids.orgB}', 'Acme Goods');
    insert into public.memberships (organization_id, user_id, role) values
      ('${ids.orgA}', '${ids.ownerA}', 'owner'), ('${ids.orgA}', '${ids.adminA}', 'admin'),
      ('${ids.orgA}', '${ids.managerA}', 'manager'), ('${ids.orgA}', '${ids.staffA}', 'staff'), ('${ids.orgB}', '${ids.ownerB}', 'owner');
    insert into public.stores (id, organization_id, slug, name, status, contact_email, internal_notes) values
      ('${ids.storeA}', '${ids.orgA}', 'main-a', 'Main Store', 'active', 'secret-a@example.test', 'private note A'),
      ('${ids.storeADraft}', '${ids.orgA}', 'draft-a', 'Draft Store', 'draft', null, 'private draft note'),
      ('${ids.storeB}', '${ids.orgB}', 'main-b', 'Main Store', 'active', 'secret-b@example.test', 'private note B');
    insert into public.store_public_profiles (store_id, display_name, default_locale, currency) values
      ('${ids.storeA}', 'Main Store', 'en', 'USD'), ('${ids.storeADraft}', 'Draft Store', 'pt-BR', 'BRL'),
      ('${ids.storeB}', 'Main Store', 'en', 'USD');
  `);
}

export interface SqlError extends Error {
  code?: string;
}

/** Run one statement as the given API context in its own transaction (as PostgREST does). */
export async function as<T extends Record<string, unknown> = Record<string, unknown>>(
  db: Db,
  ctx: Context,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: T[]; affectedRows: number }> {
  const role = ctx.kind === "anon" ? "anon" : ctx.kind === "service" ? "service_role" : "authenticated";
  const claims =
    ctx.kind === "user"
      ? { role: "authenticated", ...ctx.claims, sub: ctx.sub }
      : ctx.kind === "service"
        ? { role: "service_role" }
        : { role: "anon" };
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await db.query<T>(sql, params);
    await db.exec("commit");
    return { rows: result.rows, affectedRows: result.affectedRows ?? 0 };
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

export const user = (sub: string, claims?: Record<string, unknown>): Context =>
  claims ? { kind: "user", sub, claims } : { kind: "user", sub };
export const anon: Context = { kind: "anon" };
export const service: Context = { kind: "service" };

/** Assert a statement is rejected, optionally with a SQLSTATE code. */
export async function rejection(promise: Promise<unknown>): Promise<SqlError> {
  try {
    await promise;
  } catch (error) {
    return error as SqlError;
  }
  throw new Error("expected the statement to be rejected, but it succeeded");
}
