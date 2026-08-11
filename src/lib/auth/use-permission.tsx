"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Permission-aware UI.
 *
 * This drives what is *shown*. It is not access control — the server checks
 * the same permission on every call, and sensitive fields are stripped at the
 * repository before they reach the wire. Hiding a button that the server would
 * refuse anyway is a courtesy to the user, not a boundary.
 */
export function useTenant() {
  return useQuery(api.businesses.current);
}

export function usePermission(permission: Permission): boolean {
  const tenant = useTenant();
  return tenant?.permissions.includes(permission) ?? false;
}

/** Renders children only when the permission is held. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
