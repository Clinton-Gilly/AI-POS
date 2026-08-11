import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    // Convex functions need an edge-like runtime. Files under tests/convex opt
    // in with a `@vitest-environment edge-runtime` docblock, which keeps the
    // pure unit tests in the faster default environment.
    environment: "node",
    // The demo-data suite runs a chain of one mutation per simulated trading
    // day in-process, so it needs more than the 5s default.
    testTimeout: 60_000,
    server: { deps: { inline: ["convex-test"] } },
  },
});
