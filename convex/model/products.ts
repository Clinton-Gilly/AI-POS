/**
 * Product repository.
 *
 * The important thing here is `toProductView`. Cost price is financial data:
 * it is the difference between a cashier knowing what a tin of milk sells for
 * and knowing what the shop paid for it, and therefore its margin. It is
 * stripped **at this boundary**, so it never reaches the wire for a session
 * without `reports:financial:read`. Hiding a column in the UI is not access
 * control.
 *
 * No function here returns a raw `Doc<"products">` to a caller that will
 * serialise it. Views are constructed field by field, deliberately, so adding
 * a sensitive column later cannot leak by being picked up in a spread.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";

export interface ProductView {
  _id: Id<"products">;
  name: string;
  sku: string;
  barcode?: string;
  categoryId?: Id<"categories">;
  description?: string;
  imageStorageId?: Id<"_storage">;
  unit: Doc<"products">["unit"];
  sellingPriceMinor: number;
  currency: string;
  taxRateId?: Id<"taxRates">;
  trackInventory: boolean;
  lowStockThreshold?: number;
  isActive: boolean;
  /** Present only when the caller holds reports:financial:read. */
  costPriceMinor?: number;
}

/**
 * Build the client-facing shape of a product.
 *
 * `canSeeFinancials` is not a default parameter on purpose: every call site
 * must state what the caller is entitled to, so omitting the decision is a
 * type error rather than a silent disclosure.
 */
export function toProductView(
  product: Doc<"products">,
  canSeeFinancials: boolean,
): ProductView {
  const view: ProductView = {
    _id: product._id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    categoryId: product.categoryId,
    description: product.description,
    imageStorageId: product.imageStorageId,
    unit: product.unit,
    sellingPriceMinor: product.sellingPriceMinor,
    currency: product.currency,
    taxRateId: product.taxRateId,
    trackInventory: product.trackInventory,
    lowStockThreshold: product.lowStockThreshold,
    isActive: product.isActive,
  };

  if (canSeeFinancials) view.costPriceMinor = product.costPriceMinor;
  return view;
}

export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  productId: Id<"products">,
): Promise<Doc<"products">> {
  const product = await ctx.db.get(productId);
  if (!product || product.businessId !== tenant.business._id)
    throw appError("NOT_FOUND");
  return product;
}

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  options: { includeInactive?: boolean; categoryId?: Id<"categories"> } = {},
): Promise<Doc<"products">[]> {
  const products = options.categoryId
    ? await ctx.db
        .query("products")
        .withIndex("by_business_and_category", (q) =>
          q.eq("businessId", tenant.business._id).eq("categoryId", options.categoryId),
        )
        .collect()
    : await ctx.db
        .query("products")
        .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
        .collect();

  return options.includeInactive ? products : products.filter((p) => p.isActive);
}

export async function findByBarcode(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  barcode: string,
): Promise<Doc<"products"> | null> {
  return ctx.db
    .query("products")
    .withIndex("by_business_and_barcode", (q) =>
      q.eq("businessId", tenant.business._id).eq("barcode", barcode),
    )
    .first();
}

export async function findBySku(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  sku: string,
): Promise<Doc<"products"> | null> {
  return ctx.db
    .query("products")
    .withIndex("by_business_and_sku", (q) =>
      q.eq("businessId", tenant.business._id).eq("sku", sku),
    )
    .first();
}

/**
 * Till search: an exact barcode or SKU hit wins, then a full-text name match.
 *
 * The ordering is the point. A cashier scanning a barcode must get exactly one
 * product instantly; a cashier typing "mil" is browsing. Running the text
 * search first would bury a scanned item behind fuzzy matches.
 */
export async function search(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  term: string,
  limit = 20,
): Promise<Doc<"products">[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const exact =
    (await findByBarcode(ctx, tenant, trimmed)) ??
    (await findBySku(ctx, tenant, trimmed));
  if (exact && exact.isActive) return [exact];

  const byName = await ctx.db
    .query("products")
    .withSearchIndex("search_name", (q) =>
      q
        .search("name", trimmed)
        .eq("businessId", tenant.business._id)
        .eq("isActive", true),
    )
    .take(limit);

  return byName;
}

export async function insert(
  ctx: MutationCtx,
  product: Omit<Doc<"products">, "_id" | "_creationTime">,
): Promise<Id<"products">> {
  return ctx.db.insert("products", product);
}

export async function patchOwned(
  ctx: MutationCtx,
  tenant: TenantContext,
  productId: Id<"products">,
  patch: Partial<Omit<Doc<"products">, "_id" | "_creationTime" | "businessId">>,
): Promise<Doc<"products">> {
  await getOwnedById(ctx, tenant, productId);
  await ctx.db.patch(productId, patch);
  const updated = await ctx.db.get(productId);
  return updated!;
}

export async function countForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<number> {
  const products = await ctx.db
    .query("products")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();
  return products.length;
}
