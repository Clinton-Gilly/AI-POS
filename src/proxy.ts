/**
 * Route protection (Next 16's `proxy` convention, formerly `middleware`).
 */

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Routes reachable without a session.
 *
 * Note what is NOT here: everything else. The matcher below runs this
 * middleware on all application routes, so a new page is protected by default
 * rather than by remembering to add it — the failure mode of an allowlist is a
 * forgotten page, and the failure mode of a denylist is an exposed one.
 *
 * The M-Pesa callback (Phase 4) is public by necessity and carries its own
 * verification: provider IP allowlist plus an unguessable path token. It is
 * listed here so Clerk does not reject Safaricom's unauthenticated POST.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  "/api/payments/(.*)",
  "/api/receipts/(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return NextResponse.next();
  await auth.protect();
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless they appear in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
