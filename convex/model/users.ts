/**
 * User repository — platform-level identity.
 *
 * This is the one table that is not tenant-scoped: a person may work at
 * several businesses. Authorization always happens through `memberships`,
 * never through anything on this document.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export async function getByAuthSubject(
  ctx: QueryCtx | MutationCtx,
  authSubject: string,
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", authSubject))
    .unique();
}

export async function getById(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return ctx.db.get(userId);
}

export async function getByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
}

export async function getByPhone(
  ctx: QueryCtx | MutationCtx,
  phone: string,
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .unique();
}

/**
 * Create-or-update on sign-in.
 *
 * Idempotent by `authSubject`: Clerk is the identity authority, so repeated
 * sign-ins converge on one user document rather than creating duplicates.
 * Profile fields are refreshed from the token on every login so a name or
 * phone changed in Clerk propagates without a separate sync job.
 */
export async function provision(
  ctx: MutationCtx,
  input: {
    authSubject: string;
    name: string;
    email?: string;
    phone?: string;
    avatarUrl?: string;
  },
): Promise<Doc<"users">> {
  const existing = await getByAuthSubject(ctx, input.authSubject);

  if (existing) {
    await ctx.db.patch(existing._id, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      avatarUrl: input.avatarUrl,
      lastLoginAt: Date.now(),
    });
    const refreshed = await ctx.db.get(existing._id);
    return refreshed!;
  }

  const userId = await ctx.db.insert("users", {
    authSubject: input.authSubject,
    name: input.name,
    email: input.email,
    phone: input.phone,
    avatarUrl: input.avatarUrl,
    status: "active",
    lastLoginAt: Date.now(),
  });

  const created = await ctx.db.get(userId);
  return created!;
}

/**
 * Create a user record for someone who has been invited but has not signed in.
 *
 * `authSubject` is a placeholder that cannot collide with a real Clerk subject
 * (Clerk's are `user_…`). When the invitee signs in, `provision` matches on
 * their real subject and creates their actual user document; the invitation is
 * then linked by email or phone. The alternative — a nullable `authSubject` —
 * would weaken the unique index that makes provisioning idempotent.
 */
export async function insertPlaceholder(
  ctx: MutationCtx,
  input: { name: string; email?: string; phone?: string },
): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    authSubject: `invited:${input.email ?? input.phone ?? crypto.randomUUID()}`,
    name: input.name,
    email: input.email,
    phone: input.phone,
    status: "active",
  });
}

export async function setDefaultBusiness(
  ctx: MutationCtx,
  userId: Id<"users">,
  businessId: Id<"businesses">,
): Promise<void> {
  await ctx.db.patch(userId, { defaultBusinessId: businessId });
}
