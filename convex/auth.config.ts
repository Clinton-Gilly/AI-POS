/**
 * Convex verifies Clerk's JWT on every function call.
 *
 * `applicationID` must match the JWT template named "convex" in the Clerk
 * dashboard. Without this, `ctx.auth.getUserIdentity()` returns null and every
 * tenant function fails closed with UNAUTHENTICATED — which is the correct
 * failure mode for a misconfiguration, but is worth knowing when debugging a
 * fresh environment.
 */

const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
