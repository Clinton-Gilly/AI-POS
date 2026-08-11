/**
 * @vitest-environment edge-runtime
 *
 * The Phase 2 exit criterion.
 *
 * Two businesses exist. A user in business A must not be able to read or write
 * any entity in business B, and a cashier must be denied every owner-only
 * permission. This is the suite that has to stay green for the tenancy model
 * to be trustworthy; everything built in later phases sits on top of it.
 *
 * See docs/ROADMAP.md Phase 2 and ADR-0002.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import { identity, seedBusiness, setup } from "./helpers";

type Harness = ReturnType<typeof setup>;

let t: Harness;
let amani: Awaited<ReturnType<typeof seedBusiness>>;
let jirani: Awaited<ReturnType<typeof seedBusiness>>;

beforeEach(async () => {
  t = setup();
  amani = await seedBusiness(t, "amani");
  jirani = await seedBusiness(t, "jirani", { currency: "UGX", country: "UG" });
});

const asAmaniOwner = () => t.withIdentity(identity(amani.ownerSubject, "Amani Owner"));
const asJiraniOwner = () =>
  t.withIdentity(identity(jirani.ownerSubject, "Jirani Owner"));
const asAmaniCashier = () =>
  t.withIdentity(identity(amani.cashierSubject, "Amani Cashier"));
const asAmaniManager = () =>
  t.withIdentity(identity(amani.managerSubject, "Amani Manager"));

/** Assert a call fails with one of our typed codes rather than crashing. */
async function expectRejection(
  promise: Promise<unknown>,
  code:
    "FORBIDDEN" | "NOT_FOUND" | "UNAUTHENTICATED" | "NO_ACTIVE_BUSINESS" | "CONFLICT",
) {
  await expect(promise).rejects.toThrow(new RegExp(code));
}

describe("tenant resolution", () => {
  it("resolves each owner into their own business", async () => {
    const a = await asAmaniOwner().query(api.businesses.current, {});
    const j = await asJiraniOwner().query(api.businesses.current, {});

    expect(a.business.name).toBe("Amani Mart");
    expect(j.business.name).toBe("Jirani Mart");
    expect(a.business._id).not.toBe(j.business._id);
  });

  it("keeps each business's own configuration", async () => {
    const a = await asAmaniOwner().query(api.businesses.current, {});
    const j = await asJiraniOwner().query(api.businesses.current, {});

    expect(a.business.currency).toBe("KES");
    expect(j.business.currency).toBe("UGX");
  });

  it("rejects an unauthenticated caller", async () => {
    await expectRejection(t.query(api.businesses.current, {}), "UNAUTHENTICATED");
  });

  it("rejects a signed-in stranger with no membership", async () => {
    const stranger = t.withIdentity(identity("user_stranger", "Stranger"));
    await expectRejection(
      stranger.query(api.businesses.current, {}),
      "UNAUTHENTICATED",
    );
  });
});

describe("cross-tenant reads", () => {
  it("shows an owner only their own employees", async () => {
    const employees = await asAmaniOwner().query(api.employees.list, {});
    const names = employees.map((e) => e.name.toLowerCase());

    // The owner, a manager and a cashier — all of them Amani's, none Jirani's.
    expect(employees).toHaveLength(3);
    expect(names.every((n) => n.includes("amani"))).toBe(true);
    expect(names.some((n) => n.includes("jirani"))).toBe(false);
  });

  it("shows an owner only their own tax rates", async () => {
    const amaniRates = await asAmaniOwner().query(api.taxRates.list, {});
    const jiraniRates = await asJiraniOwner().query(api.taxRates.list, {});

    expect(amaniRates).toHaveLength(1);
    expect(jiraniRates).toHaveLength(1);
    expect(amaniRates[0]!._id).not.toBe(jiraniRates[0]!._id);
  });

  it("shows an owner only their own locations", async () => {
    const amaniLocations = await asAmaniOwner().query(api.locations.list, {});
    const jiraniLocations = await asJiraniOwner().query(api.locations.list, {});

    expect(amaniLocations).toHaveLength(1);
    expect(jiraniLocations).toHaveLength(1);
    expect(amaniLocations[0]!._id).not.toBe(jiraniLocations[0]!._id);
  });

  it("shows an owner only their own roles", async () => {
    const amaniRoles = await asAmaniOwner().query(api.employees.listRoles, {});
    const jiraniRoles = await asJiraniOwner().query(api.employees.listRoles, {});

    const amaniIds = new Set(amaniRoles.map((r) => r._id));
    for (const role of jiraniRoles) {
      expect(amaniIds.has(role._id)).toBe(false);
    }
  });

  it("lists only the businesses a person actually belongs to", async () => {
    const mine = await asAmaniOwner().query(api.businesses.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]!.name).toBe("Amani Mart");
  });
});

describe("cross-tenant writes", () => {
  it("refuses to adopt another business's tax rate as the default", async () => {
    const jiraniRates = await asJiraniOwner().query(api.taxRates.list, {});
    const foreignRateId = jiraniRates[0]!._id;

    await expectRejection(
      asAmaniOwner().mutation(api.businesses.updateSettings, {
        defaultTaxRateId: foreignRateId,
      }),
      "NOT_FOUND",
    );
  });

  it("refuses to edit another business's tax rate", async () => {
    const jiraniRates = await asJiraniOwner().query(api.taxRates.list, {});

    await expectRejection(
      asAmaniOwner().mutation(api.taxRates.update, {
        taxRateId: jiraniRates[0]!._id,
        rateBasisPoints: 0,
      }),
      "NOT_FOUND",
    );
  });

  it("leaves the target untouched after a refused cross-tenant write", async () => {
    const before = await asJiraniOwner().query(api.taxRates.list, {});

    await expectRejection(
      asAmaniOwner().mutation(api.taxRates.update, {
        taxRateId: before[0]!._id,
        rateBasisPoints: 0,
      }),
      "NOT_FOUND",
    );

    const after = await asJiraniOwner().query(api.taxRates.list, {});
    expect(after[0]!.rateBasisPoints).toBe(before[0]!.rateBasisPoints);
  });

  it("refuses to change a role on another business's membership", async () => {
    const jiraniEmployees = await asJiraniOwner().query(api.employees.list, {});
    const amaniRoles = await asAmaniOwner().query(api.employees.listRoles, {});
    const foreignMembership = jiraniEmployees.find((e) => !e.isOwner)!;

    await expectRejection(
      asAmaniOwner().mutation(api.employees.changeRole, {
        membershipId: foreignMembership.membershipId,
        roleId: amaniRoles.find((r) => r.key === "owner")!._id,
      }),
      "NOT_FOUND",
    );
  });

  it("refuses to suspend an employee of another business", async () => {
    const jiraniEmployees = await asJiraniOwner().query(api.employees.list, {});
    const foreign = jiraniEmployees.find((e) => !e.isOwner)!;

    await expectRejection(
      asAmaniOwner().mutation(api.employees.setStatus, {
        membershipId: foreign.membershipId,
        status: "suspended",
      }),
      "NOT_FOUND",
    );
  });

  it("refuses to assign a role belonging to another business", async () => {
    const amaniEmployees = await asAmaniOwner().query(api.employees.list, {});
    const jiraniRoles = await asJiraniOwner().query(api.employees.listRoles, {});
    const ownEmployee = amaniEmployees.find((e) => !e.isOwner)!;

    await expectRejection(
      asAmaniOwner().mutation(api.employees.changeRole, {
        membershipId: ownEmployee.membershipId,
        roleId: jiraniRoles.find((r) => r.key === "owner")!._id,
      }),
      "NOT_FOUND",
    );
  });

  it("refuses to switch into a business the caller does not belong to", async () => {
    await expectRejection(
      asAmaniOwner().mutation(api.businesses.switchTo, {
        businessId: jirani.businessId as never,
      }),
      "NOT_FOUND",
    );
  });

  it("keeps an owner's branding edits inside their own business", async () => {
    await asAmaniOwner().mutation(api.businesses.updateBranding, {
      primaryColor: "#AA0000",
    });

    const amaniAfter = await asAmaniOwner().query(api.businesses.current, {});
    const jiraniAfter = await asJiraniOwner().query(api.businesses.current, {});

    expect(amaniAfter.business.branding.primaryColor).toBe("#AA0000");
    expect(jiraniAfter.business.branding.primaryColor).not.toBe("#AA0000");
  });
});

describe("role-based access control", () => {
  it("denies a cashier the employee list", async () => {
    await expectRejection(asAmaniCashier().query(api.employees.list, {}), "FORBIDDEN");
  });

  it("denies a cashier business settings", async () => {
    await expectRejection(
      asAmaniCashier().mutation(api.businesses.updateSettings, {
        negativeStockAllowed: true,
      }),
      "FORBIDDEN",
    );
  });

  it("denies a cashier branding changes", async () => {
    await expectRejection(
      asAmaniCashier().mutation(api.businesses.updateBranding, {
        primaryColor: "#000000",
      }),
      "FORBIDDEN",
    );
  });

  it("denies a cashier tax configuration", async () => {
    await expectRejection(
      asAmaniCashier().mutation(api.taxRates.create, {
        name: "Sneaky",
        rateBasisPoints: 0,
        isInclusive: true,
      }),
      "FORBIDDEN",
    );
  });

  it("denies a manager owner-only administration", async () => {
    // Managers run operations; employees, settings and billing stay with the owner.
    await expectRejection(asAmaniManager().query(api.employees.list, {}), "FORBIDDEN");
    await expectRejection(
      asAmaniManager().mutation(api.businesses.updateSettings, {
        negativeStockAllowed: true,
      }),
      "FORBIDDEN",
    );
  });

  it("allows a cashier the reads they need to sell", async () => {
    const tenant = await asAmaniCashier().query(api.businesses.current, {});
    expect(tenant.role.key).toBe("cashier");
    expect(tenant.permissions).toContain("sales:create");
    expect(tenant.permissions).toContain("products:read");

    // And the till needs tax rates to price a basket.
    const rates = await asAmaniCashier().query(api.taxRates.list, {});
    expect(rates).toHaveLength(1);
  });

  it("never gives a cashier financial reporting", async () => {
    const tenant = await asAmaniCashier().query(api.businesses.current, {});
    expect(tenant.permissions).not.toContain("reports:financial:read");
    expect(tenant.permissions).not.toContain("employees:manage");
    expect(tenant.permissions).not.toContain("settings:write");
  });

  it("lets the owner do what the cashier could not", async () => {
    await asAmaniOwner().mutation(api.businesses.updateSettings, {
      negativeStockAllowed: true,
    });
    const tenant = await asAmaniOwner().query(api.businesses.current, {});
    expect(tenant.business.settings.negativeStockAllowed).toBe(true);
  });
});

describe("suspension", () => {
  it("locks out a suspended employee entirely", async () => {
    const employees = await asAmaniOwner().query(api.employees.list, {});
    const cashier = employees.find((e) => e.roleKey === "cashier")!;

    await asAmaniOwner().mutation(api.employees.setStatus, {
      membershipId: cashier.membershipId,
      status: "suspended",
    });

    // No active membership remains, so there is no business to act in.
    await expectRejection(
      asAmaniCashier().query(api.businesses.current, {}),
      "NO_ACTIVE_BUSINESS",
    );
  });

  it("refuses to suspend the owner, which would strand the business", async () => {
    const employees = await asAmaniOwner().query(api.employees.list, {});
    const owner = employees.find((e) => e.isOwner)!;

    await expectRejection(
      asAmaniOwner().mutation(api.employees.setStatus, {
        membershipId: owner.membershipId,
        status: "suspended",
      }),
      "CONFLICT",
    );
  });

  it("refuses to demote the owner", async () => {
    const employees = await asAmaniOwner().query(api.employees.list, {});
    const roles = await asAmaniOwner().query(api.employees.listRoles, {});
    const owner = employees.find((e) => e.isOwner)!;

    await expectRejection(
      asAmaniOwner().mutation(api.employees.changeRole, {
        membershipId: owner.membershipId,
        roleId: roles.find((r) => r.key === "cashier")!._id,
      }),
      "CONFLICT",
    );
  });
});

describe("onboarding transaction", () => {
  it("creates business, roles, owner membership, location and tax rate together", async () => {
    const tenant = await asAmaniOwner().query(api.businesses.current, {});
    const roles = await asAmaniOwner().query(api.employees.listRoles, {});
    const locations = await asAmaniOwner().query(api.locations.list, {});
    const rates = await asAmaniOwner().query(api.taxRates.list, {});

    expect(tenant.business.status).toBe("active");
    expect(roles.map((r) => r.key).sort()).toEqual(["cashier", "manager", "owner"]);
    expect(locations).toHaveLength(1);
    expect(locations[0]!.isDefault).toBe(true);
    expect(rates[0]!.isDefault).toBe(true);
    expect(tenant.business.settings.defaultTaxRateId).toBe(rates[0]!._id);
  });

  it("gives two businesses of the same name distinct slugs", async () => {
    const duplicate = await seedBusiness(t, "amani2");
    const first = await asAmaniOwner().query(api.businesses.current, {});
    const second = await t
      .withIdentity(identity(duplicate.ownerSubject, "Other Owner"))
      .query(api.businesses.current, {});

    expect(first.business.slug).not.toBe(second.business.slug);
  });

  it("rejects an unsupported currency", async () => {
    const stranger = t.withIdentity(identity("user_new", "New Owner"));
    await expect(
      stranger.mutation(api.onboarding.registerBusiness, {
        name: "Test Shop",
        businessType: "retail",
        country: "KE",
        currency: "XXX",
        timezone: "Africa/Nairobi",
      }),
    ).rejects.toThrow(/VALIDATION/);
  });

  it("rejects a blank business name", async () => {
    const stranger = t.withIdentity(identity("user_new2", "New Owner"));
    await expect(
      stranger.mutation(api.onboarding.registerBusiness, {
        name: "   ",
        businessType: "retail",
        country: "KE",
        currency: "KES",
        timezone: "Africa/Nairobi",
      }),
    ).rejects.toThrow(/VALIDATION/);
  });
});

describe("audit trail", () => {
  it("records business creation against the new business", async () => {
    const entries = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_business", (q) => q.eq("businessId", amani.businessId as never))
        .collect(),
    );

    expect(entries.some((e) => e.action === "business.created")).toBe(true);
    // Audit entries are tenant-scoped like everything else.
    expect(entries.every((e) => e.businessId === amani.businessId)).toBe(true);
  });

  it("records settings changes with the acting user", async () => {
    await asAmaniOwner().mutation(api.businesses.updateSettings, {
      negativeStockAllowed: true,
    });

    const entries = await t.run(async (ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_business_and_action", (q) =>
          q
            .eq("businessId", amani.businessId as never)
            .eq("action", "business.settings_updated"),
        )
        .collect(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorUserId).toBeDefined();
  });
});
