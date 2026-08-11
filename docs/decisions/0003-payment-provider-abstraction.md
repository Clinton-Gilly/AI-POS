# ADR-0003 — Payment provider abstraction with transactional idempotency

**Status:** Proposed — **amended 2026-08-11, see "Correction" below**
**Date:** 2026-08-11

> **Correction (Phase 3).** This ADR originally said idempotency was "enforced
> by unique database index". **Convex has no unique indexes** — `index()` takes
> no uniqueness option and nothing in the storage layer rejects a duplicate
> key. The guarantee still holds, but the mechanism is different: Convex
> mutations run at **serializable isolation under optimistic concurrency
> control**, so a read-then-write check inside a mutation is safe. Two
> concurrent callbacks that both read "no such event" conflict on commit; one
> is retried, re-reads, and finds the committed row.
>
> This matters because the usual warning against read-then-write is correct
> under weaker isolation, where check and insert can interleave. Under
> serializable OCC they cannot. The rest of this ADR is unchanged; substitute
> "a uniqueness check inside the mutation" wherever it says "unique index".
> Implementation and the reasoning in full: `convex/lib/uniqueness.ts`.

## Context

v1 ships cash and M-Pesa. Airtel Money, cards, bank transfer and credit terms
follow. M-Pesa's STK push is asynchronous: initiate, wait for the customer's
PIN, receive a callback. Callbacks arrive late, twice, out of order, or never.

Two things must be decided together, because the second is what makes the first
safe: how providers are abstracted, and how duplicate/late callbacks are
prevented from corrupting sales.

## Decision

A `PaymentProvider` interface with per-provider implementations behind a
`PaymentService`, and **idempotency enforced by a uniqueness check inside the
writing mutation**, which Convex's serializable isolation makes safe.

```ts
export interface PaymentProvider {
  readonly method: PaymentMethod;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  parseCallback(raw: RawCallback): Promise<NormalizedPaymentEvent>;
  queryStatus(providerRef: string): Promise<PaymentStatus>;
}
```

Payment status is a full state machine:
`pending · succeeded · failed · cancelled · timeout · reversed`.

Two indexed lookups carry the correctness burden. They are not unique
constraints — Convex has none — but each is read inside the mutation that
writes, so serializable isolation makes the check-then-act safe:

- `payments.by_business_and_idempotency_key` — a double-tapped or replayed
  initiation cannot create two payments.
- `paymentEvents.by_provider_and_external_id` — a duplicate callback is
  recorded once and processed once.

## Rationale

**On the abstraction.** The POS must never know it is talking to M-Pesa.
African payment rails are fragmented and change; a shop in Kampala needs MTN
MoMo, one in Lagos needs a different set. Adding a provider must mean writing
one file and registering it, with no change to POS, receipt or reporting code.
The interface is deliberately narrow — initiate, parse callback, query status
covers every asynchronous mobile-money rail, and cash implements it trivially
by returning `succeeded` immediately.

**On idempotency.** This is the part that is usually got wrong. In a typical
SQL setup at read-committed or repeatable-read isolation, this is a bug:

```ts
const existing = await findEvent(externalId);
if (existing) return; // ← race window under weak isolation
await processCallback(event);
```

Between the read and the write, a second concurrent callback passes the same
check. Under normal load it never fires; under a provider retry storm — which
is exactly when duplicates arrive — it does, and the result is a double-credited
sale. There, the fix is to push the decision into the database with a unique
constraint.

Convex closes the window differently, and the difference is why the code above
is in fact correct here. Mutations run at **serializable isolation** under
optimistic concurrency control: the read is part of the transaction, so a
concurrent mutation committing a conflicting write causes this one to abort and
retry. The retry re-reads, finds the row, and returns early. There is no
interleaving left to exploit.

The same reasoning covers the client-generated `clientRequestId` on sales — the
offline outbox's idempotency key — and a payment's `idempotencyKey`. A replayed
sync cannot create a second sale, because the check and the insert are one
serializable unit.

The constraint this imposes in practice: the check must happen **inside the
mutation that writes**. Reading in a query and writing in a later mutation is a
different shape, and an unsafe one, because that read is not part of the
writing transaction.

**On the state machine.** Every branch the brief lists — initiation, callback,
success, failure, pending, timeout, duplicate, reconciliation — is a modelled
state rather than an inferred one. A payment stuck in `pending` is visible and
actionable; a payment that only exists as "not succeeded" is not.

**On reconciliation.** A callback that never arrives is not an edge case; it is
Tuesday. Scheduled STK status queries with backoff resolve timeouts, and a
daily reconciliation job compares our records against provider records and
raises variances. Payments are never fire-and-forget.

## Consequences

**Positive**

- New rails are additive, one file each.
- Duplicate and racing callbacks are impossible, not unlikely.
- Every failure mode is an inspectable state.
- Cash and mobile money share one code path, so split tender is free.

**Negative**

- More machinery than a direct M-Pesa integration would need on day one.
- The state machine must be understood before touching payment code.
- Idempotency depends on Convex's serializable isolation rather than a
  database constraint, so it is a property of _where_ the check runs. Moving a
  check out of its writing mutation silently breaks it, which is harder to spot
  in review than dropping a constraint would be.

## Non-negotiable

No code path marks a payment succeeded without verified provider confirmation,
in any environment. Sandbox versus production is configuration; the logic is
identical. A test double that returns success lives in tests only and is never
reachable from application code.
