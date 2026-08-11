/**
 * Tax rate configuration.
 *
 * Rates are basis points and are snapshotted onto sale lines when a sale
 * completes (Phase 4), so changing a rate here never alters historical
 * receipts.
 */

import { v } from "convex/values";
import { requirePermission, tenantMutation, tenantQuery } from "./lib/tenancy";
import { writeAuditLog } from "./lib/audit";
import { assertBasisPoints, cleanString } from "./lib/validators";
import * as TaxRates from "./model/taxRates";

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rates = await TaxRates.listForBusiness(ctx, ctx.tenant);
    return rates
      .filter((rate) => rate.isActive)
      .map((rate) => ({
        _id: rate._id,
        name: rate.name,
        rateBasisPoints: rate.rateBasisPoints,
        isInclusive: rate.isInclusive,
        isDefault: rate.isDefault,
      }));
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    rateBasisPoints: v.number(),
    isInclusive: v.boolean(),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "settings:write");
    assertBasisPoints(args.rateBasisPoints, "Tax rate");

    const taxRateId = await TaxRates.insert(ctx, {
      businessId: ctx.tenant.business._id,
      name: cleanString(args.name, "Tax name", { max: 40 }),
      rateBasisPoints: args.rateBasisPoints,
      isInclusive: args.isInclusive,
      isDefault: args.isDefault ?? false,
      isActive: true,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "tax_rate.created",
      entityType: "taxRate",
      entityId: taxRateId,
      metadata: { rateBasisPoints: args.rateBasisPoints },
    });

    return { taxRateId };
  },
});

export const update = tenantMutation({
  args: {
    taxRateId: v.id("taxRates"),
    name: v.optional(v.string()),
    rateBasisPoints: v.optional(v.number()),
    isInclusive: v.optional(v.boolean()),
    isDefault: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "settings:write");
    if (args.rateBasisPoints !== undefined) {
      assertBasisPoints(args.rateBasisPoints, "Tax rate");
    }

    await TaxRates.patchOwned(ctx, ctx.tenant, args.taxRateId, {
      ...(args.name !== undefined
        ? { name: cleanString(args.name, "Tax name", { max: 40 }) }
        : {}),
      ...(args.rateBasisPoints !== undefined
        ? { rateBasisPoints: args.rateBasisPoints }
        : {}),
      ...(args.isInclusive !== undefined ? { isInclusive: args.isInclusive } : {}),
      ...(args.isDefault !== undefined ? { isDefault: args.isDefault } : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "tax_rate.updated",
      entityType: "taxRate",
      entityId: args.taxRateId,
    });
  },
});
