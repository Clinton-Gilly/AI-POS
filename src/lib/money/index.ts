/**
 * Money is always an integer in the currency's minor unit.
 *
 * KES 19.99 is stored as 1999, never as 19.99. Float arithmetic on money
 * produces receipts whose lines do not sum to their total, and in a POS that
 * is a customer dispute at the counter. There is no code path in this system
 * where a monetary value is a non-integer.
 *
 * The arithmetic lives in `./arithmetic`, which has no imports so Convex can
 * use it too. This module adds the parts that need the currency table:
 * conversion to and from major units, and formatting.
 *
 * See docs/ARCHITECTURE.md §4 and docs/RISKS.md R8.
 */

import { CURRENCIES, type CurrencyCode } from "@/config/currencies";
import {
  MoneyError,
  roundHalfAwayFromZero,
  type BasisPoints,
  type Minor,
} from "./arithmetic";

export {
  allocate,
  applyRate,
  assertMinor,
  MoneyError,
  multiply,
  roundHalfAwayFromZero,
  sum,
  taxFromExclusive,
  taxFromInclusive,
  type BasisPoints,
  type Minor,
} from "./arithmetic";

/** Convert a minor amount to its major-unit decimal value, for display only. */
export function toMajor(amount: Minor, currency: CurrencyCode): number {
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
