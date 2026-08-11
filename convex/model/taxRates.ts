/**
 * Tax rate repository.
 *
 * Rates are basis points (1600 = 16%), never floats — Kenya's 16% VAT must be
 * exactly representable, and a rate that rounds is a rate that produces
 * receipts which do not reconcile.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<Doc<"taxRates">[]> {
  return ctx.db
    .query("taxRates")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();
}

export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  taxRateId: Id<"taxRates">,
): Promise<Doc<"taxRates">> {
  const rate = await ctx.db.get(taxRateId);
  if (!rate || rate.businessId !== tenant.business._id) throw appError("NOT_FOUND");
  return rate;
}

export async function insert(
  ctx: MutationCtx,
  taxRate: Omit<Doc<"taxRates">, "_id" | "_creationTime">,
): Promise<Id<"taxRates">> {
  if (taxRate.isDefault) await clearDefault(ctx, taxRate.businessId);
  return ctx.db.insert("taxRates", taxRate);
}

export async function patchOwned(
  ctx: MutationCtx,
  tenant: TenantContext,
  taxRateId: Id<"taxRates">,
  patch: Partial<Omit<Doc<"taxRates">, "_id" | "_creationTime" | "businessId">>,
): Promise<void> {
  await getOwnedById(ctx, tenant, taxRateId);
  if (patch.isDefault) await clearDefault(ctx, tenant.business._id);
  await ctx.db.patch(taxRateId, patch);
}

/** Exactly one default per business; promoting one demotes the rest. */
async function clearDefault(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
): Promise<void> {
  const existing = await ctx.db
    .query("taxRates")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();

  for (const rate of existing) {
    if (rate.isDefault) await ctx.db.patch(rate._id, { isDefault: false });
  }
}
