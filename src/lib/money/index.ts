/**
 * Money is always an integer in the currency's minor unit.
 *
 * KES 19.99 is stored as 1999, never as 19.99. Float arithmetic on money
 * produces receipts whose lines do not sum to their total, and in a POS that
 * is a customer dispute at the counter. There is no code path in this system
 * where a monetary value is a non-integer.
 *
 * See docs/ARCHITECTURE.md §4 and docs/RISKS.md R8.
 */

import { CURRENCIES, type CurrencyCode } from "@/config/currencies";

/** An integer amount in a currency's minor unit (cents, fils, …). */
export type Minor = number;

/** Basis points: 1600 = 16.00%. Tax rates are never floats, for the same reason. */
export type BasisPoints = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): asserts value is Minor {
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `${label} must be an integer in minor units, received ${value}. See docs/RISKS.md R8.`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range: ${value}`);
  }
}

/**
 * Round-half-away-from-zero.
 *
 * Deliberately not `Math.round`, which rounds -0.5 to -0 (half-up) and so
 * treats a refund line differently from the sale line it reverses. Refunds
 * must be the exact inverse of the sale, or a full refund leaves a residue.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Multiply a minor amount by a quantity. Quantities may be fractional (1.5 kg). */
export function multiply(amount: Minor, quantity: number): Minor {
  assertMinor(amount);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new MoneyError(
      `quantity must be a non-negative finite number, got ${quantity}`,
    );
  }
  return roundHalfAwayFromZero(amount * quantity);
}

/** Apply a basis-point rate to a minor amount (e.g. tax, percentage discount). */
export function applyRate(amount: Minor, rate: BasisPoints): Minor {
  assertMinor(amount);
  if (!Number.isInteger(rate) || rate < 0) {
    throw new MoneyError(
      `rate must be a non-negative integer in basis points, got ${rate}`,
    );
  }
  return roundHalfAwayFromZero((amount * rate) / 10_000);
}

/**
 * Extract the tax already contained in a tax-inclusive amount.
 *
 * Kenyan retail commonly quotes VAT-inclusive prices: a shelf price of KES 116
 * at 16% contains KES 16 of tax. This is `amount - amount / (1 + rate)`,
 * arranged to avoid an intermediate division that loses precision.
 */
export function taxFromInclusive(amount: Minor, rate: BasisPoints): Minor {
  assertMinor(amount);
  if (!Number.isInteger(rate) || rate < 0) {
    throw new MoneyError(
      `rate must be a non-negative integer in basis points, got ${rate}`,
    );
  }
  return roundHalfAwayFromZero((amount * rate) / (10_000 + rate));
}

/** Add tax on top of a tax-exclusive amount. */
export function taxFromExclusive(amount: Minor, rate: BasisPoints): Minor {
  return applyRate(amount, rate);
}

export function sum(amounts: readonly Minor[]): Minor {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount);
    total += amount;
  }
  return total;
}

/**
 * Split an amount into n parts that sum exactly to the original.
 *
 * The remainder is distributed one minor unit at a time across the leading
 * parts, so splitting 100 three ways yields [34, 33, 33] — not [33, 33, 33],
 * which loses a cent, nor [33.33, …], which is not representable.
 */
export function allocate(amount: Minor, parts: number): Minor[] {
  assertMinor(amount);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.trunc(amount / parts);
  const remainder = Math.abs(amount) - Math.abs(base) * parts;
  const step = amount < 0 ? -1 : 1;

  return Array.from({ length: parts }, (_, index) =>
    index < remainder ? base + step : base,
  );
}

/** Convert a minor amount to its major-unit decimal value, for display only. */
export function toMajor(amount: Minor, currency: CurrencyCode): number {
  assertMinor(amount);
  return amount / 10 ** CURRENCIES[currency].exponent;
}

/**
 * Parse user-entered major units ("19.99") into minor units.
 *
 * Used at input boundaries only. Everything downstream of parsing is integers.
 */
export function fromMajor(value: number | string, currency: CurrencyCode): Minor {
  const parsed =
    typeof value === "string" ? Number(value.replace(/[\s,]/g, "")) : value;
  if (!Number.isFinite(parsed)) {
    throw new MoneyError(`cannot parse "${value}" as a monetary amount`);
  }
  return roundHalfAwayFromZero(parsed * 10 ** CURRENCIES[currency].exponent);
}

/** Format for display, in the business's locale. */
export function formatMoney(
  amount: Minor,
  currency: CurrencyCode,
  locale = "en-KE",
): string {
  const { exponent } = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(toMajor(amount, currency));
}

/**
 * Format a basis-point rate for display: 1600 → "16%", 750 → "7.5%".
 *
 * Trailing zeros are trimmed rather than padded to two places: Nigeria's VAT
 * is 7.5%, and "7.50%" on a receipt reads as a rounding artefact.
 */
export function formatRate(rate: BasisPoints): string {
  const percent = rate / 100;
  return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(2))}%`;
}
