# Security Model

**Status:** Phase 1 deliverable

This system holds money, stock and customer data for businesses that have no
IT department. Security is a build requirement from the first commit, not a
pre-launch audit.

---

## 1. Non-negotiables

These are merge blockers, not guidelines:

1. No hard-coded secrets. Ever.
2. No secret key reaches a client bundle.
3. No authorization decision is made on the client.
4. No `businessId` is accepted from client input.
5. No cross-tenant data access, under any code path.
6. The AI never touches the database directly.
7. No `TODO` on security-relevant functionality.
8. No fake payment success in any environment.
9. No PII or payment payloads in application logs.
10. Every mutating action in the audited set writes an audit entry in its own
    transaction.

---

## 2. Authentication

Clerk provides identity: email login, phone-number login with SMS OTP,
optional two-factor, session management, device revocation. Convex verifies the
Clerk JWT on every function call — there is no unauthenticated path to tenant
data.

**Terminal PINs.** Shops share a till, and staff switch between sales. A short
PIN allows fast switching _within an already-authenticated device session_ — it
is a convenience layer over a real session, never a substitute for one. PINs
are Argon2id-hashed, rate-limited, and lock out after repeated failures.

**2FA** is available from v1 and owner-configurable, but not mandatory:
enforcing it on shared counter hardware creates lockouts that push shops onto
paper.

---

## 3. Authorization

Server-side, permission-based, checked at the data boundary.

```ts
// Every tenant-scoped function begins here.
const ctx = await requireTenantContext(); // server-derived, never client input
requirePermission(ctx, "reports:financial:read"); // throws AppError("FORBIDDEN")
```

**Sensitive fields are stripped at the repository, not hidden in the UI.**
Cost price and margin never enter a payload for a session lacking
`reports:financial:read`. A hidden nav link is not access control — the data
must not be on the wire.

The permission matrix is in [`ARCHITECTURE.md` §6](ARCHITECTURE.md). Every
permission has both a positive and a negative test.

---

## 4. Tenant isolation

The controls, in order of strength:

1. `businessId` derived server-side from the authenticated identity plus active
   membership, on every call.
2. Every index prefixed with `businessId`.
3. All tenant data access through `tenantQuery`/`tenantMutation` — raw `ctx.db`
   outside `convex/model/` is a lint error.
4. A cross-tenant test matrix, run on every PR, asserting that business A fails
   closed against every business B entity.

Control 3 is what makes this structural rather than procedural: a leak requires
a deliberate, visible act rather than an omission.

---

## 5. Secrets

All credentials come from environment variables, validated by Zod at boot in
`config/env.ts`. A missing or malformed secret **prevents startup** — failing
loudly at deploy is strictly better than failing at a customer's first M-Pesa
payment.

| Exposure                 | Variables                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Server only              | `MPESA_*`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY`, `MPESA_CALLBACK_TOKEN` |
| Public (`NEXT_PUBLIC_*`) | Convex URL, Clerk publishable key, app URL                                                                     |

Anything not explicitly in the public row is server-only. Only
`config/env.ts` reads `process.env`; a secret referenced anywhere else is a
review failure. Sandbox and production M-Pesa credentials are separate
deployments, never a runtime flag.

---

## 6. Webhooks

The M-Pesa callback endpoint is public by necessity and therefore hostile by
default:

1. Provider IP allowlist.
2. Unguessable path token (`MPESA_CALLBACK_TOKEN`) in the callback URL.
3. Raw body persisted to `paymentEvents` **before** parsing — a malformed or
   hostile callback is diagnosable, not lost.
4. Unique index on `(provider, externalId)` — duplicates are recorded once and
   processed once, enforced by the database rather than by application logic.
5. Amount, currency and reference validated against the pending payment before
   anything is marked succeeded. A callback never dictates the amount.
6. Always `200` to the provider once persisted; internal failures are retried
   from our own queue rather than by inviting provider retries.

---

## 7. Input validation

Zod at every boundary — route handlers, Server Actions, Convex function args,
webhook payloads. Schemas are shared between client and server so the client
gets fast feedback and the server keeps the authority. Client-side validation
is never trusted.

Additionally: string length caps on every free-text field, numeric range checks
on quantities and amounts, and enum validation on every status field.

---

## 8. Rate limiting

| Surface                     | Reason                                     |
| --------------------------- | ------------------------------------------ |
| Auth attempts, PIN attempts | Credential stuffing, PIN brute force       |
| Payment initiation          | Cost, and STK-push spam to customer phones |
| AI endpoints                | Direct financial cost per request          |
| Webhooks                    | Flooding                                   |
| Search                      | Expensive query abuse                      |

Limits are per tenant _and_ per user — a single compromised cashier account
must not exhaust a business's AI budget.

---

## 9. Logging and error handling

**Logs.** Structured JSON with a correlation ID per request. Redaction happens
centrally in the logger: PII, phone numbers, monetary amounts, tokens and
webhook bodies. Payment payloads live in `paymentEvents` under access control,
not in log aggregation.

**Errors.** A typed `AppError` hierarchy with stable codes. Clients get a code
and a safe message; stack traces, query details and provider responses stay
server-side. Errors fail **closed** — an authorization check that throws denies
access; it never falls through to a permissive default.

---

## 10. Audit trail

Append-only, tenant-scoped, never edited or deleted, written **inside the same
transaction** as the action it records — so an audited action cannot succeed
without its log entry.

Covered: login, sale created, sale refunded, sale voided, product created/
modified/deactivated, stock adjusted, discount approved, employee created/
suspended, role or permission changed, payment recorded, settings changed,
subscription changed.

Each entry carries actor, business, action, entity type and id, timestamp, IP,
user agent and redacted metadata. Reading the audit log requires `audit:read`
(owner only) and is itself audited.

---

## 11. AI-specific security

- No database access; tools only.
- Each tool declares a `requiredPermission`, enforced with the requesting
  user's context.
- Tools accept no `businessId` — tenancy comes from the executor.
- Tool output is delimited and labelled untrusted. Product names, customer
  notes and supplier fields are attacker-controllable by anyone with a cashier
  login, so they are treated as hostile input to the model, never concatenated
  into the system prompt.
- Read-only in v1. Write-actions, when added, follow
  propose → persist → human confirm → authorized service executes. The model
  never receives a destructive verb.
- Conversations and tool results are tenant-scoped and never used as
  cross-tenant training or context.

---

## 12. Data protection

Encryption in transit (TLS) and at rest (platform-provided). Backups are
managed by Convex with documented restore procedures — a backup that has never
been restored is a hypothesis, so restores are exercised before launch.

Customer PII is limited to what the product needs: name, phone, optional email.
No card data is stored — card payments, when added, go through a provider so
the platform stays out of PCI scope.

---

## 13. Dependencies

Lockfile committed, automated vulnerability scanning, prompt patching of
critical advisories. New dependencies are justified in review — every package
in the client bundle is attack surface on a device sitting on a shop counter.
