import { defineConfig } from "@playwright/test";

// Dedicated ports so e2e never attaches to an unrelated local server.
const ADMIN = "http://localhost:3100";
const STOREFRONT = "http://localhost:3101"; // readiness uses the port: the apex correctly answers 404

// Non-secret placeholders; real values never belong in this file.
const env = {
  NEXT_PUBLIC_ADMIN_URL: ADMIN,
  NEXT_PUBLIC_STOREFRONT_URL: STOREFRONT,
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  // Seeded-store e2e (E2E_SEEDED_STORES=1) passes the local stack's own anon key here.
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "test-anon-placeholder",
  // Merchant-auth e2e (E2E_MERCHANT_AUTH=1) passes the local stack's own service key for audit writes.
  SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "test-service-placeholder",
  PLATFORM_DOMAIN: "localhost",
};

export default defineConfig({
  testDir: "e2e",
  webServer: [
    { command: "pnpm --filter @kerno/admin exec next dev --port 3100", url: ADMIN, env, reuseExistingServer: false, timeout: 120_000 },
    { command: "pnpm --filter @kerno/storefront exec next dev --port 3101", port: 3101, env, reuseExistingServer: false, timeout: 120_000 },
  ],
});
