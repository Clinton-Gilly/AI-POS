/**
 * @vitest-environment edge-runtime
 *
 * The Phase 3 exit criteria.
 *
 *  - An adjustment updates the ledger and the level atomically.
 *  - sum(movements) == level, for every product, always.
 *  - Cost price is absent from payloads sent to a cashier session.
 *  - SKU and barcode are unique per business, and only per business.
 *  - None of the new entities cross tenants.
 *
 * See docs/ROADMAP.md Phase 3.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { identity, seedBusiness, setup } from "./helpers";

let t: ReturnType<typeof setup>;
let amani: Awaited<ReturnType<typeof seedBusiness>>;
let jirani: Awaited<ReturnType<typeof seedBusiness>>;

beforeEach(async () => {
  t = setup();
  amani = await seedBusiness(t, "amani");
  jirani = await seedBusiness(t, "jirani", { currency: "UGX", country: "UG" });
});

const asOwner = () => t.withIdentity(identity(amani.ownerSubject, "Amani Owner"));
const asManager = () => t.withIdentity(identity(amani.managerSubject, "Amani Manager"));
const asCashier = () => t.withIdentity(identity(amani.cashierSubject, "Amani Cashier"));

async function expectRejection(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(code));
}

async function createProduct(
  overrides: Partial<{
    name: string;
    sku: string;
    barcode: string;
    costPriceMinor: number;
    sellingPriceMinor: number;
    openingQuantity: number;
    lowStockThreshold: number;
  }> = {},
) {
  return asOwner().mutation(api.products.create, {
    name: overrides.name ?? "Maize Flour 2kg",
    sku: overrides.sku ?? "MF-2KG",
    barcode: overrides.barcode,
    unit: "packet",
    costPriceMinor: overrides.costPriceMinor ?? 17000,
    sellingPriceMinor: overrides.sellingPriceMinor ?? 21000,
    openingQuantity: overrides.openingQuantity,
    lowStockThreshold: overrides.lowStockThreshold,
  });
}

/** The core invariant, asserted directly against the database. */
async function assertLedgerMatchesLevels(businessId: string) {
  const drift = await t.run(async (ctx) => {
    const levels = await ctx.db
      .query("inventoryLevels")
      .withIndex("by_business_and_product", (q) =>
        q.eq("businessId", businessId as never),
      )
      .collect();

    const mismatches: Array<{ productId: string; level: number; derived: number }> = [];

    for (const level of levels) {
      const movements = await ctx.db
        .query("stockMovements")
        .withIndex("by_business_and_product_and_time", (q) =>
          q.eq("businessId", businessId as never).eq("productId", level.productId),
        )
        .collect();

      const derived = movements
        .filter((m) => m.locationId === level.locationId)
        .reduce((total, m) => total + m.quantityDelta, 0);

      if (derived !== level.quantity) {
        mismatches.push({
          productId: level.productId,
          level: level.quantity,
          derived,
        });
      }
    }
    return mismatches;
  });

  expect(drift).toEqual([]);
}

describe("the ledger and the projection agree", () => {
  it("holds after opening stock", async () => {
    await createProduct({ openingQuantity: 48 });
    await assertLedgerMatchesLevels(amani.businessId);
  });

  it("holds after a sequence of adjustments", async () => {
    const { productId } = await createProduct({ openingQuantity: 100 });

    for (const delta of [-10, +25, -4, -1, +50, -30]) {
      await asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: delta,
        reason: "Recount",
      });
    }

    const levels = await asOwner().query(api.inventory.levels, {});
    expect(levels[0]!.quantity).toBe(130);
    await assertLedgerMatchesLevels(amani.businessId);
  });

  it("records balanceAfter on every movement, matching the running total", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    await asOwner().mutation(api.inventory.adjust, {
      productId,
      quantityDelta: -3,
      reason: "Breakage",
    });

    const history = await asOwner().query(api.inventory.history, { productId });
    // Newest first.
    expect(history[0]!.balanceAfter).toBe(7);
    expect(history[1]!.balanceAfter).toBe(10);
  });

  it("leaves nothing behind when an adjustment is refused", async () => {
    const { productId } = await createProduct({ openingQuantity: 5 });

    await expectRejection(
      asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -10,
        reason: "Oversell attempt",
      }),
      "INSUFFICIENT_STOCK",
    );

    const levels = await asOwner().query(api.inventory.levels, {});
    expect(levels[0]!.quantity).toBe(5);

    // The rejected movement must not appear in the ledger either — the whole
    // transaction rolled back, not just the level update.
    const history = await asOwner().query(api.inventory.history, { productId });
    expect(history).toHaveLength(1);
    await assertLedgerMatchesLevels(amani.businessId);
  });
});

describe("the reconciliation job", () => {
  it("reports no drift on healthy data", async () => {
    await createProduct({ openingQuantity: 48 });
    await createProduct({ sku: "MK-500", name: "Milk 500ml", openingQuantity: 72 });

    const result = await t.mutation(
      internal.platform.maintenance.reconcileInventory,
      {},
    );
    expect(result.drifted).toBe(0);
    expect(result.checked).toBe(2);
  });

  it("detects and corrects a level that was tampered with behind the ledger", async () => {
    const { productId } = await createProduct({ openingQuantity: 48 });

    // Simulate a write path that bypassed applyMovement — the exact defect the
    // job exists to catch.
    await t.run(async (ctx) => {
      const level = await ctx.db
        .query("inventoryLevels")
        .withIndex("by_business_and_product", (q) =>
          q
            .eq("businessId", amani.businessId as never)
            .eq("productId", productId as never),
        )
        .unique();
      await ctx.db.patch(level!._id, { quantity: 999 });
    });

    const result = await t.mutation(
      internal.platform.maintenance.reconcileInventory,
      {},
    );
    expect(result.drifted).toBe(1);

    const levels = await asOwner().query(api.inventory.levels, {});
    expect(levels[0]!.quantity).toBe(48);
  });

  it("scopes its work per business", async () => {
    // The job is the one place that legitimately crosses tenants, so its
    // bookkeeping must stay per-business: a correction in one shop must not
    // touch another, and its notification must land in the right tenant.
    await createProduct({ openingQuantity: 48 });

    const asJiraniOwner = t.withIdentity(identity(jirani.ownerSubject, "Jirani Owner"));
    await asJiraniOwner.mutation(api.products.create, {
      name: "Posho 2kg",
      sku: "JIRANI-MF",
      unit: "packet",
      costPriceMinor: 1000,
      sellingPriceMinor: 2000,
      openingQuantity: 20,
    });

    const result = await t.mutation(
      internal.platform.maintenance.reconcileInventory,
      {},
    );
    expect(result.checked).toBe(2);
    expect(result.drifted).toBe(0);

    // Both businesses still hold exactly their own stock.
    expect((await asOwner().query(api.inventory.levels, {}))[0]!.quantity).toBe(48);
    expect((await asJiraniOwner.query(api.inventory.levels, {}))[0]!.quantity).toBe(20);
  });

  it("raises a notification when it corrects drift, rather than healing silently", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    await t.run(async (ctx) => {
      const level = await ctx.db
        .query("inventoryLevels")
        .withIndex("by_business_and_product", (q) =>
          q
            .eq("businessId", amani.businessId as never)
            .eq("productId", productId as never),
        )
        .unique();
      await ctx.db.patch(level!._id, { quantity: 3 });
    });

    await t.mutation(internal.platform.maintenance.reconcileInventory, {});

    const notifications = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_business", (q) => q.eq("businessId", amani.businessId as never))
        .collect(),
    );
    expect(notifications.some((n) => n.type === "inventory_drift")).toBe(true);
  });
});

describe("low stock", () => {
  it("flags a product at or below its threshold", async () => {
    const { productId } = await createProduct({
      openingQuantity: 20,
      lowStockThreshold: 12,
    });

    expect(await asOwner().query(api.inventory.lowStock, {})).toHaveLength(0);

    await asOwner().mutation(api.inventory.adjust, {
      productId,
      quantityDelta: -8,
      reason: "Sold",
    });

    const low = await asOwner().query(api.inventory.lowStock, {});
    expect(low).toHaveLength(1);
    expect(low[0]!.quantity).toBe(12);
  });

  it("re-evaluates immediately when the threshold changes", async () => {
    const { productId } = await createProduct({
      openingQuantity: 20,
      lowStockThreshold: 5,
    });
    expect(await asOwner().query(api.inventory.lowStock, {})).toHaveLength(0);

    // Raising the threshold must take effect now, not at the next movement.
    await asOwner().mutation(api.products.update, {
      productId,
      lowStockThreshold: 25,
    });

    expect(await asOwner().query(api.inventory.lowStock, {})).toHaveLength(1);
  });

  it("does not repeat an alert for the same product within a day", async () => {
    const { productId } = await createProduct({
      openingQuantity: 20,
      lowStockThreshold: 25,
    });
    expect(productId).toBeDefined();

    const first = await t.mutation(internal.platform.maintenance.scanLowStock, {});
    expect(first.raised).toBe(1);

    const second = await t.mutation(internal.platform.maintenance.scanLowStock, {});
    expect(second.raised).toBe(0);
  });
});

describe("financial data is stripped at the boundary", () => {
  beforeEach(async () => {
    await createProduct({ openingQuantity: 48 });
  });

  it("gives the owner cost price", async () => {
    const products = await asOwner().query(api.products.list, {});
    expect(products[0]!.costPriceMinor).toBe(17000);
  });

  it("withholds cost price from a cashier", async () => {
    const products = await asCashier().query(api.products.list, {});
    expect(products[0]!.sellingPriceMinor).toBe(21000);
    expect(products[0]).not.toHaveProperty("costPriceMinor");
  });

  it("withholds cost price from a manager", async () => {
    const products = await asManager().query(api.products.list, {});
    expect(products[0]).not.toHaveProperty("costPriceMinor");
  });

  it("withholds cost price from the till's search results", async () => {
    // The query a cashier's terminal calls on every keystroke.
    const results = await asCashier().query(api.products.search, { term: "Maize" });
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("costPriceMinor");
  });

  it("withholds cost price from a single-product read", async () => {
    const list = await asCashier().query(api.products.list, {});
    const single = await asCashier().query(api.products.get, {
      productId: list[0]!._id,
    });
    expect(single).not.toHaveProperty("costPriceMinor");
  });

  it("withholds stock value from inventory levels for a cashier", async () => {
    const levels = await asCashier().query(api.inventory.levels, {});
    expect(levels[0]).not.toHaveProperty("stockValueMinor");
  });

  it("refuses the valuation report to anyone but the owner", async () => {
    await expectRejection(asCashier().query(api.inventory.valuation, {}), "FORBIDDEN");
    await expectRejection(asManager().query(api.inventory.valuation, {}), "FORBIDDEN");

    const valuation = await asOwner().query(api.inventory.valuation, {});
    expect(valuation.totalCostMinor).toBe(17000 * 48);
  });
});

describe("permissions", () => {
  it("denies a cashier stock adjustments", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    await expectRejection(
      asCashier().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -1,
        reason: "Shrinkage",
      }),
      "FORBIDDEN",
    );
  });

  it("denies a cashier product creation", async () => {
    await expectRejection(
      asCashier().mutation(api.products.create, {
        name: "Contraband",
        sku: "CB-1",
        unit: "piece",
        costPriceMinor: 100,
        sellingPriceMinor: 200,
      }),
      "FORBIDDEN",
    );
  });

  it("allows a manager stock adjustments", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    const result = await asManager().mutation(api.inventory.adjust, {
      productId,
      quantityDelta: -2,
      reason: "Damaged in transit",
    });
    expect(result.balanceAfter).toBe(8);
  });

  it("requires a reason for an adjustment", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    await expectRejection(
      asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -1,
        reason: "   ",
      }),
      "VALIDATION",
    );
  });

  it("audits every adjustment with its reason", async () => {
    const { productId } = await createProduct({ openingQuantity: 10 });
    await asOwner().mutation(api.inventory.adjust, {
      productId,
      quantityDelta: -3,
      reason: "Expired stock discarded",
    });

    const entries = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_business_and_action", (q) =>
          q.eq("businessId", amani.businessId as never).eq("action", "stock.adjusted"),
        )
        .collect(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({
      quantityDelta: -3,
      reason: "Expired stock discarded",
    });
  });
});

describe("negative stock", () => {
  it("is refused by default", async () => {
    const { productId } = await createProduct({ openingQuantity: 3 });
    await expectRejection(
      asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -5,
        reason: "Sold more than recorded",
      }),
      "INSUFFICIENT_STOCK",
    );
  });

  it("is allowed once the business opts in", async () => {
    await asOwner().mutation(api.businesses.updateSettings, {
      negativeStockAllowed: true,
    });

    const { productId } = await createProduct({ openingQuantity: 3 });
    const result = await asOwner().mutation(api.inventory.adjust, {
      productId,
      quantityDelta: -5,
      reason: "Sold ahead of delivery",
    });

    expect(result.balanceAfter).toBe(-2);
    await assertLedgerMatchesLevels(amani.businessId);
  });
});
