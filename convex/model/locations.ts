/**
 * Location repository.
 *
 * Every business gets one default location at onboarding. Multi-branch is
 * Phase 7, but sales and stock reference a location from v1 so that adding
 * branches later does not require migrating historical rows.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<Doc<"locations">[]> {
  return ctx.db
    .query("locations")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();
}

export async function getDefault(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
): Promise<Doc<"locations">> {
  const locations = await ctx.db
    .query("locations")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();

  const preferred = locations.find((l) => l.isDefault && l.isActive) ?? locations[0];
  if (!preferred)
    throw appError("INTERNAL", "This business has no location configured.");
  return preferred;
}

export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  locationId: Id<"locations">,
): Promise<Doc<"locations">> {
  const location = await ctx.db.get(locationId);
  if (!location || location.businessId !== tenant.business._id)
    throw appError("NOT_FOUND");
  return location;
}

export async function insert(
  ctx: MutationCtx,
  location: Omit<Doc<"locations">, "_id" | "_creationTime">,
): Promise<Id<"locations">> {
  return ctx.db.insert("locations", location);
}
