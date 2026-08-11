/**
 * Structured logging with central redaction.
 *
 * Redaction happens here, once, rather than at each call site — a rule that
 * depends on every developer remembering it will be broken. PII, phone
 * numbers, tokens and payment payloads never reach log aggregation; raw
 * webhook bodies live in the access-controlled `paymentEvents` table instead.
 *
 * See docs/SECURITY.md §9.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Keys whose values are replaced with "[redacted]" wherever they appear,
 * at any depth. Matching is case-insensitive and substring-based, so
 * `mpesaConsumerSecret` is caught by "secret".
 */
const REDACTED_KEYS = [
  "password",
  "pin",
  "pinhash",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "phone",
  "msisdn",
  "email",
  "payload",
  "rawbody",
  "callback",
  "consumerkey",
  "passkey",
];

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

function shouldRedact(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, "");
  return REDACTED_KEYS.some((needle) =>
    normalised.includes(needle.replace(/[^a-z]/g, "")),
  );
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = shouldRedact(key) ? REDACTED : redact(item, depth + 1);
  }
  return output;
}

export interface LogFields {
  /** Correlates every line emitted while handling one request. */
  requestId?: string;
  businessId?: string;
  userId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(redact(fields) as Record<string, unknown>),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Configured by the app's entry point from validated config, not read from the
 * environment here — this module is also imported by Convex functions, which
 * have their own environment and no access to `src/config/env.ts`.
 */
let currentLevel: LogLevel = "info";
let includeStacks = false;

export function configureLogger(options: {
  level?: LogLevel;
  includeStacks?: boolean;
}): void {
  if (options.level) currentLevel = options.level;
  if (options.includeStacks !== undefined) includeStacks = options.includeStacks;
}

/**
 * An error is logged by shape, never by spreading the object: `Error` has
 * non-enumerable properties, and a `cause` chain can carry a provider response
 * containing customer data. Stack traces are opt-in and stay off in production.
 */
function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(includeStacks ? { stack: error.stack } : {}),
    };
  }
  return { errorName: "UnknownError", errorMessage: String(error) };
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, error?: unknown, fields?: LogFields) =>
    emit("error", message, { ...fields, ...(error ? errorFields(error) : {}) }),

  /** Returns a logger that stamps the given fields onto every line. */
  child(base: LogFields) {
    return {
      debug: (message: string, fields?: LogFields) =>
        emit("debug", message, { ...base, ...fields }),
      info: (message: string, fields?: LogFields) =>
        emit("info", message, { ...base, ...fields }),
      warn: (message: string, fields?: LogFields) =>
        emit("warn", message, { ...base, ...fields }),
      error: (message: string, error?: unknown, fields?: LogFields) =>
        emit("error", message, {
          ...base,
          ...fields,
          ...(error ? errorFields(error) : {}),
        }),
    };
  },
};
