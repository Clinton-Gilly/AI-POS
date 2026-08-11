# ADR-0005 — Offline POS via a local outbox, scoped to single-device cash sales

**Status:** Proposed
**Date:** 2026-08-11

## Context

Requirement 6.1: *"The POS should continue working without internet. When
connection returns: data synchronizes automatically."* One sentence, and the
largest engineering item in the document.

Convex keeps a connected client fast through a reactive cache, but that cache
does not survive a page reload and does not queue writes. Offline operation is
not something the data layer provides; it has to be built.

The hard part is not caching the catalogue. It is stock. If two disconnected
tills each sell the last unit of maize flour, no design makes both correct —
the stock was one, the sales were two. Every option is a choice about where
that inconsistency surfaces.

## Decision

**A local-first outbox with idempotent replay, scoped in v1 to single-device,
cash-only offline sales.**

Components:

1. **Catalogue cache.** Products, categories, prices and tax rates in IndexedDB,
   refreshed on connect.
2. **Outbox.** A completed sale is written locally first with a
   client-generated UUID, then drained to the server in order on reconnect.
3. **Idempotent replay.** That UUID is `sales.clientRequestId`, which carries a
   unique index per business. Replaying an outbox entry after a flaky
   reconnection cannot create a second sale.
4. **Cash only offline.** M-Pesa requires the network by definition.
5. **Stock as projection, not reservation.** Offline stock counts are advisory.
   The server is authoritative at sync; oversells become reconciliation items
   rather than being silently absorbed.
6. **Visible state.** Online/offline status and pending-sale count are always
   on screen.

Multi-device offline conflict resolution is explicitly **out of v1** and
documented as a limitation.

## Rationale

**Why an outbox rather than a general sync engine.** A CRDT or full
bidirectional sync layer would handle multi-device convergence, and would be
weeks of work plus a permanent complexity tax on every future feature. The
actual failure mode in this market is a single shop losing its connection for
minutes to hours. An append-only queue of completed sales covers that
completely, because sales are immutable once completed — there is nothing to
merge.

**Why the idempotency key is client-generated.** The client is the only party
that can distinguish "the same sale, resent" from "a second identical sale".
Two customers can legitimately buy one loaf of bread for the same price one
minute apart; only the client knows those were two cart sessions. Generating
the UUID at cart completion and enforcing uniqueness at the database is the
only correct place for that decision.

**Why cash only.** Offline M-Pesa is not a scoping choice; the STK push
requires the network. Pretending otherwise would mean recording an unverified
payment — precisely the fake-success path the brief forbids.

**Why oversells are surfaced rather than blocked.** Blocking a sale because the
cached count says zero is worse than selling: the shop has physical stock on
the shelf, the customer is holding it, and the system is refusing a real
transaction on stale data. The correct behaviour is to complete the sale and
raise a reconciliation item at sync, which is what the stock ledger is for.

**Why visibility matters.** Hiding degraded state from the operator is how POS
deployments lose trust. A cashier who can see "offline, 12 sales pending" can
make sensible decisions. One who discovers the outage at close of day cannot.

## Consequences

**Positive**
- Trading continues through outages, which is the requirement.
- Idempotency is enforced by index, so replays are safe by construction.
- Small enough to build in Phase 4 rather than becoming its own project.
- The outbox also insulates against platform outages, not just local ones.

**Negative**
- No offline mobile money — a real limitation to state plainly to customers.
- Offline stock can go stale; oversells are possible and must be reconciled.
- Multi-device offline is unsupported in v1.
- IndexedDB adds client complexity and needs its own tests.

## Testing

Non-negotiable before Phase 4 is complete:

- Sale created offline syncs exactly once on reconnect.
- The same outbox entry replayed twice produces one sale. If this needs
  special-casing to pass, the idempotency design is wrong.
- Outbox survives a page reload and a browser restart.
- Ordering is preserved on drain.
- Oversell at sync produces a reconciliation item, not a silent adjustment.
- Playwright covers the whole path with the network disabled.

## Revisit when

Multi-till shops report conflicts in practice, or a customer requires offline
mobile money — which would need a provider-side offline authorisation
mechanism that does not currently exist on these rails.
