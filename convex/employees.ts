/**
 * Employee (membership) management.
 *
 * Requirement 5.7: user roles, permissions and the rule that cashiers cannot
 * reach owner functionality. Every mutation here is gated on
 * `employees:manage`, which only the owner role holds by default.
 */

import { v } from "convex/values";
import { requirePermission, tenantMutation, tenantQuery } from "./lib/tenancy";
import { appError } from "./lib/errors";
import { writeAuditLog } from "./lib/audit";
import { cleanString, normalisePhone, optionalString } from "./lib/validators";
import * as Memberships from "./model/memberships";
import * as Users from "./model/users";

export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, "employees:manage");

    const memberships = await Memberships.listForBusiness(ctx, ctx.tenant);
    const roles = await Memberships.listRolesForBusiness(ctx, ctx.tenant.business._id);
    const rolesById = new Map(roles.map((role) => [role._id, role]));

    const rows = [];
    for (const membership of memberships) {
      const user = await Users.getById(ctx, membership.userId);
      if (!user) continue;
      const role = rolesById.get(membership.roleId);
      rows.push({
        membershipId: membership._id,
        userId: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        employeeCode: membership.employeeCode,
        status: membership.status,
        roleId: membership.roleId,
        roleKey: role?.key ?? "unknown",
        roleName: role?.name ?? "Unknown",
        lastActiveAt: membership.lastActiveAt,
        isOwner: user._id === ctx.tenant.business.ownerUserId,
      });
    }
    return rows;
  },
});

export const listRoles = tenantQuery({
  args: {},
  handler: async (ctx) => {
    requirePermission(ctx.tenant, "employees:manage");
    const roles = await Memberships.listRolesForBusiness(ctx, ctx.tenant.business._id);
    return roles.map((role) => ({
      _id: role._id,
      key: role.key,
      name: role.name,
      isSystem: role.isSystem,
      permissionCount: role.permissions.length,
    }));
  },
});

/**
 * Invite someone to the team.
 *
 * The membership is created in `invited` status against a user record keyed by
 * email or phone. When that person signs in through Clerk, `users.provision`
 * converges on the same user document by `authSubject`, and the invitation
 * becomes usable — no separate acceptance token to expire or leak.
 */
export const invite = tenantMutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    roleId: v.id("roles"),
    employeeCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "employees:manage");

    const name = cleanString(args.name, "Name");
    const email = optionalString(args.email, "Email");
    const phone = normalisePhone(args.phone);

    if (!email && !phone) {
      throw appError("VALIDATION", "An email address or phone number is required.");
    }

    // Roles are per-business rows; one from another tenant must not resolve.
    const role = await Memberships.getOwnedRoleById(ctx, ctx.tenant, args.roleId);

    const existing =
      (email ? await Users.getByEmail(ctx, email) : null) ??
      (phone ? await Users.getByPhone(ctx, phone) : null);

    const userId =
      existing?._id ?? (await Users.insertPlaceholder(ctx, { name, email, phone }));

    await Memberships.insert(ctx, {
      userId,
      businessId: ctx.tenant.business._id,
      roleId: role._id,
      employeeCode: optionalString(args.employeeCode, "Employee code", 24),
      status: "invited",
      invitedByUserId: ctx.tenant.user._id,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "employee.invited",
      entityType: "membership",
      entityId: userId,
      metadata: { roleKey: role.key },
    });

    return { userId };
  },
});

export const changeRole = tenantMutation({
  args: { membershipId: v.id("memberships"), roleId: v.id("roles") },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "employees:manage");

    const membership = await Memberships.getOwnedById(
      ctx,
      ctx.tenant,
      args.membershipId,
    );
    const role = await Memberships.getOwnedRoleById(ctx, ctx.tenant, args.roleId);

    // The owner's own role is fixed: demoting them would leave the business
    // with no one able to manage employees or billing — an unrecoverable state.
    if (membership.userId === ctx.tenant.business.ownerUserId) {
      throw appError("CONFLICT", "The business owner's role cannot be changed.");
    }

    await Memberships.patchOwned(ctx, ctx.tenant, args.membershipId, {
      roleId: role._id,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action: "role.changed",
      entityType: "membership",
      entityId: args.membershipId,
      metadata: { roleKey: role.key },
    });
  },
});

export const setStatus = tenantMutation({
  args: {
    membershipId: v.id("memberships"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  handler: async (ctx, args) => {
    requirePermission(ctx.tenant, "employees:manage");

    const membership = await Memberships.getOwnedById(
      ctx,
      ctx.tenant,
      args.membershipId,
    );

    if (membership.userId === ctx.tenant.business.ownerUserId) {
      throw appError("CONFLICT", "The business owner cannot be suspended.");
    }

    await Memberships.patchOwned(ctx, ctx.tenant, args.membershipId, {
      status: args.status,
    });

    await writeAuditLog(ctx, ctx.tenant, {
      action:
        args.status === "suspended" ? "employee.suspended" : "employee.reactivated",
      entityType: "membership",
      entityId: args.membershipId,
    });
  },
});
