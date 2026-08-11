/**
 * Inventory: an append-only ledger plus a fast projection.
 *
 * `stockMovements` is the truth. `inventoryLevels` is a cached current
 * quantity. Both are written by `applyMovement` in the same Convex mutation,
 * which is a single transaction — so they cannot disagree. The nightly
 * reconciliation in `maintenance.ts` re-derives levels from the ledger and
 * reports any drift; that number should always be zero, and anything else
 * means a write path bypassed this function.
 *
 * Everything that changes stock goes through `applyMovement`. Sales (Phase 4),
 * refunds, purchases, adjustments and wastage are all the same operation with
 * a different `type` and sign, which is what makes the ledger a complete
 * account of why stock is where it is.
 *
 * See docs/DATA-MODEL.md §4 and docs/RISKS.md R4.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export type MovementType = Doc<"stockMovements">["type"];

export interface MovementInput {
  locationId: Id<"locations">;
  productId: Id<"products">;
  type: MovementType;
  /** Signed. Sales and wastage are negative; purchases and refunds positive. */
  quantityDelta: number;
  unitCostMinor?: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
}

/** The threshold that applies to a product: its own, else the business default. */
export function effectiveThreshold(
  product: Doc<"products">,
  business: Doc<"businesses">,
): number {
  return product.lowStockThreshold ?? business.settings.lowStockDefaultThreshold;
}

export async function getLevel(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  locationId: Id<"locations">,
  productId: Id<"products">,
): Promise<Doc<"inventoryLevels"> | null> {
  return ctx.db
    .query("inventoryLevels")
    .withIndex("by_business_and_location_and_product", (q) =>
      q
        .eq("businessId", tenant.business._id)
        .eq("locationId", locationId)
        .eq("productId", productId),
    )
    .unique();
}

export async function listLevels(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<Doc<"inventoryLevels">[]> {
  // Prefix query on the compound index — no separate by_business index needed.
  return ctx.db
    .query("inventoryLevels")
    .withIndex("by_business_and_product", (q) =>
      q.eq("businessId", tenant.business._id),
    )
    .collect();
}

/**
 * Products at or below their threshold.
 *
 * Reads only the flagged rows, via the index. The alternative — scanning every
 * level and reading each product to compare against its own threshold — costs
 * a document read per product on every dashboard load, which is why the
 * threshold is denormalised onto the level.
 */
export async function listLowStock(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<Doc<"inventoryLevels">[]> {
  return ctx.db
    .query("inventoryLevels")
    .withIndex("by_business_and_low_stock", (q) =>
      q.eq("businessId", tenant.business._id).eq("isLowStock", true),
    )
    .collect();
}

export async function listMovementsForProduct(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  productId: Id<"products">,
  limit = 100,
): Promise<Doc<"stockMovements">[]> {
  return ctx.db
    .query("stockMovements")
    .withIndex("by_business_and_product_and_time", (q) =>
      q.eq("businessId", tenant.business._id).eq("productId", productId),
    )
    .order("desc")
    .take(limit);
}

export async function listRecentMovements(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  limit = 50,
): Promise<Doc<"stockMovements">[]> {
  return ctx.db
    .query("stockMovements")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .order("desc")
    .take(limit);
}

/**
 * Apply one stock movement: write the ledger row and update the projection.
 *
 * Atomic because a Convex mutation is a transaction — the movement and the new
 * level either both land or neither does. This is the single most important
 * property in the inventory model: a sale that recorded but did not decrement
 * stock, or vice versa, corrupts every downstream figure from reorder alerts
 * to AI forecasts.
 *
 * Refuses to drive stock negative unless the business has opted in. Some shops
 * legitimately sell ahead of a delivery, so it is configurable rather than
 * absolute — but it is off by default, because silently negative stock is
 * usually a data-entry error rather than an intention.
 */
export async function applyMovement(
  ctx: MutationCtx,
  tenant: TenantContext,
  input: MovementInput,
): Promise<{ movementId: Id<"stockMovements">; balanceAfter: number }> {
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    throw appError("VALIDATION", "Stock change must be a non-zero number.");
  }

  const product = await ctx.db.get(input.productId);
  if (!product || product.businessId !== tenant.business._id)
    throw appError("NOT_FOUND");

  if (!product.trackInventory) {
    throw appError("VALIDATION", `"${product.name}" is not stock tracked.`);
  }

  const location = await ctx.db.get(input.locationId);
  if (!location || location.businessId !== tenant.business._id)
    throw appError("NOT_FOUND");

  const existing = await getLevel(ctx, tenant, input.locationId, input.productId);
  const currentQuantity = existing?.quantity ?? 0;
  const balanceAfter = currentQuantity + input.quantityDelta;

  if (balanceAfter < 0 && !tenant.business.settings.negativeStockAllowed) {
    throw appError(
      "INSUFFICIENT_STOCK",
      `Only ${currentQuantity} of "${product.name}" in stock.`,
    );
  }

  const threshold = effectiveThreshold(product, tenant.business);
  const levelPatch = {
    quantity: balanceAfter,
    lowStockThreshold: threshold,
    isLowStock: balanceAfter <= threshold,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, levelPatch);
  } else {
    await ctx.db.insert("inventoryLevels", {
      businessId: tenant.business._id,
      locationId: input.locationId,
      productId: input.productId,
      reservedQuantity: 0,
      ...levelPatch,
    });
  }

  const movementId = await ctx.db.insert("stockMovements", {
    businessId: tenant.business._id,
    locationId: input.locationId,
    productId: input.productId,
    type: input.type,
    quantityDelta: input.quantityDelta,
    balanceAfter,
    unitCostMinor: input.unitCostMinor,
    reason: input.reason,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    actorUserId: tenant.user._id,
  });

  return { movementId, balanceAfter };
}

/**
 * Recompute a level's low-stock flag after the product's threshold changes.
 *
 * Without this, editing a threshold would not take effect until the next
 * movement — so a product whose threshold was just raised would keep claiming
 * to be well stocked.
 */
export async function refreshThresholdForProduct(
  ctx: MutationCtx,
  tenant: TenantContext,
  productId: Id<"products">,
): Promise<void> {
  const product = await ctx.db.get(productId);
  if (!product || product.businessId !== tenant.business._id) return;

  const threshold = effectiveThreshold(product, tenant.business);

  const levels = await ctx.db
    .query("inventoryLevels")
    .withIndex("by_business_and_product", (q) =>
      q.eq("businessId", tenant.business._id).eq("productId", productId),
    )
    .collect();

  for (const level of levels) {
    await ctx.db.patch(level._id, {
      lowStockThreshold: threshold,
      isLowStock: level.quantity <= threshold,
    });
  }
}

/** Total stock value at cost, for the inventory valuation report. */
export async function valuation(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<{ totalCostMinor: number; totalRetailMinor: number; unitCount: number }> {
  const levels = await listLevels(ctx, tenant);

  let totalCostMinor = 0;
  let totalRetailMinor = 0;
  let unitCount = 0;

  for (const level of levels) {
    if (level.quantity <= 0) continue;
    const product = await ctx.db.get(level.productId);
    if (!product) continue;
    totalCostMinor += product.costPriceMinor * level.quantity;
    totalRetailMinor += product.sellingPriceMinor * level.quantity;
    unitCount += level.quantity;
  }

  return { totalCostMinor, totalRetailMinor, unitCount };
}
