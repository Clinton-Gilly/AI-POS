/**
 * Audit logging.
 *
 * Written inside the same transaction as the action it records, so an audited
 * action cannot succeed without its log entry — the two either both land or
 * both roll back. Append-only: nothing here updates or deletes.
 *
 * See docs/SECURITY.md §10.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { TenantContext } from "./tenancy";

/**
 * The audited action set from docs/SECURITY.md §10. A string union rather than
 * free text so that audit queries can rely on stable values and a typo cannot
 * create a category of untraceable events.
 */
export type AuditAction =
  | "auth.login"
  | "business.created"
  | "business.updated"
  | "business.branding_updated"
  | "business.settings_updated"
  | "sale.created"
  | "sale.refunded"
  | "sale.voided"
  | "product.created"
  | "product.updated"
  | "product.deactivated"
  | "stock.adjusted"
  | "discount.approved"
  | "employee.invited"
  | "employee.suspended"
  | "employee.reactivated"
  | "role.changed"
  | "role.permissions_changed"
  | "payment.recorded"
  | "tax_rate.created"
  | "tax_rate.updated"
  | "subscription.changed";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  /** Redacted of PII by callers; never contains full payment payloads. */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(
  ctx: MutationCtx,
  tenant: TenantContext,
  entry: AuditEntry,
): Promise<Id<"auditLogs">> {
  return ctx.db.insert("auditLogs", {
    businessId: tenant.business._id,
    actorUserId: tenant.user._id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
  });
}

/**
 * For actions that happen before a tenant context exists — business
 * registration being the only one today, where the business is created in the
 * same transaction that logs its creation.
 */
export async function writeAuditLogForBusiness(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  actorUserId: Id<"users"> | undefined,
  entry: AuditEntry,
): Promise<Id<"auditLogs">> {
  return ctx.db.insert("auditLogs", {
    businessId,
    actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
  });
}
