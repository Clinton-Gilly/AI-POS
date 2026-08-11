/**
 * Membership and role repository.
 *
 * `memberships` is the authorization anchor: one row per (user, business),
 * carrying the role that decides what that person may do in that business.
 * The same person can be a cashier in one shop and the owner of another.
 */

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "../lib/errors";
import type { TenantContext } from "../lib/tenancy";
import {
  SYSTEM_ROLE_LABELS,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "../lib/permissions";

export async function findForUserAndBusiness(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
  userId: Id<"users">,
): Promise<Doc<"memberships"> | null> {
  return ctx.db
    .query("memberships")
    .withIndex("by_business_and_user", (q) =>
      q.eq("businessId", businessId).eq("userId", userId),
    )
    .unique();
}

export async function listForBusiness(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
): Promise<Doc<"memberships">[]> {
  return ctx.db
    .query("memberships")
    .withIndex("by_business", (q) => q.eq("businessId", tenant.business._id))
    .collect();
}

/**
 * Fetch a membership that must belong to the caller's business.
 *
 * NOT_FOUND rather than FORBIDDEN when it belongs to another tenant:
 * confirming that an id exists elsewhere is itself a disclosure.
 */
export async function getOwnedById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  membershipId: Id<"memberships">,
): Promise<Doc<"memberships">> {
  const membership = await ctx.db.get(membershipId);
  if (!membership || membership.businessId !== tenant.business._id) {
    throw appError("NOT_FOUND");
  }
  return membership;
}

export async function insert(
  ctx: MutationCtx,
  membership: Omit<Doc<"memberships">, "_id" | "_creationTime">,
): Promise<Id<"memberships">> {
  const existing = await findForUserAndBusiness(
    ctx,
    membership.businessId,
    membership.userId,
  );
  if (existing) throw appError("DUPLICATE", "That person is already on this team.");
  return ctx.db.insert("memberships", membership);
}

export async function patchOwned(
  ctx: MutationCtx,
  tenant: TenantContext,
  membershipId: Id<"memberships">,
  patch: Partial<Omit<Doc<"memberships">, "_id" | "_creationTime" | "businessId">>,
): Promise<void> {
  await getOwnedById(ctx, tenant, membershipId);
  await ctx.db.patch(membershipId, patch);
}

/* ────────────────────────────── roles ────────────────────────────── */

export async function getRoleById(
  ctx: QueryCtx | MutationCtx,
  roleId: Id<"roles">,
): Promise<Doc<"roles"> | null> {
  return ctx.db.get(roleId);
}

export async function listRolesForBusiness(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
): Promise<Doc<"roles">[]> {
  return ctx.db
    .query("roles")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
}

export async function findRoleByKey(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<"businesses">,
  key: string,
): Promise<Doc<"roles"> | null> {
  return ctx.db
    .query("roles")
    .withIndex("by_business_and_key", (q) =>
      q.eq("businessId", businessId).eq("key", key),
    )
    .unique();
}

/**
 * A role fetched for use in this business. Roles are per-business rows, so a
 * role id from another tenant must not resolve.
 */
export async function getOwnedRoleById(
  ctx: QueryCtx | MutationCtx,
  tenant: TenantContext,
  roleId: Id<"roles">,
): Promise<Doc<"roles">> {
  const role = await ctx.db.get(roleId);
  if (!role || role.businessId !== tenant.business._id) throw appError("NOT_FOUND");
  return role;
}

/**
 * Seed the three system roles for a new business.
 *
 * Roles are rows rather than an enum so a business can add custom roles later
 * (Phase 7) without a schema change or a migration of existing memberships.
 */
export async function seedSystemRoles(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
): Promise<Record<SystemRoleKey, Id<"roles">>> {
  const created = {} as Record<SystemRoleKey, Id<"roles">>;

  for (const key of SYSTEM_ROLE_KEYS) {
    created[key] = await ctx.db.insert("roles", {
      businessId,
      key,
      name: SYSTEM_ROLE_LABELS[key],
      permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
      isSystem: true,
    });
  }

  return created;
}
