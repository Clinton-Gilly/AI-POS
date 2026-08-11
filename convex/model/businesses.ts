/**
 * Business repository.
 *
 * Repositories are the only layer permitted to touch `ctx.db` (enforced by
 * ESLint). Every read here is scoped by the caller's business id, taken from
 * the resolved tenant context rather than from function arguments.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export async function getById(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
): Promise<Doc<"businesses"> | null> {
  return ctx.db.get(businessId);
}

export async function getBySlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
): Promise<Doc<"businesses"> | null> {
  return ctx.db
    .query("businesses")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

/**
 * Find a slug that is not taken, appending -2, -3, … as needed.
 *
 * Two shops legitimately called "Amani Mart" must both be able to register;
 * failing the second one is a worse outcome than a slightly uglier URL.
 */
export async function findAvailableSlug(
  ctx: MutationCtx,
  base: string,
): Promise<string> {
  const candidate = base.length > 0 ? base : "business";
  for (let suffix = 1; suffix <= 50; suffix++) {
    const slug = suffix === 1 ? candidate : `${candidate}-${suffix}`;
    const existing = await getBySlug(ctx, slug);
    if (!existing) return slug;
  }
  throw appError("CONFLICT", "Could not allocate a unique address for this business.");
}

export async function insert(
  ctx: MutationCtx,
  business: Omit<Doc<"businesses">, "_id" | "_creationTime">,
): Promise<Id<"businesses">> {
  return ctx.db.insert("businesses", business);
}

/**
 * Patch the caller's own business. The id comes from the tenant context, never
 * from an argument, so there is no shape of call that updates someone else's
 * business.
 */
export async function patchOwn(
  ctx: MutationCtx,
  tenant: TenantContext,
  patch: Partial<Omit<Doc<"businesses">, "_id" | "_creationTime" | "ownerUserId">>,
): Promise<void> {
  await ctx.db.patch(tenant.business._id, patch);
}

/**
 * Patch by id, for the one caller that legitimately has no tenant context:
 * `registerBusiness`, which is creating the business in the same transaction.
 *
 * Not exported to function modules for general use — everything after
 * onboarding goes through `patchOwn`, which derives the id from the caller's
 * resolved membership.
 */
export async function patchDuringOnboarding(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  patch: Partial<Omit<Doc<"businesses">, "_id" | "_creationTime" | "ownerUserId">>,
): Promise<void> {
  await ctx.db.patch(businessId, patch);
}

export async function listForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Array<{ business: Doc<"businesses">; role: Doc<"roles"> }>> {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const results: Array<{ business: Doc<"businesses">; role: Doc<"roles"> }> = [];
  for (const membership of memberships) {
    if (membership.status !== "active") continue;
    const business = await ctx.db.get(membership.businessId);
    const role = await ctx.db.get(membership.roleId);
    if (business && role) results.push({ business, role });
  }
  return results;
}
