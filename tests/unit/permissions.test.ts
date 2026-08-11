import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
  isPermission,
  type Permission,
} from "@/lib/auth/permissions";

/**
 * The role matrix from docs/ARCHITECTURE.md §6, asserted directly.
 *
 * These read as trivial, and that is the point: the requirement "cashiers
 * cannot access profit reports" (requirement 5.7) is a business rule, and a
 * business rule with no test is a business rule that a future refactor can
 * quietly delete.
 */
describe("system role permissions", () => {
  it("grants the owner everything", () => {
    expect([...SYSTEM_ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("denies cashiers financial reporting", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.cashier).not.toContain("reports:financial:read");
  });

  it("denies managers financial reporting", () => {
    // Managers run operations and see operational reports; margin and profit
    // are the owner's alone.
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain("reports:financial:read");
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain("reports:operational:read");
  });

  it("denies cashiers every administrative permission", () => {
    const administrative: Permission[] = [
      "employees:manage",
      "roles:manage",
      "settings:write",
      "subscription:manage",
      "audit:read",
    ];
    for (const permission of administrative) {
      expect(SYSTEM_ROLE_PERMISSIONS.cashier).not.toContain(permission);
    }
  });

  it("denies cashiers refunds, voids and stock adjustments", () => {
    for (const permission of [
      "sales:refund",
      "sales:void",
      "inventory:adjust",
      "sales:discount:override",
    ] as Permission[]) {
      expect(SYSTEM_ROLE_PERMISSIONS.cashier).not.toContain(permission);
    }
  });

  it("lets cashiers do the job: sell, look up products, serve customers", () => {
    for (const permission of [
      "sales:create",
      "products:read",
      "customers:read",
      "customers:write",
    ] as Permission[]) {
      expect(SYSTEM_ROLE_PERMISSIONS.cashier).toContain(permission);
    }
  });

  it("gives managers stock control without ownership powers", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain("inventory:adjust");
    expect(SYSTEM_ROLE_PERMISSIONS.manager).toContain("sales:refund");
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain("employees:manage");
    expect(SYSTEM_ROLE_PERMISSIONS.manager).not.toContain("settings:write");
  });

  it("only issues permissions that exist", () => {
    for (const [role, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(isPermission(permission), `${role} holds unknown "${permission}"`).toBe(
          true,
        );
      }
    }
  });

  it("has no duplicate permissions in the vocabulary", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
