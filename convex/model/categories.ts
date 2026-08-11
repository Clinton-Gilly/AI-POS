/**
 * Category repository. One level of nesting in v1.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  includeInactive = false,
): Promise<Doc<"categories">[]> {
  const categories = await ctx.db
    .query("categories")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();

  const visible = includeInactive ? categories : categories.filter((c) => c.isActive);
  return visible.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
}

export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  categoryId: Id<"categories">,
): Promise<Doc<"categories">> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.businessId !== tenant.business._id) {
    throw appError("NOT_FOUND");
  }
  return category;
}

export async function insert(
  ctx: MutationCtx,
  category: Omit<Doc<"categories">, "_id" | "_creationTime">,
): Promise<Id<"categories">> {
  return ctx.db.insert("categories", category);
}

export async function patchOwned(
  ctx: MutationCtx,
  tenant: TenantContext,
  categoryId: Id<"categories">,
  patch: Partial<Omit<Doc<"categories">, "_id" | "_creationTime" | "businessId">>,
): Promise<void> {
  await getOwnedById(ctx, tenant, categoryId);
  await ctx.db.patch(categoryId, patch);
}

/**
 * Products still filed under a category.
 *
 * Deactivating a category must not orphan its products silently, so callers
 * check this first and clear the reference rather than leaving rows pointing
 * at something the UI no longer shows.
 */
/**
 * Detach every product from a category, leaving them uncategorised.
 *
 * Called when a category is deactivated: products pointing at a category the
 * UI no longer lists would otherwise be invisible in category-filtered views
 * while still existing.
 */
export async function clearCategoryFromProducts(
  ctx: MutationCtx,
  tenant: TenantContext,
  categoryId: Id<"categories">,
): Promise<number> {
  const products = await productsInCategory(ctx, tenant, categoryId);
  for (const product of products) {
    await ctx.db.patch(product._id, { categoryId: undefined });
  }
  return products.length;
}

export async function productsInCategory(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  categoryId: Id<"categories">,
): Promise<Doc<"products">[]> {
  return ctx.db
    .query("products")
    .withIndex("by_business_and_category", (q) =>
      q.eq("businessId", tenant.business._id).eq("categoryId", categoryId),
    )
    .collect();
}
