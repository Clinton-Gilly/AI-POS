/**
 * Business queries and mutations for the signed-in tenant.
 *
 * None of these accept a business id. The business is always the caller's
 * active one, resolved server-side by `tenantQuery`/`tenantMutation`.
 */

import { v } from "convex/values";
import {
  authedQuery,
  authedMutation,
  requirePermission,
  tenantMutation,
  tenantQuery,
} from "./lib/tenancy";
import { appError } from "./lib/errors";
import { writeAuditLog } from "./lib/audit";
import {
  assertHexColor,
  cleanString,
  normalisePhone,
  optionalString,
  assertBasisPoints,
} from "./lib/validators";
import * as Businesses from "./model/businesses";
import * as Users from "./model/users";
import * as Memberships from "./model/memberships";
import * as TaxRates from "./model/taxRates";

/** The active business plus the caller's role and permissions. */
export const current = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const { business, role, membership, user } = ctx.tenant;
    return {
      business: {
        _id: business._id,
        name: business.name,
        slug: business.slug,
        businessType: business.businessType,
        country: business.country,
        currency: business.currency,
        timezone: business.timezone,
        locale: business.locale,
        phone: business.phone,
        email: business.email,
        addressLine: business.addressLine,
        city: business.city,
        branding: business.branding,
        settings: business.settings,
        status: business.status,
      },
      role: { key: role.key, name: role.name },
      permissions: role.permissions,
      membership: { _id: membership._id, employeeCode: membership.employeeCode },
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    };
  },
});

/**
 * Businesses the signed-in person belongs to.
 *
 * Authed rather than tenant-scoped: it runs before an active business is
 * chosen, and is what the business switcher reads.
 */
export const listMine = authedQuery({
  args: {},
  handler: async (ctx) => {
    const user = await Users.getByAuthSubject(ctx, ctx.identity.subject);
    if (!user) return [];

    const entries = await Businesses.listForUser(ctx, user._id);
    return entries.map(({ business, role }) => ({
      _id: business._id,
      name: business.name,
      slug: business.slug,
      branding: business.branding,
      status: business.status,
      roleKey: role.key,
      isDefault: business._id === user.defaultBusinessId,
    }));
  },
});

/**
 * Switch the active business.
 *
 * The membership is verified before the default is changed, so passing another
 * tenant's business id fails rather than switching into it. This is the only
 * place a business id is accepted from a client, and it is treated as a
 * request to be authorized, not as an assertion to be trusted.
 */
export const switchTo = authedMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const user = await Users.getByAuthSubject(ctx, ctx.identity.subject);
    if (!user) throw appError("UNAUTHENTICATED");

    const membership = await Memberships.findForUserAndBusiness(
      ctx,
      args.businessId,
      user._id,
    );
    if (!membership || membership.status !== "active") throw appError("NOT_FOUND");

    await Users.setDefaultBusiness(ctx, user._id, args.businessId);
    return { businessId: args.businessId };
  },
});

export const updateProfile = tenantMutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "settings:write");

    await Businesses.patchOwn(ctx, ctx.tenant, {
      ...(args.name !== undefined
        ? { name: cleanString(args.name, "Business name") }
        : {}),
      ...(args.phone !== undefined ? { phone: normalisePhone(args.phone) } : {}),
      ...(args.email !== undefined
        ? { email: optionalString(args.email, "Email") }
        : {}),
      ...(args.addressLine !== undefined
        ? { addressLine: optionalString(args.addressLine, "Address") }
        : {}),
      ...(args.city !== undefined ? { city: optionalString(args.city, "City") } : {}),
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "business.updated",
      entityType: "business",
      entityId: ctx.tenant.business._id,
    });
  },
});

/**
 * Branding is data, not code: it drives CSS custom properties at the layout
 * boundary, so no component ever branches on which business it is rendering.
 */
export const updateBranding = tenantMutation({
  args: {
    logoStorageId: v.optional(v.id("_storage")),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    receiptHeader: v.optional(v.string()),
    receiptFooter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "settings:write");
    const existing = ctx.tenant.business.branding;

    await Businesses.patchOwn(ctx, ctx.tenant, {
      branding: {
        logoStorageId: args.logoStorageId ?? existing.logoStorageId,
        primaryColor: args.primaryColor
          ? assertHexColor(args.primaryColor, "Primary colour")
          : existing.primaryColor,
        secondaryColor: args.secondaryColor
          ? assertHexColor(args.secondaryColor, "Secondary colour")
          : existing.secondaryColor,
        receiptHeader:
          args.receiptHeader !== undefined
            ? optionalString(args.receiptHeader, "Receipt header")
            : existing.receiptHeader,
        receiptFooter:
          args.receiptFooter !== undefined
            ? optionalString(args.receiptFooter, "Receipt footer")
            : existing.receiptFooter,
      },
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "business.branding_updated",
      entityType: "business",
      entityId: ctx.tenant.business._id,
    });
  },
});

export const updateSettings = tenantMutation({
  args: {
    taxInclusivePricing: v.optional(v.boolean()),
    defaultTaxRateId: v.optional(v.id("taxRates")),
    maxCashierDiscountBasisPoints: v.optional(v.number()),
    requireApprovalAboveMinor: v.optional(v.number()),
    receiptPrefix: v.optional(v.string()),
    lowStockDefaultThreshold: v.optional(v.number()),
    negativeStockAllowed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "settings:write");
    const existing = ctx.tenant.business.settings;

    if (args.maxCashierDiscountBasisPoints !== undefined) {
      assertBasisPoints(args.maxCashierDiscountBasisPoints, "Cashier discount cap");
    }

    // A tax rate from another business must not become this one's default.
    // getOwnedById throws NOT_FOUND when the id belongs to another tenant.
    if (args.defaultTaxRateId !== undefined) {
      await TaxRates.getOwnedById(ctx, ctx.tenant, args.defaultTaxRateId);
    }

    await Businesses.patchOwn(ctx, ctx.tenant, {
      settings: {
        taxInclusivePricing: args.taxInclusivePricing ?? existing.taxInclusivePricing,
        defaultTaxRateId: args.defaultTaxRateId ?? existing.defaultTaxRateId,
        maxCashierDiscountBasisPoints:
          args.maxCashierDiscountBasisPoints ?? existing.maxCashierDiscountBasisPoints,
        requireApprovalAboveMinor:
          args.requireApprovalAboveMinor ?? existing.requireApprovalAboveMinor,
        receiptPrefix: args.receiptPrefix
          ? cleanString(args.receiptPrefix, "Receipt prefix", { max: 8 }).toUpperCase()
          : existing.receiptPrefix,
        lowStockDefaultThreshold:
          args.lowStockDefaultThreshold ?? existing.lowStockDefaultThreshold,
        negativeStockAllowed:
          args.negativeStockAllowed ?? existing.negativeStockAllowed,
      },
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "business.settings_updated",
      entityType: "business",
      entityId: ctx.tenant.business._id,
    });
  },
});
