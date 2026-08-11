/**
 * Scheduled maintenance.
 *
 * These are `internalMutation`s: reachable from crons and other Convex
 * functions, never from a client. They operate across all businesses, which is
 * exactly why they must not be callable from the outside — they are the one
 * legitimate exception to tenant scoping, and the exception is contained here.
 */

import { internalMutation } from "../_generated/server";

/**
 * Re-derive every inventory level from the ledger and report drift.
 *
 * The invariant: for each (product, location), the sum of `quantityDelta`
 * across `stockMovements` equals `inventoryLevels.quantity`. Because both are
 * written in one transaction by `applyMovement`, drift should always be zero.
 * A non-zero result means some write path bypassed that function, which is a
 * defect worth waking someone for — so it raises a notification rather than
 * silently self-healing.
 *
 * It does correct the level, because a wrong cached quantity keeps causing
 * wrong decisions until someone looks. The ledger is never touched: it is the
 * evidence.
 */
export const reconcileInventory = internalMutation({
  args: {},
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").collect();

    let checked = 0;
    let drifted = 0;

    for (const business of businesses) {
      if (business.status !== "active") continue;

      const levels = await ctx.db
        .query("inventoryLevels")
        .withIndex("by_business_and_product", (q) => q.eq("businessId", business._id))
        .collect();

      for (const level of levels) {
        checked++;

        const movements = await ctx.db
          .query("stockMovements")
          .withIndex("by_business_and_product_and_time", (q) =>
            q.eq("businessId", business._id).eq("productId", level.productId),
          )
          .collect();

        const derived = movements
          .filter((m) => m.locationId === level.locationId)
          .reduce((total, m) => total + m.quantityDelta, 0);

        if (derived === level.quantity) continue;

        drifted++;
        await ctx.db.patch(level._id, {
          quantity: derived,
          isLowStock: derived <= level.lowStockThreshold,
          updatedAt: Date.now(),
        });

        const product = await ctx.db.get(level.productId);
        await ctx.db.insert("notifications", {
          businessId: business._id,
          type: "inventory_drift",
          severity: "critical",
          title: "Stock count corrected",
          body:
            `The recorded stock for ${product?.name ?? "a product"} did not match its ` +
            `movement history (${level.quantity} recorded, ${derived} from history). ` +
            `It has been corrected to ${derived}.`,
          entityType: "product",
          entityId: level.productId,
        });
      }
    }

    return { checked, drifted };
  },
});

/**
 * Raise a notification for products that have fallen to or below threshold.
 *
 * Deduplicated against the last 24 hours: an alert that repeats every run
 * trains people to ignore alerts, which costs more than the missed reorder it
 * was meant to prevent.
 */
export const scanLowStock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const businesses = await ctx.db.query("businesses").collect();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    let raised = 0;

    for (const business of businesses) {
      if (business.status !== "active") continue;

      const low = await ctx.db
        .query("inventoryLevels")
        .withIndex("by_business_and_low_stock", (q) =>
          q.eq("businessId", business._id).eq("isLowStock", true),
        )
        .collect();

      if (low.length === 0) continue;

      const recent = await ctx.db
        .query("notifications")
        .withIndex("by_business", (q) => q.eq("businessId", business._id))
        .order("desc")
        .take(100);

      const alreadyAlerted = new Set(
        recent
          .filter((n) => n.type === "low_stock" && n._creationTime > dayAgo)
          .map((n) => n.entityId),
      );

      for (const level of low) {
        if (alreadyAlerted.has(level.productId)) continue;

        const product = await ctx.db.get(level.productId);
        if (!product || !product.isActive || !product.trackInventory) continue;

        await ctx.db.insert("notifications", {
          businessId: business._id,
          type: "low_stock",
          severity: level.quantity <= 0 ? "critical" : "warning",
          title: level.quantity <= 0 ? "Out of stock" : "Running low",
          body:
            `${product.name} is down to ${level.quantity} ` +
            `(alert at ${level.lowStockThreshold}).`,
          entityType: "product",
          entityId: level.productId,
        });
        raised++;
      }
    }

    return { raised };
  },
});
