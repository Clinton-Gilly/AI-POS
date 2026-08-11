/**
 * Identity provisioning and session bootstrap.
 *
 * Clerk answers "who is this person"; this module turns that answer into a
 * user document and reports which businesses they can act in. Authorization
 * lives entirely in `memberships`/`roles`, never on the user. (ADR-0006)
 */

import { authedMutation, authedQuery } from "./lib/tenancy";
import { normalisePhone } from "./lib/validators";
import * as Users from "./model/users";
import * as Businesses from "./model/businesses";

/**
 * Called once after sign-in.
 *
 * Idempotent: repeated calls converge on one user document keyed by Clerk's
 * subject, so a double-mounted provider or a retried request cannot create
 * duplicates.
 */
export const provisionCurrent = authedMutation({
  args: {},
  handler: async (ctx) => {
    const identity = ctx.identity;

    const user = await Users.provision(ctx, {
      authSubject: identity.subject,
      name: identity.name ?? identity.nickname ?? identity.email ?? "User",
      email: identity.email,
      phone: normalisePhone(identity.phoneNumber),
      avatarUrl: identity.pictureUrl,
    });

    const businesses = await Businesses.listForUser(ctx, user._id);

    return {
      userId: user._id,
      hasBusiness: businesses.length > 0,
      defaultBusinessId: user.defaultBusinessId,
    };
  },
});

/**
 * The signed-in person, independent of any business.
 *
 * Returns null rather than throwing when the user document does not exist yet
 * — the client uses this to decide whether to run provisioning, and an error
 * would make a normal first-login look like a failure.
 */
export const me = authedQuery({
  args: {},
  handler: async (ctx) => {
    const user = await Users.getByAuthSubject(ctx, ctx.identity.subject);
    if (!user) return null;

    const businesses = await Businesses.listForUser(ctx, user._id);

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      defaultBusinessId: user.defaultBusinessId,
      businessCount: businesses.length,
    };
  },
});
