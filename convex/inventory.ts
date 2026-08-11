/**
 * Inventory: levels, adjustments, history and valuation.
 *
 * Adjustments are permission-gated (`inventory:adjust`, which cashiers do not
 * hold), require a reason, and are audited. An unexplained stock change is
 * indistinguishable from theft after the fact, which is the whole point of
 * keeping a ledger.
 */

import { v } from "convex/values";
import {
  hasPermission,
  requirePermission,
  tenantMutation,
  tenantQuery,
} from "./lib/tenancy";
import { appError } from "./lib/errors";
import { writeAuditLog } from "./lib/audit";
import { cleanString } from "./lib/validators";
import { FINANCIAL_READ } from "./lib/permissions";
import * as Inventory from "./model/inventory";
import * as Products from "./model/products";
import * as Locations from "./model/locations";
import * as Users from "./model/users";

/** Current stock for every tracked product. */
export const levels = tenantQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, "inventory:read");
    const canSeeFinancials = hasPermission(ctx.tenant, FINANCIAL_READ);

    const levels = await Inventory.listLevels(ctx, ctx.tenant);
    const products = await Products.listForBusiness(ctx, ctx.tenant, {
      includeInactive: true,
    });
    const productsById = new Map(products.map((p) => [p._id, p]));

    return levels
      .flatMap((level) => {
        const product = productsById.get(level.productId);
        if (!product || !product.isActive) return [];
        return [
          {
            levelId: level._id,
            productId: product._id,
            name: product.name,
            sku: product.sku,
            unit: product.unit,
            quantity: level.quantity,
            lowStockThreshold: level.lowStockThreshold,
            isLowStock: level.isLowStock,
            updatedAt: level.updatedAt,
            ...(canSeeFinancials
              ? {
                  stockValueMinor: product.costPriceMinor * Math.max(level.quantity, 0),
                }
              : {}),
          },
        ];
      })
      .sort(
        (a, b) =>
          Number(b.isLowStock) - Number(a.isLowStock) || a.name.localeCompare(b.name),
      );
  },
});

export const lowStock = tenantQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, "inventory:read");

    const low = await Inventory.listLowStock(ctx, ctx.tenant);

    const rows = [];
    for (const level of low) {
      const product = await Products.getOwnedById(
        ctx,
        ctx.tenant,
        level.productId,
      ).catch(() => null);
      if (!product || !product.isActive) continue;
      rows.push({
        productId: product._id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        quantity: level.quantity,
        threshold: level.lowStockThreshold,
      });
    }
    return rows.sort((a, b) => a.quantity - b.quantity);
  },
});

/**
 * Manually correct stock — a recount, breakage, or expiry.
 *
 * `quantityDelta` is the change, not the new total. Recording the delta is what
 * makes the ledger explain *why* stock moved; a "set to 40" would lose the
 * fact that 6 were broken.
 */
export const adjust = tenantMutation({
  args: {
    productId: v.id("products"),
    quantityDelta: v.number(),
    reason: v.string(),
    type: v.optional(v.union(v.literal("adjustment"), v.literal("waste"))),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "inventory:adjust");

    const reason = cleanString(args.reason, "Reason", { max: 200 });
    const product = await Products.getOwnedById(ctx, ctx.tenant, args.productId);

    const location = args.locationId
      ? await Locations.getOwnedById(ctx, ctx.tenant, args.locationId)
      : await Locations.getDefault(ctx, ctx.tenant.business._id);

    const { balanceAfter } = await Inventory.applyMovement(ctx, ctx.tenant, {
      locationId: location._id,
      productId: args.productId,
      type: args.type ?? "adjustment",
      quantityDelta: args.quantityDelta,
      reason,
      unitCostMinor: product.costPriceMinor,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "stock.adjusted",
      entityType: "product",
      entityId: args.productId,
      metadata: {
        quantityDelta: args.quantityDelta,
        balanceAfter,
        reason,
        type: args.type ?? "adjustment",
      },
    });

    return { balanceAfter };
  },
});

/** Receive stock against a purchase — the positive counterpart of a sale. */
export const receive = tenantMutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
    unitCostMinor: v.optional(v.number()),
    reference: v.optional(v.string()),
    locationId: v.optional(v.id("locations")),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "inventory:adjust");

    if (args.quantity <= 0) {
      throw appError("VALIDATION", "Received quantity must be greater than zero.");
    }

    const product = await Products.getOwnedById(ctx, ctx.tenant, args.productId);
    const location = args.locationId
      ? await Locations.getOwnedById(ctx, ctx.tenant, args.locationId)
      : await Locations.getDefault(ctx, ctx.tenant.business._id);

    const { balanceAfter } = await Inventory.applyMovement(ctx, ctx.tenant, {
      locationId: location._id,
      productId: args.productId,
      type: "purchase",
      quantityDelta: args.quantity,
      unitCostMinor: args.unitCostMinor ?? product.costPriceMinor,
      reason: args.reference ? `Received: ${args.reference}` : "Stock received",
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "stock.adjusted",
      entityType: "product",
      entityId: args.productId,
      metadata: { quantityDelta: args.quantity, balanceAfter, type: "purchase" },
    });

    return { balanceAfter };
  },
});

/** Movement history for one product. */
export const history = tenantQuery({
  args: { productId: v.id("products"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "inventory:read");
    await Products.getOwnedById(ctx, ctx.tenant, args.productId);

    const movements = await Inventory.listMovementsForProduct(
      ctx,
      ctx.tenant,
      args.productId,
      Math.min(args.limit ?? 50, 200),
    );

    const rows = [];
    for (const movement of movements) {
      const actor = await Users.getById(ctx, movement.actorUserId);
      rows.push({
        _id: movement._id,
        type: movement.type,
        quantityDelta: movement.quantityDelta,
        balanceAfter: movement.balanceAfter,
        reason: movement.reason,
        actorName: actor?.name ?? "Unknown",
        at: movement._creationTime,
      });
    }
    return rows;
  },
});

/** Recent movements across the whole business. */
export const recentMovements = tenantQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "inventory:read");

    const movements = await Inventory.listRecentMovements(
      ctx,
      ctx.tenant,
      Math.min(args.limit ?? 30, 100),
    );

    const rows = [];
    for (const movement of movements) {
      const product = await Products.getOwnedById(
        ctx,
        ctx.tenant,
        movement.productId,
      ).catch(() => null);
      const actor = await Users.getById(ctx, movement.actorUserId);
      rows.push({
        _id: movement._id,
        productName: product?.name ?? "Deleted product",
        sku: product?.sku ?? "",
        type: movement.type,
        quantityDelta: movement.quantityDelta,
        balanceAfter: movement.balanceAfter,
        reason: movement.reason,
        actorName: actor?.name ?? "Unknown",
        at: movement._creationTime,
      });
    }
    return rows;
  },
});

/**
 * Stock valuation. Owner-only: it is cost data, and therefore margin data.
 */
export const valuation = tenantQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, FINANCIAL_READ);
    const result = await Inventory.valuation(ctx, ctx.tenant);
    return { ...result, currency: ctx.tenant.business.currency };
  },
});
