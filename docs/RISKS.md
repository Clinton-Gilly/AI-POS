# Technical Risks

**Status:** Phase 1 deliverable

Rated by expected impact × likelihood, highest first. Each risk names the
mitigation that is built into the architecture and the early signal that tells
us the mitigation is failing.

---

## R1 — Offline capability · **Critical**

Requirement 6.1 is one sentence and is the largest engineering item in the
document. It is where POS projects most often overrun.

**The problem.** Convex's reactive cache keeps a connected client fast but does
not survive a reload and does not queue writes. Genuine offline needs a durable
local catalogue, a durable write queue, idempotent replay, and an answer for
stock counts that were computed against stale data. Full multi-device offline
convergence — two tills selling the same last unit while both are disconnected
— is a distributed-systems problem with no clean answer, only trade-offs.

**Mitigation.** Scope it honestly. v1 ships: IndexedDB catalogue cache,
client-generated UUID per sale as the idempotency key, an outbox drained in
order on reconnect, cash-only offline sales, offline stock as a visible
projection rather than a reservation, and oversells surfaced as reconciliation
items instead of being silently absorbed. Multi-device offline conflict
resolution is explicitly Phase 7 and is stated as a limitation rather than
implied to work.

**Early signal.** If the Phase 4.15 exit test — replaying one outbox entry
twice produces exactly one sale — needs special-casing to pass, the idempotency
design is wrong and must be fixed before more surface is built on it.

---

## R2 — Payment correctness · **Critical**

Money that moves without a matching record, or records without money, destroys
trust in a way features cannot recover.

**The problem.** M-Pesa callbacks arrive late, twice, out of order, or not at
all. The customer's phone dies mid-PIN. The network drops between debit and
callback. Naive handlers double-credit sales or mark unpaid sales as paid.

**Mitigation.** Every failure branch is a modelled state
(`pending · succeeded · failed · cancelled · timeout · reversed`). Duplicate
suppression is a **unique index** on `(provider, externalId)`, so a duplicate
that races an in-flight callback loses at the database level rather than in an
`if`. Raw payloads are persisted before parsing. Timeouts trigger scheduled STK
status queries with backoff and a manual-review flag. A daily reconciliation
job compares our payments against provider records and raises variances. There
is no code path that marks a payment succeeded without verified provider
confirmation, in any environment.

**Early signal.** Any manual-review queue that grows rather than drains means
the reconciliation logic is not closing loops.

---

## R3 — Tenant isolation · **Critical**

A single cross-tenant leak in a multi-tenant POS is an existential incident:
one shop seeing another's sales, prices or customers.

**The problem.** Isolation enforced by convention fails eventually. It only
takes one query written without a `businessId` filter, and such a query looks
completely normal in review.

**Mitigation.** Structural, not procedural. `businessId` is derived server-side
on every call and never accepted from the client. Every index starts with
`businessId`. All access goes through `tenantQuery`/`tenantMutation`, and raw
`ctx.db` outside `convex/model/` is a lint error. The test suite includes a
cross-tenant matrix asserting that business A fails closed against every one of
business B's entities, and it runs on every PR.

**Early signal.** Any PR that adds a lint suppression for the `ctx.db` rule.
That suppression is the leak, months early.

---

## R4 — Inventory consistency · **High**

Stock that drifts from reality makes every downstream feature — reorder alerts,
AI forecasts, valuation — quietly wrong.

**The problem.** Concurrent sales of the last unit; a sale that writes but
whose stock decrement does not; adjustments racing sales; refunds double-
restocking.

**Mitigation.** Levels and ledger are written in the same Convex transaction,
so they cannot diverge. Convex's OCC retries on conflict, making concurrent
oversell impossible rather than unlikely. Inventory documents are per
product-per-location, never a single aggregate document — an aggregate would
serialise every sale in the shop and produce retry storms at peak. A nightly
job re-derives levels from the ledger and notifies on any drift. Corrections
are compensating movements; nothing is ever edited.

**Early signal.** The nightly reconciliation reporting non-zero drift. That
number should be zero, always; anything else means a write path bypassed the
transaction.

---

## R5 — AI data access and grounding · **High**

An assistant that invents figures is worse than no assistant: an owner who
reorders against a hallucinated forecast loses real money.

**The problem.** Three distinct failure modes — the model fabricating numbers,
the model reaching data the user is not entitled to, and prompt injection via
attacker-controlled fields.

**Mitigation.** The model never touches the database. Tools are the only path,
each with a Zod-validated input schema and a declared `requiredPermission`,
executed with the requesting user's context. Tools do not accept a
`businessId`, so a hallucinated tenant argument goes nowhere. Every answer
persists its tool calls and results, making any stated figure traceable.
Ungrounded answers are treated as defects, with an explicit refusal path.
Product names, customer notes and supplier fields are attacker-controllable by
anyone with a cashier login, so tool output is delimited and labelled untrusted
and never concatenated into the system prompt. Write-actions are out of v1
entirely.

**Early signal.** Any assistant answer containing a number that cannot be
traced to a stored tool result.

---

## R6 — Convex / Drizzle stack mismatch · **High (now), resolved by decision**

**The problem.** The brief specifies both. They do not compose: Drizzle is a
SQL builder, Convex is not SQL. Attempting to satisfy both literally would
produce either a pointless abstraction layer or a split-brain data model where
sales live in one store and inventory in another — the worst possible outcome
for a system whose core requirement is that sales and inventory move together
atomically.

**Mitigation.** Decided, not deferred: Convex owns all OLTP; Drizzle is scoped
to an optional, later Postgres analytics read-model. All data access sits behind
repository functions, so the read-model can be added without touching services.
Reasoning and the rejected alternative are recorded in
[ADR-0001](decisions/0001-convex-as-system-of-record.md).

**Residual risk.** Convex is a managed platform with a smaller ecosystem than
Postgres, and a self-hosting or data-residency requirement from an enterprise
customer would force a migration. The repository layer is what keeps that
migration bounded to one directory.

---

## R7 — Security of a system holding money · **High**

**The problem.** Credential exposure in client bundles, forged webhooks,
privilege escalation, PII leakage into logs, brute-forced terminal PINs.

**Mitigation.** Secrets are server-only and validated at boot, so a
misconfigured deployment fails to start rather than failing at the first sale.
Webhooks are verified by IP allowlist plus an unguessable path token, with raw
bodies stored access-controlled rather than logged. Authorization is enforced
server-side; the UI hiding a control is never the control. The logger redacts
PII and payment payloads centrally, not at each call site. Terminal PINs are
Argon2id-hashed and rate-limited. Full model in
[`SECURITY.md`](SECURITY.md).

**Early signal.** Any secret read outside `config/env.ts`, or any `console.log`
of a request body.

---

## R8 — Money arithmetic and multi-currency · **Medium-High**

**The problem.** Float arithmetic on money produces receipts that do not add
up. Inclusive-vs-exclusive VAT, per-line vs per-order discounts, and rounding
order all change totals by amounts customers notice and disputes are made of.

**Mitigation.** All amounts are integers in minor units with the currency
stored alongside, rounded once at display using the currency's exponent. Tax
rates are basis points, not floats. `calculateTotals` is a single pure
function, written test-first, and is the only place totals are computed —
receipts, reports and margins all derive from it. Tax and price are snapshotted
onto sale lines, so a VAT change cannot retroactively alter last year's
receipts.

**Early signal.** Any monetary value appearing as a non-integer anywhere in the
codebase.

---

## R9 — POS performance on real hardware · **Medium-High**

**The problem.** The target device is a low-end Android tablet on 3G, not a
developer's laptop. A cashier facing a queue abandons a system that takes two
seconds per scan. Performance regressions arrive gradually and are never
noticed on fast machines.

**Mitigation.** `/pos` is its own route group with minimal chrome and a small
bundle. Product search is index-backed and benchmarked at 5,000 products.
Catalogue data is cached locally, so scanning does not hit the network. Every
action has a keyboard binding. Touch targets are ≥44px. Playwright runs the
cashier journey under CPU and network throttling with an explicit budget.

**Early signal.** The throttled journey exceeding its budget in CI.

---

## R10 — Latency and availability from East Africa · **Medium**

**The problem.** Vercel and Convex regions are chosen for the platform's
convenience, not Nairobi's. Every added round trip is felt at the till, and the
99.9% uptime target (requirement 16) includes dependencies we do not operate.

**Mitigation.** Convex deployment region selected for East African latency;
static assets on CDN; server components to collapse round trips; the offline
outbox as the ultimate degradation path — a platform outage becomes degraded
trading rather than stopped trading. Health checks and error monitoring from
Phase 2.

**Early signal.** p95 till latency measured from a Nairobi-region client, not
from CI.

---

## R11 — Scope pressure · **Medium**

**The problem.** The requirements document spans restaurant tables, pharmacy
batches, salon appointments, computer vision, voice assistants and a module
marketplace. Building breadth before one shop trades successfully produces a
demo, not a product — and the brief's own rule 7 forbids it.

**Mitigation.** [`MVP-SCOPE.md`](MVP-SCOPE.md) states the line explicitly, and
every deferred item names the seam that keeps it cheap later. The MVP test is a
single sentence about one shop's trading day; anything not required by it is
deferred by default.

**Early signal.** Any industry-specific conditional appearing in core sales,
inventory or payment code.

---

## R12 — Audit log growth · **Low-Medium**

The fastest-growing table, written on every sale, with a legitimate reason
never to delete rows.

**Mitigation.** Append-only design that tolerates cold storage; queries always
tenant- and time-bounded; archival policy scheduled for Phase 7 before volume
becomes a cost problem rather than after.

---

## Risks accepted

| Accepted                                            | Rationale                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared database rather than per-tenant databases    | Isolation guaranteed by enforcement + tests; per-tenant databases make migrations and SME pricing unworkable. Revisit for a contractual data-residency requirement |
| Managed platform dependency (Convex, Clerk, Vercel) | Correct trade for time-to-market at this stage. Repository and provider abstractions bound the cost of replacing any one of them                                   |
| Single-device offline only in v1                    | Covers the real failure mode — intermittent internet at one till. Multi-device offline convergence is disproportionate work for the MVP                            |
| English-only UI at launch                           | i18n wired from day one; adding Swahili is translation work, not refactoring                                                                                       |
