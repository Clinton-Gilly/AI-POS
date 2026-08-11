import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    // Convex functions need an edge-like runtime. Files under tests/convex opt
    // in with a `@vitest-environment edge-runtime` docblock, which keeps the
    // pure unit tests in the faster default environment.
    environment: "node",
    server: { deps: { inline: ["convex-test"] } },
  },
});
