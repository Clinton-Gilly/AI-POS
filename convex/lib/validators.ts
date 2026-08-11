/**
 * Shared argument validators and normalisation helpers for Convex functions.
 *
 * Convex validates argument *shapes* at the boundary; these add the domain
 * rules on top — length caps on free text, non-negative money, phone
 * normalisation. Bounds exist on every string a client can send: an
 * unbounded text field is a storage-cost and log-noise vector.
 */

import { appError } from "./errors";

export const MAX_NAME = 120;
export const MAX_TEXT = 500;
export const MAX_NOTES = 2000;

export function cleanString(
  value: string,
  field: string,
  { max = MAX_NAME, min = 1 }: { max?: number; min?: number } = {},
): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < min) throw appError("VALIDATION", `${field} is required.`);
  if (trimmed.length > max) {
    throw appError("VALIDATION", `${field} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

export function optionalString(
  value: string | undefined,
  field: string,
  max = MAX_TEXT,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > max) {
    throw appError("VALIDATION", `${field} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Normalise a Kenyan/East African phone number to E.164.
 *
 * Shop staff type "0712345678", "+254712345678" and "254712345678"
 * interchangeably. Storing them unnormalised makes the customer-by-phone
 * lookup miss and creates duplicate customer records for one person.
 */
export function normalisePhone(
  value: string | undefined,
  defaultCountryCode = "254",
): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.length === 0) return undefined;

  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+${defaultCountryCode}${digits.slice(1)}`;
  if (digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return `+${defaultCountryCode}${digits}`;
}

export function assertNonNegativeMinor(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw appError("VALIDATION", `${field} must be a whole number of cents.`);
  }
  if (value < 0) throw appError("VALIDATION", `${field} cannot be negative.`);
}

export function assertBasisPoints(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw appError("VALIDATION", `${field} must be between 0 and 10000 basis points.`);
  }
}

/** URL-safe business slug derived from the business name. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function assertHexColor(value: string, field: string): string {
  if (!HEX_COLOR.test(value)) {
    throw appError("VALIDATION", `${field} must be a hex colour such as #1F6FEB.`);
  }
  return value.toUpperCase();
}
