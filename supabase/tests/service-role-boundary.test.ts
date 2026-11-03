import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT_REACHABLE = ["apps/admin/src", "apps/storefront/src", "packages/ui/src"];
const FORBIDDEN = /SUPABASE_SERVICE_ROLE_KEY|service_role|serverEnvSchema|parseServerEnv/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

it("keeps service-role references out of client-reachable source (complements pnpm test:bundles)", () => {
  const hits: string[] = [];
  for (const root of CLIENT_REACHABLE) {
    for (const file of files(join(repo, root))) {
      if (FORBIDDEN.test(readFileSync(file, "utf8"))) hits.push(relative(repo, file));
    }
  }
  expect(hits).toEqual([]);
});
