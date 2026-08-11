/**
 * Integer money arithmetic — the half that has no currency-table dependency.
 *
 * Split out from `index.ts` so Convex functions can import it directly.
 * Convex bundles `convex/` with its own resolver and does not know the `@/`
 * path alias, so anything it imports must be alias-free. Duplicating this
 * arithmetic on the backend would be worse than the split: two copies of
 * rounding rules drift, and the drift shows up as receipts whose lines do not
 * sum to their total.
 *
 * Everything here is pure and takes integers in a currency's minor unit.
 * See docs/RISKS.md R8.
 */

/** An integer amount in a currency's minor unit (cents, fils, …). */
export type Minor = number;

/** Basis points: 1600 = 16.00%. Rates are never floats, for the same reason. */
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

/** Apply a basis-point rate to a minor amount (tax, percentage discount). */
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
