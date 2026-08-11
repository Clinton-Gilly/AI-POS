/**
 * Suppliers.
 *
 * Contact records in v1. Purchase orders (Phase 7) will attach to them; the
 * `purchaseOrders` table already carries `supplierId` so that arrives without
 * a migration.
 */

import { v } from "convex/values";
import { requirePermission, tenantMutation, tenantQuery } from "./lib/tenancy";
import {
  cleanString,
  normalisePhone,
  optionalString,
  MAX_NOTES,
} from "./lib/validators";
import * as Suppliers from "./model/suppliers";

export const list = tenantQuery({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "suppliers:read");
    const suppliers = await Suppliers.listForBusiness(
      ctx,
      ctx.tenant,
      args.includeInactive,
    );
    return suppliers.map((supplier) => ({
      _id: supplier._id,
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      addressLine: supplier.addressLine,
      notes: supplier.notes,
      isActive: supplier.isActive,
    }));
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "suppliers:manage");

    const supplierId = await Suppliers.insert(ctx, {
      businessId: ctx.tenant.business._id,
      name: cleanString(args.name, "Supplier name"),
      contactName: optionalString(args.contactName, "Contact name"),
      phone: normalisePhone(args.phone),
      email: optionalString(args.email, "Email"),
      addressLine: optionalString(args.addressLine, "Address"),
      notes: optionalString(args.notes, "Notes", MAX_NOTES),
      isActive: true,
    });

    return { supplierId };
  },
});

export const update = tenantMutation({
  args: {
    supplierId: v.id("suppliers"),
    name: v.optional(v.string()),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "suppliers:manage");

    await Suppliers.patchOwned(ctx, ctx.tenant, args.supplierId, {
      ...(args.name !== undefined
        ? { name: cleanString(args.name, "Supplier name") }
        : {}),
      ...(args.contactName !== undefined
        ? { contactName: optionalString(args.contactName, "Contact name") }
        : {}),
      ...(args.phone !== undefined ? { phone: normalisePhone(args.phone) } : {}),
      ...(args.email !== undefined
        ? { email: optionalString(args.email, "Email") }
        : {}),
      ...(args.addressLine !== undefined
        ? { addressLine: optionalString(args.addressLine, "Address") }
        : {}),
      ...(args.notes !== undefined
        ? { notes: optionalString(args.notes, "Notes", MAX_NOTES) }
        : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    });
  },
});
