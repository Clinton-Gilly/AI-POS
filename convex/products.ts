/**
 * Product catalogue.
 *
 * Every read goes through `toProductView`, which strips cost price for callers
 * without `reports:financial:read`. Cashiers can sell; they cannot see margin.
 */

import { v } from "convex/values";
import {
  hasPermission,
  requirePermission,
  tenantMutation,
  tenantQuery,
} from "./lib/tenancy";

import { writeAuditLog } from "./lib/audit";
import { assertNonNegativeMinor, cleanString, optionalString } from "./lib/validators";
import { assertBarcodeAvailable, assertSkuAvailable } from "./lib/uniqueness";
import { FINANCIAL_READ } from "./lib/permissions";
import * as Products from "./model/products";
import * as Categories from "./model/categories";
import * as Inventory from "./model/inventory";
import * as Locations from "./model/locations";
import * as TaxRates from "./model/taxRates";

const unitValidator = v.union(
  v.literal("piece"),
  v.literal("kg"),
  v.literal("litre"),
  v.literal("packet"),
  v.literal("box"),
  v.literal("service"),
);

export const list = tenantQuery({
  args: {
    categoryId: v.optional(v.id("categories")),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:read");
    const canSeeFinancials = hasPermission(ctx.tenant, FINANCIAL_READ);

    const products = await Products.listForBusiness(ctx, ctx.tenant, {
      categoryId: args.categoryId,
      includeInactive: args.includeInactive,
    });

    const levels = await Inventory.listLevels(ctx, ctx.tenant);
    const quantityByProduct = new Map(levels.map((l) => [l.productId, l.quantity]));

    return products
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((product) => ({
        ...Products.toProductView(product, canSeeFinancials),
        quantity: product.trackInventory
          ? (quantityByProduct.get(product._id) ?? 0)
          : null,
      }));
  },
});

export const get = tenantQuery({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:read");
    const product = await Products.getOwnedById(ctx, ctx.tenant, args.productId);
    return Products.toProductView(product, hasPermission(ctx.tenant, FINANCIAL_READ));
  },
});

/**
 * Till search. Exact barcode or SKU wins, then name.
 *
 * Financial stripping applies here too — this is the query a cashier's
 * terminal calls on every keystroke, and it is the easiest place to leak
 * margin data by accident.
 */
export const search = tenantQuery({
  args: { term: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:read");
    const canSeeFinancials = hasPermission(ctx.tenant, FINANCIAL_READ);

    const products = await Products.search(
      ctx,
      ctx.tenant,
      args.term,
      Math.min(args.limit ?? 20, 50),
    );

    const location = await Locations.getDefault(ctx, ctx.tenant.business._id);

    const results = [];
    for (const product of products) {
      const level = product.trackInventory
        ? await Inventory.getLevel(ctx, ctx.tenant, location._id, product._id)
        : null;

      results.push({
        ...Products.toProductView(product, canSeeFinancials),
        quantity: product.trackInventory ? (level?.quantity ?? 0) : null,
      });
    }
    return results;
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    sku: v.string(),
    barcode: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    unit: unitValidator,
    costPriceMinor: v.number(),
    sellingPriceMinor: v.number(),
    taxRateId: v.optional(v.id("taxRates")),
    trackInventory: v.optional(v.boolean()),
    lowStockThreshold: v.optional(v.number()),
    /** Stock on hand at creation, recorded as an `opening` ledger movement. */
    openingQuantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:write");

    const name = cleanString(args.name, "Product name");
    const sku = cleanString(args.sku, "SKU", { max: 40 }).toUpperCase();
    const barcode = optionalString(args.barcode, "Barcode", 40);

    assertNonNegativeMinor(args.costPriceMinor, "Cost price");
    assertNonNegativeMinor(args.sellingPriceMinor, "Selling price");

    // Uniqueness is a read-then-insert inside this transaction. Convex has no
    // unique indexes; its serializable isolation is what makes this safe.
    // See convex/lib/uniqueness.ts.
    await assertSkuAvailable(ctx, ctx.tenant.business._id, sku);
    if (barcode) await assertBarcodeAvailable(ctx, ctx.tenant.business._id, barcode);

    if (args.categoryId)
      await Categories.getOwnedById(ctx, ctx.tenant, args.categoryId);
    if (args.taxRateId) await TaxRates.getOwnedById(ctx, ctx.tenant, args.taxRateId);

    const trackInventory = args.trackInventory ?? args.unit !== "service";

    const productId = await Products.insert(ctx, {
      businessId: ctx.tenant.business._id,
      name,
      sku,
      barcode,
      categoryId: args.categoryId,
      description: optionalString(args.description, "Description"),
      unit: args.unit,
      costPriceMinor: args.costPriceMinor,
      sellingPriceMinor: args.sellingPriceMinor,
      currency: ctx.tenant.business.currency,
      taxRateId: args.taxRateId ?? ctx.tenant.business.settings.defaultTaxRateId,
      trackInventory,
      lowStockThreshold: args.lowStockThreshold,
      isActive: true,
    });

    if (trackInventory && args.openingQuantity && args.openingQuantity > 0) {
      const location = await Locations.getDefault(ctx, ctx.tenant.business._id);
      await Inventory.applyMovement(ctx, ctx.tenant, {
        locationId: location._id,
        productId,
        type: "opening",
        quantityDelta: args.openingQuantity,
        unitCostMinor: args.costPriceMinor,
        reason: "Opening stock",
        referenceType: "product",
        referenceId: productId,
      });
    }

    await writeAuditLog(ctx, ctx.tenant, {
      action: "product.created",
      entityType: "product",
      entityId: productId,
      metadata: { name, sku },
    });

    return { productId };
  },
});

export const update = tenantMutation({
  args: {
    productId: v.id("products"),
    name: v.optional(v.string()),
    sku: v.optional(v.string()),
    barcode: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    unit: v.optional(unitValidator),
    costPriceMinor: v.optional(v.number()),
    sellingPriceMinor: v.optional(v.number()),
    taxRateId: v.optional(v.id("taxRates")),
    lowStockThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:write");
    const existing = await Products.getOwnedById(ctx, ctx.tenant, args.productId);

    const sku = args.sku
      ? cleanString(args.sku, "SKU", { max: 40 }).toUpperCase()
      : undefined;
    const barcode =
      args.barcode !== undefined
        ? optionalString(args.barcode, "Barcode", 40)
        : undefined;

    if (sku && sku !== existing.sku) {
      await assertSkuAvailable(ctx, ctx.tenant.business._id, sku, args.productId);
    }
    if (barcode && barcode !== existing.barcode) {
      await assertBarcodeAvailable(
        ctx,
        ctx.tenant.business._id,
        barcode,
        args.productId,
      );
    }

    if (args.costPriceMinor !== undefined) {
      assertNonNegativeMinor(args.costPriceMinor, "Cost price");
    }
    if (args.sellingPriceMinor !== undefined) {
      assertNonNegativeMinor(args.sellingPriceMinor, "Selling price");
    }
    if (args.categoryId)
      await Categories.getOwnedById(ctx, ctx.tenant, args.categoryId);
    if (args.taxRateId) await TaxRates.getOwnedById(ctx, ctx.tenant, args.taxRateId);

    await Products.patchOwned(ctx, ctx.tenant, args.productId, {
      ...(args.name !== undefined
        ? { name: cleanString(args.name, "Product name") }
        : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(args.barcode !== undefined ? { barcode } : {}),
      ...(args.categoryId !== undefined ? { categoryId: args.categoryId } : {}),
      ...(args.description !== undefined
        ? { description: optionalString(args.description, "Description") }
        : {}),
      ...(args.unit !== undefined ? { unit: args.unit } : {}),
      ...(args.costPriceMinor !== undefined
        ? { costPriceMinor: args.costPriceMinor }
        : {}),
      ...(args.sellingPriceMinor !== undefined
        ? { sellingPriceMinor: args.sellingPriceMinor }
        : {}),
      ...(args.taxRateId !== undefined ? { taxRateId: args.taxRateId } : {}),
      ...(args.lowStockThreshold !== undefined
        ? { lowStockThreshold: args.lowStockThreshold }
        : {}),
    });

    // A changed threshold must take effect now, not at the next movement.
    if (args.lowStockThreshold !== undefined) {
      await Inventory.refreshThresholdForProduct(ctx, ctx.tenant, args.productId);
    }

    await writeAuditLog(ctx, ctx.tenant, {
      action: "product.updated",
      entityType: "product",
      entityId: args.productId,
    });
  },
});

/**
 * Deactivate rather than delete.
 *
 * A product referenced by a sale line from three months ago must stay
 * resolvable, or historical receipts and reports break. Sale lines snapshot
 * name and price for the same reason, but the row itself still has to exist.
 */
export const setActive = tenantMutation({
  args: { productId: v.id("products"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:write");
    await Products.patchOwned(ctx, ctx.tenant, args.productId, {
      isActive: args.isActive,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: args.isActive ? "product.updated" : "product.deactivated",
      entityType: "product",
      entityId: args.productId,
    });
  },
});

/** Upload URL for a product image. Convex file storage holds the bytes. */
export const generateImageUploadUrl = tenantMutation({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, "products:write");
    return ctx.storage.generateUploadUrl();
  },
});

export const attachImage = tenantMutation({
  args: { productId: v.id("products"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:write");
    await Products.patchOwned(ctx, ctx.tenant, args.productId, {
      imageStorageId: args.storageId,
    });
  },
});

/**
 * Resolve a product's image URL.
 *
 * Takes a product id, not a storage id. Storage ids are not tenant-scoped, so
 * accepting one directly would let any authenticated user mint a URL for
 * another business's uploaded file. Going through the product forces the
 * ownership check.
 */
export const imageUrl = tenantQuery({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:read");
    const product = await Products.getOwnedById(ctx, ctx.tenant, args.productId);
    if (!product.imageStorageId) return null;
    return ctx.storage.getUrl(product.imageStorageId);
  },
});
