# ADR-0003 — Payment provider abstraction with database-enforced idempotency

**Status:** Proposed
**Date:** 2026-08-11

## Context

v1 ships cash and M-Pesa. Airtel Money, cards, bank transfer and credit terms
follow. M-Pesa's STK push is asynchronous: initiate, wait for the customer's
PIN, receive a callback. Callbacks arrive late, twice, out of order, or never.

Two things must be decided together, because the second is what makes the first
safe: how providers are abstracted, and how duplicate/late callbacks are
prevented from corrupting sales.

## Decision

A `PaymentProvider` interface with per-provider implementations behind a
`PaymentService`, and **idempotency enforced by unique database index** rather
than by application logic.

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

Two unique indexes carry the correctness burden:

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

**On idempotency.** This is the part that is usually got wrong. The tempting
implementation is:

```ts
const existing = await findEvent(externalId);
if (existing) return;              // ← race window
await processCallback(event);
```

Between the read and the write, a second concurrent callback passes the same
check. Under normal load this never fires; under a provider retry storm — which
is exactly when duplicates arrive — it does, and the result is a double-credited
sale. A unique index moves the decision into the database, where concurrent
writers are serialised. The second write fails, and failing is the correct
outcome.

The same reasoning applies to the client-generated `clientRequestId` on sales:
it is the offline outbox's idempotency key, and a replayed sync cannot create a
second sale because the index will not allow it.

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
- Unique-index violations must be handled as expected control flow, not as
  unexpected errors.

## Non-negotiable

No code path marks a payment succeeded without verified provider confirmation,
in any environment. Sandbox versus production is configuration; the logic is
identical. A test double that returns success lives in tests only and is never
reachable from application code.
