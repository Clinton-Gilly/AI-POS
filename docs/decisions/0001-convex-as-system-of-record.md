# ADR-0001 — Convex is the system of record; Drizzle is scoped to analytics

**Status:** Proposed
**Date:** 2026-08-11
**Decision needed before:** Phase 2.2 (schema implementation)

## Context

The brief specifies both Convex as "the primary database and backend data
platform" and Drizzle ORM "where relational/database access is required", and
then instructs: *"Before implementing the database layer, determine which parts
of the stack should be handled directly by Convex and which parts should use
Drizzle. Do not force Drizzle into places where it conflicts with Convex's
architecture."*

They conflict at the foundation. Drizzle is a typed SQL query builder for
Postgres, MySQL and SQLite. Convex is a document database with its own
transactional function runtime and no SQL surface. There is no seam where
Drizzle can sit on top of Convex — not an awkward one, none.

Three options were available.

**A. Convex for everything.** All application data in Convex; Drizzle unused, or
reserved for a later analytics store.

**B. Postgres + Drizzle for everything.** Drop Convex; Neon or Supabase
Postgres, Drizzle for access, and build realtime and reactivity by hand.

**C. Split the data.** Some entities in Convex, some in Postgres via Drizzle.

## Decision

**Option A.** Convex is the system of record for all tenant application data.
Drizzle is retained but scoped to a *future, optional* Postgres analytics
read-model, populated asynchronously from Convex. Nothing in v1 depends on it.

## Rationale

The deciding requirement is that a sale is atomic. Completing one writes a
sale, its lines, one stock movement per line, updated inventory levels, a
payment and an audit entry. All of it lands or none of it does — anything less
and stock drifts from reality, which corrupts every downstream feature from
reorder alerts to AI forecasts.

Convex mutations are ACID transactions with optimistic concurrency control and
automatic retry on conflict. Two cashiers selling the last unit cannot both
succeed; the second transaction re-reads and fails the stock check. Getting the
same guarantee in Postgres from serverless functions means explicit transaction
management across a connection pooler, careful isolation-level selection, and
hand-written retry logic — achievable, but it is exactly the surface where POS
systems leak, and it would be new code rather than platform behaviour.

Convex's reactive queries are the second deciding factor. Multiple terminals,
a manager's phone and an owner's laptop all need current stock and sales
figures. With Convex this is a subscription. With Postgres it is polling, or
LISTEN/NOTIFY plus a WebSocket layer plus cache invalidation — a meaningful
subsystem to build and operate.

Option C was rejected outright. Splitting sales from inventory across two
stores destroys the atomicity that is the core requirement, and would require
distributed-transaction machinery entirely out of proportion to an MVP.

Option B is genuinely defensible and is the fallback if Convex proves
unsuitable. It was not chosen because it trades a solved transactional and
realtime story for infrastructure work that delivers no customer-visible value
in v1.

Reserving Drizzle for analytics is not a consolation prize. Long-range
reporting over millions of sale lines — window functions, cohort analysis,
columnar scans — is genuinely better in SQL than in a document store. That is
the right job for it, and doing it against a read-model keeps heavy analytical
queries off the transactional path.

## Consequences

**Positive**
- Atomic sales are platform behaviour, not application code.
- Realtime is a subscription, not a subsystem.
- No connection pooling, no migration tooling, no ORM/serverless impedance.
- Type safety end to end from Convex codegen.
- Analytics can be added later without disturbing OLTP.

**Negative**
- Managed-platform dependency. Self-hosting or a data-residency requirement
  would force migration.
- Smaller ecosystem than Postgres; fewer off-the-shelf answers.
- Document-store query patterns constrain ad-hoc reporting — which is precisely
  what the read-model exists to relieve.
- Drizzle is absent from v1 despite appearing in the brief. This ADR is the
  record of why.

**Mitigation.** All data access sits behind repository functions in
`convex/model/`. Services never import a database client. If Convex must be
replaced, the change is bounded to one directory rather than spread through
every feature.

## Revisit when

- An enterprise customer requires self-hosting or in-country data residency.
- Reporting queries outgrow the document model in ways the read-model cannot
  absorb.
- Convex pricing at scale changes the economics.
