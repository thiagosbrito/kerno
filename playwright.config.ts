import { defineConfig } from "@playwright/test";

// Dedicated ports so e2e never attaches to an unrelated local server.
const ADMIN = "http://localhost:3100";
const STOREFRONT = "http://localhost:3101";

// Non-secret placeholders; real values never belong in this file.
const env = {
  NEXT_PUBLIC_ADMIN_URL: ADMIN,
  NEXT_PUBLIC_STOREFRONT_URL: STOREFRONT,
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
};

export default defineConfig({
  testDir: "e2e",
  webServer: [
    { command: "pnpm --filter @kerno/admin exec next dev --port 3100", url: ADMIN, env, reuseExistingServer: false, timeout: 120_000 },
    { command: "pnpm --filter @kerno/storefront exec next dev --port 3101", url: STOREFRONT, env, reuseExistingServer: false, timeout: 120_000 },
  ],
});
