# ADR-0002 — Row-level multi-tenancy with an enforced access choke point

**Status:** Proposed
**Date:** 2026-08-11

## Context

Requirement 7 states each business should have a "separate database, separate
branding, separate users, separate reports". The guarantee being asked for is
complete data isolation. The question is how to deliver it.

Options: a physical database per tenant; a schema per tenant; or a shared
database with row-level tenancy.

## Decision

**Shared database, row-level tenancy, enforced through a single access choke
point.** Requirement 7 is read as intent — total isolation — rather than as a
literal instruction about physical storage.

## Rationale

A database per tenant looks safest and is operationally punishing at SME scale.
Every schema migration must run across thousands of deployments, with partial
failure as a routine state. Platform-wide analytics require fan-out queries.
Onboarding stops being instant. Per-tenant infrastructure cost collides with
starter-tier pricing for a shop in Nairobi — the pricing model and the storage
model are in direct conflict.

Row-level tenancy carries one real risk: a single query written without a
tenant filter leaks data, and such a query looks entirely ordinary in review.
The response is to make it structurally difficult rather than merely
discouraged:

1. `businessId` is derived server-side from the authenticated identity plus the
   active membership, on every call. It is never accepted from the client, so a
   tampered request has nothing to tamper with.
2. Every index begins with `businessId` — `by_business_and_sku`, never
   `by_sku`. A query that forgets tenancy has no index to use.
3. All tenant access goes through `tenantQuery`/`tenantMutation` wrappers that
   inject the resolved context. Raw `ctx.db` outside `convex/model/` is a lint
   error.
4. A cross-tenant test matrix runs on every PR: for each tenant-scoped
   function, business A attempting to touch business B's entity must fail
   closed.

Control 3 is the one that matters. It converts isolation from something a
developer must remember into something they must deliberately circumvent — and
circumvention shows up in review as a lint suppression.

## Consequences

**Positive**
- One schema, one migration path.
- Instant onboarding; no per-tenant provisioning.
- Cost structure compatible with SME pricing.
- Cross-tenant platform analytics are straightforward.

**Negative**
- A bug in the choke point is a platform-wide incident rather than a
  single-tenant one — hence the disproportionate test coverage there.
- No physical guarantee to offer a customer who contractually requires one.
- "Noisy neighbour" load isolation is the platform's problem, not storage's.

## Revisit when

An enterprise customer requires contractual physical isolation or in-country
data residency. At that point a hybrid — shared for SME tiers, dedicated
deployments for enterprise — is viable precisely because tenancy is already
explicit in every query.
