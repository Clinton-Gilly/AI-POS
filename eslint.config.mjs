import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...nextTypescript,

  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "convex/_generated/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  /**
   * ADR-0002: tenant isolation is structural, not conventional.
   *
   * Raw `ctx.db` access is confined to the repository layer (`convex/model/`)
   * and the tenancy primitives themselves (`convex/lib/`). Everywhere else,
   * data access goes through a repository, which is where `businessId` scoping
   * lives. A query written without a tenant filter is the leak this rule
   * exists to prevent — and a suppression of this rule is a review blocker,
   * not a workaround.
   */
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/model/**", "convex/lib/**", "convex/_generated/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='ctx'][property.name='db']",
          message:
            "Raw ctx.db is not allowed here. Go through a repository in convex/model/, which enforces businessId scoping. See ADR-0002.",
        },
      ],
    },
  },

  /**
   * SECURITY.md §5: only src/config/env.ts reads process.env. A secret
   * referenced anywhere else has escaped boot-time validation and may not be
   * server-only.
   *
   * convex/auth.config.ts is exempt: it is evaluated by the Convex deployment,
   * which has its own environment and never reaches a browser bundle.
   */
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "convex/**/*.ts"],
    ignores: ["src/config/env.ts", "convex/auth.config.ts", "convex/_generated/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read configuration from src/config/env.ts, which validates it at boot. See SECURITY.md §5.",
        },
      ],
    },
  },

  {
    files: ["tests/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-restricted-properties": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
