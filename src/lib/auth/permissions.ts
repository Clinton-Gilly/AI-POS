/**
 * RBAC permissions.
 *
 * Code asks about a permission, never about a role name. `if (role === "owner")`
 * scattered through the codebase is what makes custom roles impossible later
 * and what makes authorization impossible to audit now.
 *
 * This union is the single source of truth, shared between the Next.js app and
 * Convex functions, so a typo is a compile error rather than a silent grant.
 *
 * See docs/ARCHITECTURE.md §6.
 */

export const PERMISSIONS = [
  // Sales
  "sales:create",
  "sales:read",
  "sales:refund",
  "sales:void",
  "sales:discount",
  "sales:discount:override",

  // Catalogue
  "products:read",
  "products:write",
  "categories:write",

  // Inventory
  "inventory:read",
  "inventory:adjust",
  "suppliers:read",
  "suppliers:manage",

  // Customers
  "customers:read",
  "customers:write",

  // Reporting — the operational/financial split is what keeps margin data away
  // from cashiers and managers. See requirement 5.7.
  "reports:operational:read",
  "reports:financial:read",

  // Administration
  "employees:manage",
  "roles:manage",
  "settings:write",
  "subscription:manage",
  "audit:read",

  // AI
  "ai:query",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_KEYS = ["owner", "manager", "cashier"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * Seed permission sets for the three system roles.
 *
 * A business may define custom roles later; these are the defaults created at
 * onboarding. Note what a cashier does NOT get: no refunds, no stock
 * adjustments, no financial reports, no discount override above the cap.
 */
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, readonly Permission[]> = {
  owner: [...PERMISSIONS],

  manager: [
    "sales:create",
    "sales:read",
    "sales:refund",
    "sales:void",
    "sales:discount",
    "sales:discount:override",
    "products:read",
    "products:write",
    "categories:write",
    "inventory:read",
    "inventory:adjust",
    "suppliers:read",
    "suppliers:manage",
    "customers:read",
    "customers:write",
    "reports:operational:read",
    "ai:query",
  ],

  cashier: [
    "sales:create",
    "sales:read",
    "sales:discount",
    "products:read",
    "inventory:read",
    "customers:read",
    "customers:write",
  ],
};

export const SYSTEM_ROLE_LABELS: Record<SystemRoleKey, string> = {
  owner: "Business Owner",
  manager: "Manager",
  cashier: "Cashier",
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(
  granted: readonly string[],
  required: Permission,
): boolean {
  return granted.includes(required);
}

/**
 * Financial data — cost price, margin, profit — is stripped from payloads at
 * the repository boundary for anyone without this permission. Hiding a nav
 * link is not access control; the data must not reach the wire.
 */
export const FINANCIAL_READ: Permission = "reports:financial:read";
