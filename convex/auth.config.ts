/**
 * Convex verifies Clerk's JWT on every function call.
 *
 * `applicationID` must match a JWT template named exactly "convex" in the
 * Clerk dashboard, and `CLERK_JWT_ISSUER_DOMAIN` must be set on the Convex
 * deployment:
 *
 *   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<app>.clerk.accounts.dev
 *
 * When that variable is absent we deploy with NO auth providers rather than an
 * invalid one. This is deliberate and it fails closed: with no provider,
 * `ctx.auth.getUserIdentity()` always returns null, `resolveTenantContext`
 * throws UNAUTHENTICATED, and every tenant query and mutation refuses. Nothing
 * becomes reachable that was not reachable before.
 *
 * The alternative — a provider with `domain: undefined` — makes the whole
 * deployment fail to push, which blocks schema and function deploys on a piece
 * of configuration that only matters once someone tries to sign in.
 */

const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!issuerDomain) {
  console.warn(
    "[auth.config] CLERK_JWT_ISSUER_DOMAIN is not set on this deployment. " +
      "Deploying with no auth provider: every authenticated function will " +
      "refuse with UNAUTHENTICATED until it is configured.",
  );
}

const authConfig = {
  providers: issuerDomain ? [{ domain: issuerDomain, applicationID: "convex" }] : [],
};

export default authConfig;
