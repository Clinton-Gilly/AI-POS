/**
 * Environment configuration, validated at boot.
 *
 * This is the ONLY module that reads `process.env` — enforced by an ESLint
 * rule. A missing or malformed secret stops the app from starting, which is
 * strictly better than discovering it at a customer's first M-Pesa payment.
 *
 * Server-only values are never referenced from a Client Component. Reading
 * `serverEnv` in browser code throws rather than silently returning undefined,
 * so the mistake surfaces in development instead of shipping a blank secret.
 *
 * See docs/SECURITY.md §5.
 */

import { z } from "zod";

const isServer = typeof window === "undefined";

/** Values that are safe in a client bundle. */
const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("AI-POS"),
  NEXT_PUBLIC_CONVEX_URL: z.string().url(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
});

/**
 * Server-only values.
 *
 * Payment and AI credentials are optional at boot because Phase 2 does not use
 * them yet — but each is validated the moment its feature is switched on, in
 * `assertPaymentsConfigured` / `assertAIConfigured` below. Making them required
 * now would block every developer who only wants to run the dashboard.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  CONVEX_DEPLOYMENT: z.string().optional(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_CALLBACK_BASE_URL: z.string().url().optional(),
  MPESA_CALLBACK_TOKEN: z.string().min(32).optional(),
  MPESA_ALLOWED_IPS: z.string().optional(),

  AI_DEFAULT_PROVIDER: z.enum(["openai", "gemini", "anthropic"]).default("anthropic"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

function fail(scope: string, error: z.ZodError): never {
  const details = error.issues
    .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid ${scope} environment configuration:\n${details}\n\n` +
      `Copy .env.example to .env.local and fill in the missing values.`,
  );
}

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when
 * referenced statically, so these cannot be read through a dynamic key.
 */
function readPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });
  if (!parsed.success) fail("public", parsed.error);
  return parsed.data;
}

export const env: PublicEnv = readPublicEnv();

let cachedServerEnv: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!isServer) {
    throw new Error(
      "serverEnv() was called in the browser. Server-only configuration must never " +
        "reach a client bundle. See docs/SECURITY.md §5.",
    );
  }
  if (!cachedServerEnv) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) fail("server", parsed.error);
    cachedServerEnv = parsed.data;
  }
  return cachedServerEnv;
}

/**
 * Called before initiating a payment, not at boot.
 *
 * Phase 4 turns this on. Until then a developer can run the app without M-Pesa
 * credentials, but the moment payments are exercised the configuration must be
 * complete — there is no partial-credential path that could produce a
 * half-configured live payment.
 */
export function assertPaymentsConfigured(): void {
  const e = serverEnv();
  const missing = (
    [
      ["MPESA_CONSUMER_KEY", e.MPESA_CONSUMER_KEY],
      ["MPESA_CONSUMER_SECRET", e.MPESA_CONSUMER_SECRET],
      ["MPESA_PASSKEY", e.MPESA_PASSKEY],
      ["MPESA_SHORTCODE", e.MPESA_SHORTCODE],
      ["MPESA_CALLBACK_BASE_URL", e.MPESA_CALLBACK_BASE_URL],
      ["MPESA_CALLBACK_TOKEN", e.MPESA_CALLBACK_TOKEN],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`M-Pesa is not configured. Missing: ${missing.join(", ")}`);
  }
}

export function assertAIConfigured(): void {
  const e = serverEnv();
  const key = {
    openai: e.OPENAI_API_KEY,
    gemini: e.GEMINI_API_KEY,
    anthropic: e.ANTHROPIC_API_KEY,
  }[e.AI_DEFAULT_PROVIDER];

  if (!key) {
    throw new Error(
      `AI provider "${e.AI_DEFAULT_PROVIDER}" is selected but its API key is not set.`,
    );
  }
}

export const isProduction = (): boolean => serverEnv().NODE_ENV === "production";
