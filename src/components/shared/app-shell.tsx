"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { UserButton } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import { useTenant } from "@/lib/auth/use-permission";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
}

/**
 * Navigation is filtered by permission so a cashier is not shown doors that
 * will not open. The server enforces the same permissions independently —
 * this list is presentation, not protection.
 */
const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "reports:operational:read",
  },
  { href: "/pos", label: "Sell", icon: ShoppingCart, permission: "sales:create" },
  { href: "/products", label: "Products", icon: Package, permission: "products:read" },
  { href: "/inventory", label: "Inventory", icon: Boxes, permission: "inventory:read" },
  { href: "/sales", label: "Sales", icon: Receipt, permission: "sales:read" },
  { href: "/customers", label: "Customers", icon: Users, permission: "customers:read" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, permission: "suppliers:read" },
  {
    href: "/reports",
    label: "Reports",
    icon: BarChart3,
    permission: "reports:operational:read",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings:write",
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const tenant = useTenant();
  const provision = useMutation(api.users.provisionCurrent);

  /**
   * First sign-in has no user document yet, so `businesses.current` throws
   * UNAUTHENTICATED and `tenant` stays undefined. Provisioning creates the
   * user and reports whether they have a business; if not, onboarding is the
   * only sensible destination.
   */
  useEffect(() => {
    let cancelled = false;
    void provision({}).then((result) => {
      if (!cancelled && !result.hasBusiness) router.replace("/onboarding");
    });
    return () => {
      cancelled = true;
    };
  }, [provision, router]);

  const permissions = tenant?.permissions ?? [];
  const visibleNav = NAV.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return (
    <div
      className="flex min-h-screen"
      // Branding is data: the tenant's colours enter the tree once, here, as
      // CSS custom properties. No component below branches on the business.
      style={
        tenant
          ? ({
              "--brand-primary": tenant.business.branding.primaryColor,
              "--brand-secondary": tenant.business.branding.secondaryColor,
            } as React.CSSProperties)
          : undefined
      }
    >
      <aside className="border-line bg-surface hidden w-56 shrink-0 border-r md:flex md:flex-col">
        <div className="border-line flex h-14 items-center gap-2 border-b px-4">
          <div className="bg-brand size-6 shrink-0 rounded" aria-hidden />
          <span className="text-ink truncate text-sm font-semibold">
            {tenant?.business.name ?? "AI-POS"}
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 p-2" aria-label="Main">
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2 text-sm",
                  active
                    ? "bg-surface-sunken text-ink font-medium"
                    : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {tenant && (
          <div className="border-line text-ink-subtle border-t px-4 py-3 text-xs">
            {tenant.role.name}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface flex h-14 items-center justify-between gap-4 border-b px-4">
          <span className="text-ink truncate text-sm font-medium md:hidden">
            {tenant?.business.name ?? "AI-POS"}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <UserButton />
          </div>
        </header>

        <main className="bg-surface-sunken flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
