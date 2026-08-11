/**
 * Convex-side errors.
 *
 * Convex serialises a thrown `ConvexError`'s `data` field to the client and
 * discards everything else, so the error's public shape is exactly what we put
 * in `data` — internals cannot leak by accident.
 *
 * The code list mirrors `src/lib/errors`; both are kept deliberately small so
 * that a client can switch on the code.
 */

import { ConvexError } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NO_ACTIVE_BUSINESS"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "DUPLICATE"
  | "INSUFFICIENT_STOCK"
  | "RATE_LIMITED"
  | "INTERNAL";

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "You are not signed in.",
  FORBIDDEN: "You do not have permission to do that.",
  NO_ACTIVE_BUSINESS: "No active business selected.",
  NOT_FOUND: "That item could not be found.",
  VALIDATION: "Some of the details provided are not valid.",
  CONFLICT: "That change conflicts with the current state.",
  DUPLICATE: "That already exists.",
  INSUFFICIENT_STOCK: "There is not enough stock.",
  RATE_LIMITED: "Too many requests. Please slow down.",
  INTERNAL: "Something went wrong on our side.",
};

export function appError(
  code: ErrorCode,
  message?: string,
): ConvexError<{
  code: ErrorCode;
  message: string;
}> {
  return new ConvexError({ code, message: message ?? DEFAULT_MESSAGES[code] });
}

/**
 * Narrow an unknown throwable to our error code, for tests and callers that
 * need to branch. Returns undefined for anything we did not raise.
 */
export function errorCodeOf(error: unknown): ErrorCode | undefined {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown };
    if (typeof data?.code === "string") return data.code as ErrorCode;
  }
  return undefined;
}
