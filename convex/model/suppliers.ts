/**
 * Supplier repository.
 *
 * Suppliers are contact records in v1. Purchase orders (Phase 7) attach to
 * them; the `purchaseOrders` table already references `supplierId` so that
 * arriving later needs no migration.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  includeInactive = false,
): Promise<Doc<"suppliers">[]> {
  const suppliers = await ctx.db
    .query("suppliers")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();

  const visible = includeInactive ? suppliers : suppliers.filter((s) => s.isActive);
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  supplierId: Id<"suppliers">,
): Promise<Doc<"suppliers">> {
  const supplier = await ctx.db.get(supplierId);
  if (!supplier || supplier.businessId !== tenant.business._id) {
    throw appError("NOT_FOUND");
  }
  return supplier;
}

export async function insert(
  ctx: MutationCtx,
  supplier: Omit<Doc<"suppliers">, "_id" | "_creationTime">,
): Promise<Id<"suppliers">> {
  return ctx.db.insert("suppliers", supplier);
}

export async function patchOwned(
  ctx: MutationCtx,
  tenant: TenantContext,
  supplierId: Id<"suppliers">,
  patch: Partial<Omit<Doc<"suppliers">, "_id" | "_creationTime" | "businessId">>,
): Promise<void> {
  await getOwnedById(ctx, tenant, supplierId);
  await ctx.db.patch(supplierId, patch);
}
