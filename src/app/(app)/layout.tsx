import type { ReactNode } from "react";
import { AppShell } from "@/components/shared/app-shell";

/**
 * The authenticated shell.
 *
 * Route protection happens in middleware; this layout is about tenant context
 * and branding. Note that `/pos` deliberately sits OUTSIDE this group — the
 * till must not carry the dashboard's sidebar, data fetching or bundle.
 * (docs/PROJECT-STRUCTURE.md §3)
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
