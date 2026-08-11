# Architecture Decision Records

Decisions that were not obvious, that closed off alternatives, or that someone
will reasonably want to reopen later. Each records the context, the decision,
the reasoning, the consequences accepted, and the conditions under which it
should be revisited.

Superseding an ADR means writing a new one, not editing the old one. The record
of what we believed and why is the point.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-convex-as-system-of-record.md) | Convex is the system of record; Drizzle is scoped to analytics | Proposed |
| [0002](0002-row-level-multi-tenancy.md) | Row-level multi-tenancy with an enforced access choke point | Proposed |
| [0003](0003-payment-provider-abstraction.md) | Payment provider abstraction with database-enforced idempotency | Proposed |
| [0004](0004-ai-tool-boundary.md) | The AI reaches business data only through authorized tools | Proposed |
| [0005](0005-offline-first-pos.md) | Offline POS via a local outbox, scoped to single-device cash sales | Proposed |
| [0006](0006-clerk-for-identity.md) | Clerk for identity; Convex for tenancy and permissions | Proposed |

All six are **Proposed** pending review of the Phase 1 architecture. They move
to **Accepted** when Phase 2 begins.

ADR-0001 and ADR-0005 are the two that resolve genuine tensions in the brief —
the Convex/Drizzle overlap, and the gap between "the POS works offline" and
what the data layer actually provides. They are the ones to read first.
