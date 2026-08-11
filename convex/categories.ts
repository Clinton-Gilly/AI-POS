/**
 * Product categories. One level of nesting in v1.
 */

import { v } from "convex/values";
import { requirePermission, tenantMutation, tenantQuery } from "./lib/tenancy";
import { appError } from "./lib/errors";
import { cleanString } from "./lib/validators";
import * as Categories from "./model/categories";

export const list = tenantQuery({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "products:read");
    const categories = await Categories.listForBusiness(
      ctx,
      ctx.tenant,
      args.includeInactive,
    );
    return categories.map((category) => ({
      _id: category._id,
      name: category.name,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    }));
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "categories:write");

    if (args.parentId) {
      const parent = await Categories.getOwnedById(ctx, ctx.tenant, args.parentId);
      // One level only: a category whose parent already has a parent would make
      // the tree arbitrarily deep, which the UI and reporting do not model.
      if (parent.parentId) {
        throw appError("VALIDATION", "Categories can only be nested one level deep.");
      }
    }

    const categoryId = await Categories.insert(ctx, {
      businessId: ctx.tenant.business._id,
      name: cleanString(args.name, "Category name", { max: 60 }),
      parentId: args.parentId,
      sortOrder: args.sortOrder ?? 0,
      isActive: true,
    });

    return { categoryId };
  },
});

export const update = tenantMutation({
  args: {
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "categories:write");

    // Deactivating a category must not leave products pointing at something
    // the UI no longer lists — they become uncategorised instead.
    if (args.isActive === false) {
      await Categories.clearCategoryFromProducts(ctx, ctx.tenant, args.categoryId);
    }

    await Categories.patchOwned(ctx, ctx.tenant, args.categoryId, {
      ...(args.name !== undefined
        ? { name: cleanString(args.name, "Category name", { max: 60 }) }
        : {}),
      ...(args.sortOrder !== undefined ? { sortOrder: args.sortOrder } : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    });
  },
});
