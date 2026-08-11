/**
 * Typed application errors.
 *
 * Clients receive a stable code and a safe message. Stack traces, query
 * details and provider responses stay server-side. Errors fail closed: an
 * authorization check that throws denies access, it never falls through to a
 * permissive default.
 *
 * See docs/SECURITY.md §9.
 */

export const ERROR_CODES = {
  UNAUTHENTICATED: { status: 401, message: "You are not signed in." },
  FORBIDDEN: { status: 403, message: "You do not have permission to do that." },
  NO_ACTIVE_BUSINESS: { status: 403, message: "No active business selected." },
  NOT_FOUND: { status: 404, message: "That item could not be found." },
  VALIDATION: { status: 400, message: "Some of the details provided are not valid." },
  CONFLICT: { status: 409, message: "That change conflicts with the current state." },
  DUPLICATE: { status: 409, message: "That already exists." },
  INSUFFICIENT_STOCK: { status: 409, message: "There is not enough stock." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please slow down." },
  PAYMENT_FAILED: { status: 402, message: "The payment could not be completed." },
  PROVIDER_ERROR: { status: 502, message: "An external service is unavailable." },
  INTERNAL: { status: 500, message: "Something went wrong on our side." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Safe to show a user. Never contains internals. */
  readonly publicMessage: string;
  /** Server-side only. Never serialised to a client. */
  readonly context: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    options?: {
      publicMessage?: string;
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    const spec = ERROR_CODES[code];
    super(options?.publicMessage ?? spec.message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = spec.status;
    this.publicMessage = options?.publicMessage ?? spec.message;
    this.context = options?.context;
  }

  /** The only shape that crosses the wire to a client. */
  toClient(): { code: ErrorCode; message: string } {
    return { code: this.code, message: this.publicMessage };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalise anything thrown into a client-safe payload.
 *
 * An unrecognised error becomes INTERNAL with a generic message: an unexpected
 * error's message may contain a connection string, a query or a provider
 * response, none of which belong in a browser.
 */
export function toClientError(error: unknown): { code: ErrorCode; message: string } {
  if (isAppError(error)) return error.toClient();
  return { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message };
}
