/**
 * Demo trading history.
 *
 * Fills a business with what a real duka accumulates: customers, and ninety
 * days of sales with the shape a Kenyan retail week actually has — a Saturday
 * peak, a quiet Monday, month-end spikes after salaries land, and a long tail
 * of small baskets. Dashboards (Phase 5) and AI insights (Phase 6) are
 * meaningless against flat or toy data: a trend chart over uniform random
 * sales shows nothing, and an assistant asked "why did sales drop?" has no
 * real answer to find.
 *
 * Two constraints shaped the implementation:
 *
 *  1. **Transaction size.** Ninety days of sales is thousands of documents,
 *     far past what one Convex mutation should write. Each day is its own
 *     mutation, and each schedules the next — sequential rather than parallel,
 *     so concurrent days cannot contend on the same inventory rows.
 *
 *  2. **The ledger invariant must survive.** Seeded sales write stock
 *     movements and update levels exactly as `applyMovement` does, so
 *     `sum(movements) == level` still holds and the nightly reconciliation
 *     finds zero drift. Seed data that broke the invariant would make the
 *     first real reconciliation run look like a bug.
 *
 * Guarded like the catalogue seed: `internalMutation` only, refuses to run
 * twice, and only ever inserts.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { taxFromInclusive } from "../lib/money";

/** Default span of trading history. Overridable — tests seed a shorter run. */
const DEFAULT_DAYS = 90;

/**
 * Deterministic PRNG (mulberry32).
 *
 * Seeded rather than `Math.random` so a demo is reproducible: the same
 * business seeded twice tells the same story, which matters when someone is
 * comparing a screenshot to what they see on screen.
 */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMER_NAMES = [
  "Grace Wanjiku",
  "Peter Otieno",
  "Mary Njeri",
  "John Kamau",
  "Faith Chebet",
  "Samuel Mwangi",
  "Esther Akinyi",
  "David Kiprop",
  "Lucy Wambui",
  "Joseph Mutua",
  "Ann Nyambura",
  "Brian Ochieng",
  "Catherine Wairimu",
  "Dennis Kimani",
  "Elizabeth Adhiambo",
  "Francis Njoroge",
  "Gladys Moraa",
  "Henry Barasa",
  "Irene Chelangat",
  "James Maina",
  "Joyce Atieno",
  "Kevin Mwenda",
  "Linet Kwamboka",
  "Michael Onyango",
  "Nancy Wangeci",
  "Oscar Kiplagat",
  "Pauline Mueni",
  "Robert Waweru",
  "Sarah Jepkorir",
  "Thomas Odhiambo",
  "Veronica Nduta",
  "Wilson Kibet",
  "Agnes Karimi",
  "Benard Simiyu",
  "Christine Auma",
  "Daniel Ngugi",
  "Emily Wanjiru",
  "Felix Muthomi",
  "Hellen Achieng",
  "Isaac Kariuki",
];

/**
 * How busy each weekday is, relative to a Tuesday.
 *
 * Saturday is the week's peak — the requirements document calls this out as an
 * insight the AI should surface, so the data has to actually contain it.
 * Sunday is short trading, Monday is the quietest full day.
 */
const WEEKDAY_WEIGHT: Record<number, number> = {
  0: 0.75, // Sunday
  1: 0.85, // Monday
  2: 1.0,
  3: 1.05,
  4: 1.15,
  5: 1.4, // Friday — payday-adjacent
  6: 1.85, // Saturday
};

export const seedDemoBusiness = internalMutation({
  args: { businessId: v.id("businesses"), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(args.days ?? DEFAULT_DAYS, 365));
    const business = await ctx.db.get(args.businessId);
    if (!business) throw new Error("Business not found");

    const existingSale = await ctx.db
      .query("sales")
      .withIndex("by_business_and_completed_at", (q) =>
        q.eq("businessId", args.businessId),
      )
      .first();
    if (existingSale) {
      return { skipped: true, reason: "This business already has sales." };
    }

    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
    if (products.length === 0) {
      return { skipped: true, reason: "Seed the catalogue first." };
    }

    const random = makeRandom(0x5eed_a105 ^ products.length);

    // Roughly a third of shoppers are known to the shop; the rest are walk-ins.
    let customerCount = 0;
    for (const name of CUSTOMER_NAMES) {
      const suffix = String(100000 + Math.floor(random() * 899999));
      await ctx.db.insert("customers", {
        businessId: args.businessId,
        name,
        phone: `+2547${suffix.slice(0, 2)}${suffix.slice(2)}`,
        loyaltyPoints: 0,
        totalSpendMinor: 0,
        purchaseCount: 0,
        isActive: true,
      });
      customerCount++;
    }

    // Day 0 is the oldest day; the chain walks forward to today.
    await ctx.scheduler.runAfter(0, internal.platform.demoData.seedSalesForDay, {
      businessId: args.businessId,
      dayIndex: 0,
      days,
    });

    return { skipped: false, customers: customerCount, daysScheduled: days };
  },
});

/**
 * One trading day, then schedule the next.
 *
 * Sequential by design. Scheduling all ninety at once would have them contend
 * on the same inventory documents, and Convex's optimistic concurrency would
 * spend the run retrying rather than writing.
 */
export const seedSalesForDay = internalMutation({
  args: {
    businessId: v.id("businesses"),
    dayIndex: v.number(),
    days: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.dayIndex >= args.days) return { done: true, dayIndex: args.dayIndex };

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new Error("Business not found");

    const location = await ctx.db
      .query("locations")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .first();
    if (!location) throw new Error("Business has no location");

    const products = await ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();

    const cashier = await pickCashier(ctx, args.businessId, business.ownerUserId);

    const taxRate = business.settings.defaultTaxRateId
      ? await ctx.db.get(business.settings.defaultTaxRateId)
      : null;
    const rateBasisPoints = taxRate?.rateBasisPoints ?? 0;
    const taxInclusive = business.settings.taxInclusivePricing;

    const dayStart = startOfDayUtc(args.days - args.dayIndex);
    const date = new Date(dayStart);
    const weekday = date.getUTCDay();

    const random = makeRandom(0xd0_0d + args.dayIndex * 7919);

    // Month-end lift: salaries land, and the shop feels it for a few days.
    const dayOfMonth = date.getUTCDate();
    const monthEndLift = dayOfMonth >= 28 || dayOfMonth <= 3 ? 1.25 : 1;

    const baseTransactions = 34;
    const transactions = Math.max(
      6,
      Math.round(
        baseTransactions *
          (WEEKDAY_WEIGHT[weekday] ?? 1) *
          monthEndLift *
          (0.8 + random() * 0.4),
      ),
    );

    // Popularity is long-tailed: staples move constantly, the rest trickle.
    const sellable = products.filter((p) => p.isActive && p.trackInventory);
    if (sellable.length === 0) return { done: false, dayIndex: args.dayIndex };

    // Deliveries arrive Monday and Thursday. Without them the shop sells out
    // within a month and the rest of the history is empty — and worse, the
    // weekday pattern gets confounded by depletion rather than by demand,
    // which is precisely the signal this data exists to carry.
    let restocked = 0;
    if (weekday === 1 || weekday === 4) {
      restocked = await restockLowProducts(ctx, {
        businessId: args.businessId,
        locationId: location._id,
        actorUserId: business.ownerUserId,
        products: sellable,
        at: dayStart + 6 * 3600_000,
        random,
      });
    }

    let created = 0;

    for (let n = 0; n < transactions; n++) {
      const made = await createSeedSale(ctx, {
        business,
        locationId: location._id,
        cashierUserId: cashier,
        products: sellable,
        customers,
        random,
        dayStart,
        sequence: args.dayIndex * 1000 + n,
        rateBasisPoints,
        taxInclusive,
      });
      if (made) created++;
    }

    await ctx.scheduler.runAfter(0, internal.platform.demoData.seedSalesForDay, {
      businessId: args.businessId,
      dayIndex: args.dayIndex + 1,
      days: args.days,
    });

    return { done: false, dayIndex: args.dayIndex, sales: created, restocked };
  },
});

/**
 * A delivery: top up anything at or near its reorder point.
 *
 * Written as `purchase` movements through the same ledger-plus-level pair as
 * everything else, so the invariant holds and the movement history reads the
 * way a real one does — sales draining stock, deliveries refilling it.
 */
async function restockLowProducts(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    locationId: Id<"locations">;
    actorUserId: Id<"users">;
    products: Doc<"products">[];
    at: number;
    random: () => number;
  },
): Promise<number> {
  let count = 0;

  for (const product of input.products) {
    const level = await ctx.db
      .query("inventoryLevels")
      .withIndex("by_business_and_location_and_product", (q) =>
        q
          .eq("businessId", input.businessId)
          .eq("locationId", input.locationId)
          .eq("productId", product._id),
      )
      .unique();
    if (!level) continue;

    const reorderPoint = Math.max(level.lowStockThreshold * 2, 8);
    if (level.quantity > reorderPoint) continue;

    // Order up to roughly three weeks of cover, varied so deliveries do not
    // all look identical.
    const target = Math.round(reorderPoint * (2.5 + input.random() * 1.5));
    const quantity = Math.max(1, target - level.quantity);
    const balanceAfter = level.quantity + quantity;

    await ctx.db.patch(level._id, {
      quantity: balanceAfter,
      isLowStock: balanceAfter <= level.lowStockThreshold,
      updatedAt: input.at,
    });

    await ctx.db.insert("stockMovements", {
      businessId: input.businessId,
      locationId: input.locationId,
      productId: product._id,
      type: "purchase",
      quantityDelta: quantity,
      balanceAfter,
      unitCostMinor: product.costPriceMinor,
      reason: "Delivery received",
      actorUserId: input.actorUserId,
    });
    count++;
  }

  return count;
}

async function pickCashier(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  fallback: Id<"users">,
): Promise<Id<"users">> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();

  const active = memberships.filter((m) => m.status === "active");
  return active.length > 0 ? active[active.length - 1]!.userId : fallback;
}

/** Midnight UTC, `daysAgo` days back. */
function startOfDayUtc(daysAgo: number): number {
  const now = new Date();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return day - daysAgo * 24 * 60 * 60 * 1000;
}

/**
 * One sale: lines, totals, payment, stock movements and level updates.
 *
 * Mirrors what `completeSale` will do in Phase 4, deliberately. Seeded sales
 * that skipped the ledger would leave the reconciliation job reporting drift
 * on data we generated ourselves.
 */
async function createSeedSale(
  ctx: MutationCtx,
  input: {
    business: Doc<"businesses">;
    locationId: Id<"locations">;
    cashierUserId: Id<"users">;
    products: Doc<"products">[];
    customers: Doc<"customers">[];
    random: () => number;
    dayStart: number;
    sequence: number;
    rateBasisPoints: number;
    taxInclusive: boolean;
  },
): Promise<boolean> {
  const { random, products } = input;

  // Most baskets are small; a few are a week's shopping.
  const roll = random();
  const lineCount = roll < 0.45 ? 1 : roll < 0.75 ? 2 : roll < 0.92 ? 4 : 7;

  const chosen: Doc<"products">[] = [];
  for (let i = 0; i < lineCount; i++) {
    // Square the roll so early (staple) products dominate — a long tail.
    const index = Math.floor(random() ** 2 * products.length);
    const product = products[index];
    if (product && !chosen.includes(product)) chosen.push(product);
  }
  if (chosen.length === 0) return false;

  // Trading hours: a morning rush, a lull, an evening rush after work.
  const hour =
    random() < 0.4
      ? 7 + random() * 4
      : random() < 0.5
        ? 11 + random() * 5
        : 16 + random() * 4;
  const completedAt =
    input.dayStart + Math.floor(hour * 3600_000 + random() * 3600_000);

  const saleId = await ctx.db.insert("sales", {
    businessId: input.business._id,
    locationId: input.locationId,
    number: `${input.business.settings.receiptPrefix}-${String(input.sequence).padStart(6, "0")}`,
    clientRequestId: `seed-${input.business._id}-${input.sequence}`,
    status: "completed",
    cashierUserId: input.cashierUserId,
    currency: input.business.currency,
    subtotalMinor: 0,
    discountTotalMinor: 0,
    taxTotalMinor: 0,
    totalMinor: 0,
    amountPaidMinor: 0,
    changeDueMinor: 0,
    costTotalMinor: 0,
    channel: "pos",
    completedAt,
  });

  let subtotal = 0;
  let taxTotal = 0;
  let costTotal = 0;
  let lines = 0;

  for (const product of chosen) {
    const level = await ctx.db
      .query("inventoryLevels")
      .withIndex("by_business_and_location_and_product", (q) =>
        q
          .eq("businessId", input.business._id)
          .eq("locationId", input.locationId)
          .eq("productId", product._id),
      )
      .unique();

    const available = level?.quantity ?? 0;
    if (available <= 0) continue;

    const wanted = random() < 0.75 ? 1 : 1 + Math.floor(random() * 3);
    const quantity = Math.min(wanted, available);
    if (quantity <= 0) continue;

    const lineTotal = product.sellingPriceMinor * quantity;
    const taxAmount = input.taxInclusive
      ? taxFromInclusive(lineTotal, input.rateBasisPoints)
      : Math.round((lineTotal * input.rateBasisPoints) / 10_000);

    await ctx.db.insert("saleLines", {
      businessId: input.business._id,
      saleId,
      productId: product._id,
      nameSnapshot: product.name,
      skuSnapshot: product.sku,
      quantity,
      unitPriceMinor: product.sellingPriceMinor,
      costPriceMinor: product.costPriceMinor,
      discountMinor: 0,
      taxRateBasisPoints: input.rateBasisPoints,
      taxInclusive: input.taxInclusive,
      taxAmountMinor: taxAmount,
      lineTotalMinor: lineTotal,
    });

    subtotal += lineTotal;
    taxTotal += taxAmount;
    costTotal += product.costPriceMinor * quantity;
    lines++;

    // Ledger and level, exactly as applyMovement writes them.
    const balanceAfter = available - quantity;
    if (level) {
      await ctx.db.patch(level._id, {
        quantity: balanceAfter,
        isLowStock: balanceAfter <= level.lowStockThreshold,
        updatedAt: completedAt,
      });
    }

    await ctx.db.insert("stockMovements", {
      businessId: input.business._id,
      locationId: input.locationId,
      productId: product._id,
      type: "sale",
      quantityDelta: -quantity,
      balanceAfter,
      unitCostMinor: product.costPriceMinor,
      referenceType: "sale",
      referenceId: saleId,
      actorUserId: input.cashierUserId,
    });
  }

  // Every line was out of stock — remove the empty sale rather than leave a
  // zero-value transaction distorting the averages.
  if (lines === 0) {
    await ctx.db.delete(saleId);
    return false;
  }

  const total = input.taxInclusive ? subtotal : subtotal + taxTotal;

  // Roughly 45% M-Pesa, matching how a Nairobi duka actually gets paid.
  const method = random() < 0.45 ? "mpesa" : "cash";
  // Cash customers hand over a round note; M-Pesa is exact.
  const paid = method === "cash" ? Math.ceil(total / 5000) * 5000 : total;

  await ctx.db.patch(saleId, {
    subtotalMinor: subtotal,
    taxTotalMinor: taxTotal,
    totalMinor: total,
    amountPaidMinor: paid,
    changeDueMinor: paid - total,
    costTotalMinor: costTotal,
  });

  await ctx.db.insert("payments", {
    businessId: input.business._id,
    saleId,
    method,
    provider: method === "mpesa" ? "daraja" : undefined,
    amountMinor: total,
    currency: input.business.currency,
    status: "succeeded",
    idempotencyKey: `seed-pay-${saleId}`,
    providerReceipt:
      method === "mpesa"
        ? `S${Math.floor(random() * 1e9)
            .toString(36)
            .toUpperCase()
            .padStart(9, "0")}`
        : undefined,
    settledAt: completedAt,
  });

  // A third of sales are to a known customer; update their history.
  if (input.customers.length > 0 && random() < 0.34) {
    const customer = input.customers[Math.floor(random() * input.customers.length)];
    if (customer) {
      await ctx.db.patch(saleId, { customerId: customer._id });
      await ctx.db.patch(customer._id, {
        purchaseCount: customer.purchaseCount + 1,
        totalSpendMinor: customer.totalSpendMinor + total,
        lastPurchaseAt: completedAt,
        // One point per 100 shillings spent.
        loyaltyPoints: customer.loyaltyPoints + Math.floor(total / 10_000),
      });
    }
  }

  return true;
}
