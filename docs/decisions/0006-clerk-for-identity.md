# ADR-0006 — Clerk for identity; Convex for tenancy and permissions

**Status:** Proposed
**Date:** 2026-08-11

## Context

Requirement 9 asks for email login, phone-number login and two-factor
authentication. Phone login with SMS OTP is not optional in this market: a shop
owner in Nairobi may not have an email address they check, but they always have
a phone number.

Separately, the platform needs tenancy — a user belongs to one or more
businesses, with a role in each.

Options for identity: Clerk, Convex Auth, Auth.js, or build it.

## Decision

**Clerk for identity. Convex for tenancy and authorization.**

Clerk answers *who is this person*. Convex answers *what may they do, in which
business*. The boundary is deliberate.

## Rationale

**Why not build it.** Phone OTP, TOTP two-factor, session management, device
revocation, account recovery and rate limiting are weeks of work with a long
tail of security-sensitive edge cases, none of which differentiate a POS
product. Building authentication is how a team spends its first month not
building a POS.

**Why Clerk over Convex Auth.** Convex Auth would reduce the vendor count and
is the natural fit for a Convex application. It was not chosen because phone
OTP and 2FA are first-class in Clerk today and would need assembling
otherwise, and this market's login is a phone number. Clerk also brings device
management and session revocation, which matter when the client is a shared
tablet on a shop counter that can be stolen.

**Why tenancy stays out of Clerk.** Clerk Organizations could model businesses,
and the temptation is real. Rejected for two reasons:

1. It puts authorization state in a vendor we may replace. Migrating identity
   is a contained problem; migrating identity *and* the entire tenancy and
   permission model is not.
2. It models the domain badly. A cashier may work at two shops with different
   permissions in each, and a business needs custom roles beyond a fixed set.
   `memberships` and `roles` as first-class Convex tables express that
   directly, and let RBAC live next to the data it protects — in the same
   transaction, checkable in the same query.

The result is a clean seam: replacing Clerk means re-pointing `authSubject` on
`users` and swapping the JWT verification. Roles, memberships, permissions and
every authorization check are untouched.

## Consequences

**Positive**
- Phone OTP and 2FA on day one, correctly implemented.
- Session and device management provided.
- Authorization stays in our schema, testable and versioned with the code.
- Multi-business membership is modelled properly.

**Negative**
- A third managed dependency alongside Convex and Vercel.
- Per-MAU cost that grows with cashier headcount, not just customer count —
  worth watching against subscription pricing.
- Identity and tenancy in different systems means a user document must be
  provisioned on first login; that path needs to be idempotent and tested.

## Notes

- Terminal PINs are a convenience layer *within* an authenticated session, never
  a substitute for one. Argon2id-hashed, rate-limited, lockout after repeated
  failures.
- 2FA is available from v1 but owner-configurable rather than mandatory:
  enforcing it on shared counter hardware creates lockouts that push shops back
  onto paper.

## Revisit when

Clerk's per-MAU cost becomes material against subscription revenue, or Convex
Auth reaches parity on phone OTP and device management — at which point the
migration is bounded precisely because tenancy was never delegated.
