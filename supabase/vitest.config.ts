import { defineConfig } from "vitest/config";

// Files share one database when KERNO_TEST_DATABASE_URL is set, and each suite truncates and
// reseeds it, so files must not run concurrently.
export default defineConfig({ test: { fileParallelism: false } });
