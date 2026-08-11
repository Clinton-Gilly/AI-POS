/**
 * Supported currencies and their minor-unit exponents.
 *
 * The exponent is what makes integer money work: KES has exponent 2, so 1999
 * minor units is 19.99. Currencies with exponent 0 (UGX, RWF) have no
 * subdivision at all — storing 1999 there means 1,999 shillings, and treating
 * it as 19.99 would be a 100x error.
 */

export const CURRENCIES = {
  KES: { name: "Kenyan Shilling", symbol: "KSh", exponent: 2 },
  UGX: { name: "Ugandan Shilling", symbol: "USh", exponent: 0 },
  TZS: { name: "Tanzanian Shilling", symbol: "TSh", exponent: 2 },
  RWF: { name: "Rwandan Franc", symbol: "FRw", exponent: 0 },
  NGN: { name: "Nigerian Naira", symbol: "₦", exponent: 2 },
  GHS: { name: "Ghanaian Cedi", symbol: "GH₵", exponent: 2 },
  ZAR: { name: "South African Rand", symbol: "R", exponent: 2 },
  ETB: { name: "Ethiopian Birr", symbol: "Br", exponent: 2 },
  USD: { name: "US Dollar", symbol: "$", exponent: 2 },
  EUR: { name: "Euro", symbol: "€", exponent: 2 },
} as const satisfies Record<string, { name: string; symbol: string; exponent: number }>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value in CURRENCIES;
}

export const DEFAULT_CURRENCY: CurrencyCode = "KES";
