"use client";

import { type ReactNode, useMemo } from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { env } from "@/config/env";

/**
 * Clerk owns identity; Convex owns tenancy and permissions. (ADR-0006)
 *
 * `ConvexProviderWithClerk` forwards Clerk's JWT to Convex on every call, so
 * `ctx.auth.getUserIdentity()` resolves server-side. No business id is ever
 * sent from here — the server derives it from the identity.
 */
export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, not per render: a new client would drop every
  // open subscription and re-fetch the whole page on each state change.
  const convex = useMemo(() => new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL), []);

  return (
    <ClerkProvider publishableKey={env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
