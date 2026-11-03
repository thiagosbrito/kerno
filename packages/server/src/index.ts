import "server-only";
import { parseServerEnv, type ServerEnv } from "@kerno/contracts";

let cached: ServerEnv | undefined;

/** Validated server-only configuration. Importing this package from a client component fails the build. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
export * from "./tenancy";
