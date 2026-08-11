/**
 * Money arithmetic for Convex functions.
 *
 * Re-exported from the shared implementation rather than duplicated: two
 * copies of the rounding rules would drift, and drift between the till's
 * arithmetic and the server's is exactly how receipts stop reconciling.
 *
 * Only the alias-free `arithmetic` module is imported — Convex bundles this
 * directory with its own resolver and does not understand the `@/` path alias.
 */

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
} from "../../src/lib/money/arithmetic";
