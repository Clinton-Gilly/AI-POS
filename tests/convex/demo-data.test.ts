/**
 * @vitest-environment edge-runtime
 *
 * Demo data has to obey the same rules as real data.
 *
 * The point of this suite: seeded sales write stock movements and update
 * levels exactly as a real sale will, so `sum(movements) == level` still
 * holds. Seed data that broke the invariant would make the first nightly
 * reconciliation report drift on data we generated ourselves — and would
 * teach everyone to ignore that alert.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "@convex/_generated/api";
import { drainScheduler, identity, seedBusiness, setup } from "./helpers";

let t: ReturnType<typeof setup>;
let amani: Awaited<ReturnType<typeof seedBusiness>>;

beforeEach(async () => {
  t = setup();
  amani = await seedBusiness(t, "amani");
});

const asOwner = () => t.withIdentity(identity(amani.ownerSubject, "Amani Owner"));

/**
 * Seed the catalogue, then run the sales chain to completion.
 *
 * 28 days rather than the 90-day default: four of every weekday is enough to
 * assert the weekly shape, and the chain runs one mutation per day in-process,
 * so the full span would dominate the suite's runtime for no extra coverage.
 */
const TEST_DAYS = 28;

async function seedEverything() {
  await t.mutation(internal.platform.seed.seedCatalogue, {
    businessId: amani.businessId as never,
  });
  await t.mutation(internal.platform.demoData.seedDemoBusiness, {
    businessId: amani.businessId as never,
    days: TEST_DAYS,
  });
  // The day chain schedules itself; drain it.
  await drainScheduler(t);
}

describe("the catalogue seed", () => {
  it("creates products, categories and suppliers", async () => {
    const result = await t.mutation(internal.platform.seed.seedCatalogue, {
      businessId: amani.businessId as never,
    });

    expect(result.skipped).toBe(false);
    expect(result.products).toBeGreaterThan(60);
    expect(result.categories).toBeGreaterThan(8);
    expect(result.suppliers).toBe(4);
  });

  it("refuses to run twice", async () => {
    await t.mutation(internal.platform.seed.seedCatalogue, {
      businessId: amani.businessId as never,
    });
    const second = await t.mutation(internal.platform.seed.seedCatalogue, {
      businessId: amani.businessId as never,
    });

    expect(second.skipped).toBe(true);
  });

  it("leaves the ledger balanced", async () => {
    await t.mutation(internal.platform.seed.seedCatalogue, {
      businessId: amani.businessId as never,
    });
    const result = await t.mutation(
      internal.platform.maintenance.reconcileInventory,
      {},
    );
    expect(result.drifted).toBe(0);
  });
});

describe("the demo trading history", () => {
  it("refuses to run without a catalogue", async () => {
    const result = await t.mutation(internal.platform.demoData.seedDemoBusiness, {
      businessId: amani.businessId as never,
    });
    expect(result.skipped).toBe(true);
  });

  it("produces sales, payments and customers", async () => {
    await seedEverything();

    const counts = await t.run(async (ctx) => ({
      sales: (
        await ctx.db
          .query("sales")
          .withIndex("by_business_and_completed_at", (q) =>
            q.eq("businessId", amani.businessId as never),
          )
          .collect()
      ).length,
      lines: (
        await ctx.db
          .query("saleLines")
          .withIndex("by_business_and_product", (q) =>
            q.eq("businessId", amani.businessId as never),
          )
          .collect()
      ).length,
      payments: (
        await ctx.db
          .query("payments")
          .withIndex("by_business_and_status", (q) =>
            q.eq("businessId", amani.businessId as never).eq("status", "succeeded"),
          )
          .collect()
      ).length,
      customers: (
        await ctx.db
          .query("customers")
          .withIndex("by_business", (q) =>
            q.eq("businessId", amani.businessId as never),
          )
          .collect()
      ).length,
    }));

    expect(counts.sales).toBeGreaterThan(200);
    expect(counts.lines).toBeGreaterThan(counts.sales);
    // Exactly one payment per sale — no sale is left unpaid or double-paid.
    expect(counts.payments).toBe(counts.sales);
    expect(counts.customers).toBe(40);
  });

  it("keeps the ledger invariant after thousands of sales", async () => {
    await seedEverything();

    const result = await t.mutation(
      internal.platform.maintenance.reconcileInventory,
      {},
    );
    expect(result.drifted).toBe(0);
    expect(result.checked).toBeGreaterThan(60);
  });

  it("never drives stock negative", async () => {
    await seedEverything();

    const levels = await asOwner().query(api.inventory.levels, {});
    expect(levels.every((level) => level.quantity >= 0)).toBe(true);
  });

  it("keeps every sale's totals internally consistent", async () => {
    await seedEverything();

    const problems = await t.run(async (ctx) => {
      const sales = await ctx.db
        .query("sales")
        .withIndex("by_business_and_completed_at", (q) =>
          q.eq("businessId", amani.businessId as never),
        )
        .take(200);

      const bad: string[] = [];
      for (const sale of sales) {
        const lines = await ctx.db
          .query("saleLines")
          .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
          .collect();

        const lineSum = lines.reduce((total, l) => total + l.lineTotalMinor, 0);
        if (lineSum !== sale.subtotalMinor) bad.push(`${sale.number}: subtotal`);
        // Tax-inclusive pricing: the total is the subtotal, tax is inside it.
        if (sale.totalMinor !== sale.subtotalMinor) bad.push(`${sale.number}: total`);
        if (sale.amountPaidMinor < sale.totalMinor)
          bad.push(`${sale.number}: underpaid`);
        if (!Number.isInteger(sale.totalMinor)) bad.push(`${sale.number}: not integer`);
        if (lines.length === 0) bad.push(`${sale.number}: no lines`);
      }
      return bad;
    });

    expect(problems).toEqual([]);
  });

  it("has a Saturday peak, which is the insight the AI is meant to find", async () => {
    await seedEverything();

    const byWeekday = await t.run(async (ctx) => {
      const sales = await ctx.db
        .query("sales")
        .withIndex("by_business_and_completed_at", (q) =>
          q.eq("businessId", amani.businessId as never),
        )
        .collect();

      const totals = new Array(7).fill(0);
      for (const sale of sales) {
        if (!sale.completedAt) continue;
        totals[new Date(sale.completedAt).getUTCDay()] += sale.totalMinor;
      }
      return totals as number[];
    });

    const saturday = byWeekday[6]!;
    const busiest = Math.max(...byWeekday);
    expect(saturday).toBe(busiest);
    // And it should be a clear peak, not a rounding-error win.
    expect(saturday).toBeGreaterThan(byWeekday[1]! * 1.4);
  });

  it("refuses to run twice", async () => {
    await seedEverything();
    const second = await t.mutation(internal.platform.demoData.seedDemoBusiness, {
      businessId: amani.businessId as never,
    });
    expect(second.skipped).toBe(true);
  });

  it("stays inside its own tenant", async () => {
    const jirani = await seedBusiness(t, "jirani");
    await seedEverything();

    const otherSales = await t.run(async (ctx) =>
      ctx.db
        .query("sales")
        .withIndex("by_business_and_completed_at", (q) =>
          q.eq("businessId", jirani.businessId as never),
        )
        .collect(),
    );
    expect(otherSales).toHaveLength(0);
  });
});
