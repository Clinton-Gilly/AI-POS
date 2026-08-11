/**
 * The tenancy choke point.
 *
 * Every tenant-scoped Convex function is built with `tenantQuery` or
 * `tenantMutation`. Both resolve the caller's identity, membership, business
 * and role on the server and hand the function a `tenant` context. The
 * business id is NEVER read from function arguments — there is nothing for a
 * malicious client to tamper with.
 *
 * Combined with the ESLint rule that confines raw `ctx.db` to `convex/model/`
 * and this file, a cross-tenant read requires a deliberate, reviewable act
 * rather than a forgotten filter. (ADR-0002, docs/SECURITY.md §4)
 */

import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { appError } from "./errors";
import type { Permission } from "./permissions";

export interface TenantContext {
  user: Doc<"users">;
  business: Doc<"businesses">;
  membership: Doc<"memberships">;
  role: Doc<"roles">;
  /** Flattened from the role for cheap checks. */
  permissions: readonly string[];
}

type AnyDb = GenericDatabaseReader<DataModel> | GenericDatabaseWriter<DataModel>;

/**
 * Resolve who is calling and which business they are acting in.
 *
 * The active business is the user's `defaultBusinessId` when they have an
 * active membership in it, otherwise their first active membership. Switching
 * businesses updates `defaultBusinessId` server-side and re-resolves here on
 * the next call, so there is no client-held tenant token.
 */
export async function resolveTenantContext(ctx: {
  auth: QueryCtx["auth"];
  db: AnyDb;
}): Promise<TenantContext> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED");

  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();

  if (!user) throw appError("UNAUTHENTICATED", "Your account has not been set up yet.");
  if (user.status !== "active")
    throw appError("FORBIDDEN", "Your account is suspended.");

  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();

  const active = memberships.filter((m) => m.status === "active");
  if (active.length === 0) throw appError("NO_ACTIVE_BUSINESS");

  const membership =
    active.find((m) => m.businessId === user.defaultBusinessId) ?? active[0]!;

  const business = await ctx.db.get(membership.businessId);
  if (!business) throw appError("NO_ACTIVE_BUSINESS");
  if (business.status === "suspended" || business.status === "cancelled") {
    throw appError("FORBIDDEN", "This business account is not active.");
  }

  const role = await ctx.db.get(membership.roleId);
  if (!role) throw appError("INTERNAL", "Your role could not be resolved.");

  return { user, business, membership, role, permissions: role.permissions };
}

/**
 * Throw unless the caller holds the permission.
 *
 * Fails closed by construction: it either returns or throws, so a forgotten
 * return value cannot accidentally grant access.
 */
export function requirePermission(tenant: TenantContext, permission: Permission): void {
  if (!tenant.permissions.includes(permission)) {
    throw appError("FORBIDDEN");
  }
}

export function hasPermission(tenant: TenantContext, permission: Permission): boolean {
  return tenant.permissions.includes(permission);
}

/**
 * Assert that a document belongs to the caller's business.
 *
 * Used by repositories after a `db.get()` by id — an id supplied by a client
 * is an arbitrary string until this check passes. Deliberately returns
 * NOT_FOUND rather than FORBIDDEN: telling a caller that a document exists but
 * belongs to someone else is itself a cross-tenant disclosure.
 */
export function assertSameBusiness<T extends { businessId: Id<"businesses"> }>(
  tenant: TenantContext,
  doc: T | null,
): T {
  if (!doc || doc.businessId !== tenant.business._id) throw appError("NOT_FOUND");
  return doc;
}

/** A query with the tenant context resolved. `ctx.tenant` is always present. */
export const tenantQuery = customQuery(
  query,
  customCtx(async (ctx: QueryCtx) => ({
    tenant: await resolveTenantContext(ctx),
  })),
);

/** A mutation with the tenant context resolved. */
export const tenantMutation = customMutation(
  mutation,
  customCtx(async (ctx: MutationCtx) => ({
    tenant: await resolveTenantContext(ctx),
  })),
);

/**
 * A query that only needs an authenticated identity, not a business — used by
 * onboarding and the business switcher, which run before a tenant exists.
 */
export const authedQuery = customQuery(
  query,
  customCtx(async (ctx: QueryCtx) => ({ identity: await requireIdentity(ctx) })),
);

export const authedMutation = customMutation(
  mutation,
  customCtx(async (ctx: MutationCtx) => ({ identity: await requireIdentity(ctx) })),
);

async function requireIdentity(ctx: { auth: QueryCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED");
  return identity;
}
