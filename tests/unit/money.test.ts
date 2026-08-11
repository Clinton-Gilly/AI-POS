import { describe, expect, it } from "vitest";
import {
  allocate,
  applyRate,
  formatRate,
  fromMajor,
  MoneyError,
  multiply,
  roundHalfAwayFromZero,
  sum,
  taxFromExclusive,
  taxFromInclusive,
  toMajor,
} from "@/lib/money";

describe("integer money", () => {
  it("rejects non-integer amounts everywhere", () => {
    expect(() => multiply(19.99, 2)).toThrow(MoneyError);
    expect(() => applyRate(10.5, 1600)).toThrow(MoneyError);
    expect(() => sum([100, 50.5])).toThrow(MoneyError);
  });

  it("rejects unsafe integers rather than silently losing precision", () => {
    expect(() => multiply(Number.MAX_SAFE_INTEGER + 2, 1)).toThrow(MoneyError);
  });
});

describe("roundHalfAwayFromZero", () => {
  it("rounds halves away from zero symmetrically", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
  });

  it("is symmetric, unlike Math.round, so a refund exactly reverses its sale", () => {
    // Math.round(-0.5) is -0, which would leave a residue on a refunded line.
    for (const value of [0.5, 1.5, 2.5, 12.5, 1234.5]) {
      expect(roundHalfAwayFromZero(-value)).toBe(-roundHalfAwayFromZero(value));
    }
  });
});

describe("multiply", () => {
  it("handles fractional quantities for weighed goods", () => {
    // 1.5 kg of maize flour at KES 120.00/kg
    expect(multiply(12_000, 1.5)).toBe(18_000);
  });

  it("rounds to whole minor units", () => {
    expect(multiply(333, 3)).toBe(999);
    expect(multiply(10, 0.333)).toBe(3);
  });

  it("rejects negative quantities", () => {
    expect(() => multiply(100, -1)).toThrow(MoneyError);
  });
});

describe("tax", () => {
  it("adds exclusive VAT on top", () => {
    // KES 100.00 + 16% = KES 16.00 tax
    expect(taxFromExclusive(10_000, 1600)).toBe(1600);
  });

  it("extracts inclusive VAT from a shelf price", () => {
    // A KES 116.00 shelf price at 16% contains KES 16.00 of tax.
    expect(taxFromInclusive(11_600, 1600)).toBe(1600);
  });

  it("round-trips between inclusive and exclusive", () => {
    const net = 10_000;
    const tax = taxFromExclusive(net, 1600);
    expect(taxFromInclusive(net + tax, 1600)).toBe(tax);
  });

  it("treats a zero rate as no tax, for businesses that are not VAT registered", () => {
    expect(taxFromInclusive(11_600, 0)).toBe(0);
    expect(taxFromExclusive(11_600, 0)).toBe(0);
  });

  it("rejects float rates", () => {
    expect(() => applyRate(10_000, 16.5)).toThrow(MoneyError);
  });
});

describe("allocate", () => {
  it("splits without losing or inventing a minor unit", () => {
    expect(allocate(100, 3)).toEqual([34, 33, 33]);
    expect(sum(allocate(100, 3))).toBe(100);
  });

  it("splits evenly when it divides exactly", () => {
    expect(allocate(99, 3)).toEqual([33, 33, 33]);
  });

  it("preserves the total for any split", () => {
    for (const amount of [1, 7, 100, 9_999, 123_457]) {
      for (const parts of [2, 3, 7, 11]) {
        expect(sum(allocate(amount, parts))).toBe(amount);
      }
    }
  });

  it("handles negative amounts, as a split refund requires", () => {
    expect(sum(allocate(-100, 3))).toBe(-100);
  });

  it("rejects a non-positive part count", () => {
    expect(() => allocate(100, 0)).toThrow(MoneyError);
  });
});

describe("major/minor conversion", () => {
  it("respects the currency exponent", () => {
    expect(fromMajor("19.99", "KES")).toBe(1999);
    expect(toMajor(1999, "KES")).toBe(19.99);
  });

  it("treats zero-exponent currencies as whole units", () => {
    // UGX has no subdivision: 1999 minor units is 1,999 shillings, not 19.99.
    expect(fromMajor(1999, "UGX")).toBe(1999);
    expect(toMajor(1999, "UGX")).toBe(1999);
  });

  it("parses amounts typed with separators", () => {
    expect(fromMajor("1,234.50", "KES")).toBe(123_450);
    expect(fromMajor("1 234.50", "KES")).toBe(123_450);
  });

  it("rejects unparseable input rather than producing NaN", () => {
    expect(() => fromMajor("abc", "KES")).toThrow(MoneyError);
  });

  it("never produces a float from a round trip", () => {
    for (const value of ["0.01", "0.1", "1.005", "19.99", "1234.56"]) {
      expect(Number.isInteger(fromMajor(value, "KES"))).toBe(true);
    }
  });
});

describe("formatRate", () => {
  it("renders whole percentages without decimals", () => {
    expect(formatRate(1600)).toBe("16%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(750)).toBe("7.5%");
  });
});
