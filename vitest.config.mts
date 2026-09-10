import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // Next.js supplies this at build time; it is a guard, not runtime code.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The money paths are SQL. Mocking the database would only test the mock, so
    // the store tests run against a real PostgreSQL and clean up after themselves.
    setupFiles: ["src/test/setup.ts"],
    // Fixtures share tables; running files in parallel makes cleanup racy.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
