/**
 * Locations.
 *
 * Read-only in v1: onboarding creates the single default location, and
 * multi-branch management arrives in Phase 7. The table and the `locationId`
 * references exist now so that adding branches later does not require
 * migrating historical sales and stock rows.
 */

import { tenantQuery } from "./lib/tenancy";
import * as Locations from "./model/locations";

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const locations = await Locations.listForBusiness(ctx, ctx.tenant);
    return locations
      .filter((location) => location.isActive)
      .map((location) => ({
        _id: location._id,
        name: location.name,
        type: location.type,
        addressLine: location.addressLine,
        isDefault: location.isDefault,
      }));
  },
});
