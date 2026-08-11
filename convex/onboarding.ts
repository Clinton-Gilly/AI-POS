/**
 * Business registration.
 *
 * The whole of onboarding is one Convex mutation, and therefore one
 * transaction: business, system roles, owner membership, default location and
 * default tax rate either all exist or none do. A half-created business — one
 * with no roles, or an owner with no membership — would be unrecoverable
 * through the UI and would require manual repair in production.
 */

import { v } from "convex/values";
import { authedMutation } from "./lib/tenancy";
import { appError } from "./lib/errors";
import { writeAuditLogForBusiness } from "./lib/audit";
import {
  assertBasisPoints,
  assertHexColor,
  cleanString,
  normalisePhone,
  optionalString,
  slugify,
} from "./lib/validators";
import * as Businesses from "./model/businesses";
import * as Users from "./model/users";
import * as Memberships from "./model/memberships";
import * as Locations from "./model/locations";
import * as TaxRates from "./model/taxRates";
import { CURRENCIES } from "../src/config/currencies";

const DEFAULT_BRANDING = {
  primaryColor: "#1F6FEB",
  secondaryColor: "#0B3B8C",
} as const;

export const registerBusiness = authedMutation({
  args: {
    name: v.string(),
    businessType: v.union(
      v.literal("retail"),
      v.literal("supermarket"),
      v.literal("restaurant"),
      v.literal("pharmacy"),
      v.literal("salon"),
      v.literal("hardware"),
      v.literal("wholesale"),
      v.literal("other"),
    ),
    country: v.string(),
    currency: v.string(),
    timezone: v.string(),
    locale: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    /** VAT in basis points. Kenya's standard rate is 1600. */
    taxRateBasisPoints: v.optional(v.number()),
    taxInclusivePricing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const name = cleanString(args.name, "Business name");

    if (!(args.currency in CURRENCIES)) {
      throw appError("VALIDATION", `${args.currency} is not a supported currency.`);
    }

    const taxRateBasisPoints = args.taxRateBasisPoints ?? 0;
    assertBasisPoints(taxRateBasisPoints, "Tax rate");

    const primaryColor = assertHexColor(
      args.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      "Primary colour",
    );
    const secondaryColor = assertHexColor(
      args.secondaryColor ?? DEFAULT_BRANDING.secondaryColor,
      "Secondary colour",
    );

    // The signed-in person, created on first login if they are new.
    const user = await Users.provision(ctx, {
      authSubject: ctx.identity.subject,
      name: ctx.identity.name ?? ctx.identity.email ?? "Owner",
      email: ctx.identity.email,
      phone: normalisePhone(ctx.identity.phoneNumber),
    });

    const slug = await Businesses.findAvailableSlug(ctx, slugify(name));

    const settings = {
      taxInclusivePricing: args.taxInclusivePricing ?? true,
      // Cashiers may discount up to 5% unaided; anything more needs a manager.
      maxCashierDiscountBasisPoints: 500,
      requireApprovalAboveMinor: 0,
      receiptPrefix: slug.slice(0, 4).toUpperCase(),
      lowStockDefaultThreshold: 5,
      negativeStockAllowed: false,
    };

    const businessId = await Businesses.insert(ctx, {
      name,
      slug,
      ownerUserId: user._id,
      businessType: args.businessType,
      country: args.country.toUpperCase().slice(0, 2),
      currency: args.currency,
      timezone: args.timezone,
      locale: args.locale ?? "en-KE",
      phone: normalisePhone(args.phone),
      email: optionalString(args.email, "Email"),
      addressLine: optionalString(args.addressLine, "Address"),
      city: optionalString(args.city, "City"),
      branding: { primaryColor, secondaryColor },
      settings,
      status: "onboarding",
    });

    const roles = await Memberships.seedSystemRoles(ctx, businessId);

    await Memberships.insert(ctx, {
      userId: user._id,
      businessId,
      roleId: roles.owner,
      status: "active",
    });

    await Locations.insert(ctx, {
      businessId,
      name: "Main",
      type: "store",
      isDefault: true,
      isActive: true,
    });

    // A zero rate is still created, so a business that is not VAT-registered
    // has a rate to point at rather than a null the POS has to special-case.
    const taxRateId = await TaxRates.insert(ctx, {
      businessId,
      name: taxRateBasisPoints > 0 ? `VAT ${taxRateBasisPoints / 100}%` : "No tax",
      rateBasisPoints: taxRateBasisPoints,
      isInclusive: args.taxInclusivePricing ?? true,
      isDefault: true,
      isActive: true,
    });

    // The default tax rate id only exists once the rate is inserted, so the
    // business settings are completed here rather than at insert time.
    await Businesses.patchDuringOnboarding(ctx, businessId, {
      status: "active",
      settings: { ...settings, defaultTaxRateId: taxRateId },
    });

    await Users.setDefaultBusiness(ctx, user._id, businessId);

    await writeAuditLogForBusiness(ctx, businessId, user._id, {
      action: "business.created",
      entityType: "business",
      entityId: businessId,
      metadata: { name, businessType: args.businessType, currency: args.currency },
    });

    return { businessId, slug };
  },
});
