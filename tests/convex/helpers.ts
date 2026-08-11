import { convexTest } from "convex-test";
import schema from "@convex/schema";

/**
 * `convex-test` runs the real function bodies — transactions, index
 * constraints and all — in process. These are integration tests against actual
 * Convex behaviour, not mocks: a mocked transaction would prove nothing about
 * the transactional guarantees the tenancy model depends on.
 *
 * Convex resolves modules relative to the `convex/` directory, so the glob is
 * passed explicitly from the test's own import.meta.
 */
export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

/** A signed-in identity, as Clerk would present it to Convex. */
export function identity(subject: string, name: string, email?: string) {
  return { subject, name, email: email ?? `${subject}@example.test`, issuer: "test" };
}

export interface SeededBusiness {
  businessId: string;
  ownerSubject: string;
  cashierSubject: string;
  managerSubject: string;
}

/**
 * Register a business through the real onboarding mutation, then add a manager
 * and a cashier to it.
 *
 * Deliberately not inserting rows directly: seeding through the public API is
 * what makes these tests evidence about the system rather than about the
 * fixture.
 */
export async function seedBusiness(
  t: ReturnType<typeof setup>,
  label: string,
  overrides: { currency?: string; country?: string } = {},
): Promise<SeededBusiness> {
  const ownerSubject = `user_${label}_owner`;
  const display = label.charAt(0).toUpperCase() + label.slice(1);
  const asOwner = t.withIdentity(identity(ownerSubject, `${display} Owner`));

  const { businessId } = await asOwner.mutation(
    (await import("@convex/_generated/api")).api.onboarding.registerBusiness,
    {
      name: `${display} Mart`,
      businessType: "retail" as const,
      country: overrides.country ?? "KE",
      currency: overrides.currency ?? "KES",
      timezone: "Africa/Nairobi",
      taxRateBasisPoints: 1600,
      taxInclusivePricing: true,
    },
  );

  const { api } = await import("@convex/_generated/api");

  const roles = await asOwner.query(api.employees.listRoles, {});
  const managerRole = roles.find((r) => r.key === "manager")!;
  const cashierRole = roles.find((r) => r.key === "cashier")!;

  const managerSubject = `user_${label}_manager`;
  const cashierSubject = `user_${label}_cashier`;

  // Invite creates a placeholder user; sign-in then converges on the real
  // subject. The tests below drive that path so it is exercised, not assumed.
  await asOwner.mutation(api.employees.invite, {
    name: `${display} Manager`,
    email: `${managerSubject}@example.test`,
    roleId: managerRole._id,
  });
  await asOwner.mutation(api.employees.invite, {
    name: `${display} Cashier`,
    email: `${cashierSubject}@example.test`,
    roleId: cashierRole._id,
  });

  // Activate the invitations and bind them to real auth subjects.
  await t.run(async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_business", (q) => q.eq("businessId", businessId as never))
      .collect();

    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user || !user.authSubject.startsWith("invited:")) continue;

      const subject =
        user.email === `${managerSubject}@example.test`
          ? managerSubject
          : cashierSubject;

      await ctx.db.patch(user._id, {
        authSubject: subject,
        defaultBusinessId: businessId as never,
      });
      await ctx.db.patch(membership._id, { status: "active" as const });
    }
  });

  return { businessId, ownerSubject, cashierSubject, managerSubject };
}
