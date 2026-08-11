# Architecture Overview

**Status:** Proposed (Phase 1 deliverable — awaiting approval)
**Scope:** AI-Powered Customizable POS SaaS Platform for African SMEs

---

## 1. System shape

The platform is a single Next.js application backed by Convex, deployed on
Vercel. It is deliberately a modular monolith rather than a set of
microservices: at this stage the dominant risks are correctness (money,
inventory, tenancy) and time-to-market, not horizontal scale. Every module is
bounded by an explicit service interface so that any of them can later be
extracted into its own Node.js service without touching callers.

```
                     ┌────────────────────────────────────────┐
   Cashier tablet ──▶│  Next.js App (Vercel)                  │
   Owner laptop   ──▶│  ┌──────────────────────────────────┐  │
   Manager phone  ──▶│  │ React Server Components (reads)  │  │
                     │  │ Client Components (POS terminal) │  │
                     │  └──────────────────────────────────┘  │
                     │  ┌──────────────────────────────────┐  │
                     │  │ Route Handlers  (webhooks, AI    │  │
                     │  │                  streaming)      │  │
                     │  │ Server Actions  (form mutations) │  │
                     │  └──────────────────────────────────┘  │
                     └───────────────┬────────────────────────┘
                                     │ authenticated Convex client
                                     ▼
                     ┌────────────────────────────────────────┐
                     │  Convex (system of record)             │
                     │  queries · mutations · actions · cron  │
                     │  ACID transactions · realtime · files  │
                     └───────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
      ┌───────────────┐     ┌────────────────┐     ┌────────────────┐
      │ Clerk         │     │ M-Pesa Daraja  │     │ AI providers   │
      │ (identity,    │     │ (STK push,     │     │ OpenAI/Gemini/ │
      │  2FA, phone)  │     │  callbacks)    │     │ Anthropic      │
      └───────────────┘     └────────────────┘     └────────────────┘
```

### Why this shape

A POS has an unusual constraint profile for a web app:

- **Money and stock must never drift.** A sale writes a sale, sale lines,
  payments, stock movements and inventory levels. Either all of it lands or
  none of it does.
- **Multiple terminals watch the same data.** Two cashiers, a manager on a
  phone and an owner on a laptop all need to see the same stock counts within
  seconds.
- **The network is not reliable.** Requirement 6.1 is explicit: the POS keeps
  selling when the internet drops.

Convex answers the first two directly — mutations are ACID transactions and
queries are reactive subscriptions, so no cache-invalidation layer is needed.
The third is the client's job and is handled by a local-first outbox
([ADR-0005](decisions/0005-offline-first-pos.md)).

---

## 2. Frontend

**Next.js App Router, TypeScript (strict), Tailwind CSS, shadcn/ui.**

Two rendering postures, chosen per surface rather than globally:

| Surface                                              | Posture                                                  | Why                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Dashboard, reports, settings, product/customer lists | React Server Components; data fetched server-side        | Reads dominate, payloads are large, no interactivity budget to protect |
| POS terminal (`/pos`)                                | Client Component shell with a local store, hydrated once | Must respond in <100ms per keystroke and must work with no network     |
| Realtime widgets (stock counters, live sales feed)   | Client Components on Convex subscriptions                | Push updates without polling                                           |

**Design direction.** The UI targets a cashier working a queue and an owner who
is not technical. That means: dense over airy, keyboard-first, high contrast,
no decorative motion. Every POS action has a keyboard binding (`F2` search,
`F4` discount, `F8` pay, `Enter` confirm). Touch targets are ≥44px because the
common device is a cheap Android tablet, often used one-handed. Tailwind tokens
and shadcn/ui primitives are wrapped once in `components/ui/` — feature code
never reaches for raw utility soup.

**Branding is data, not code.** Each business's `branding` document drives CSS
custom properties injected at the layout boundary
(`--brand-primary`, `--brand-secondary`, logo URL). No business-specific
conditionals anywhere in the component tree.

**Internationalisation.** Copy goes through a message catalogue from day one
(English base, Swahili next, French after) even though v1 ships English only —
retrofitting i18n into a mature component tree is expensive, adding a second
locale to a prepared one is not.

---

## 3. Backend

Next.js is the application layer. Convex is the data layer. The split:

| Concern                                              | Lives in                | Reason                                                   |
| ---------------------------------------------------- | ----------------------- | -------------------------------------------------------- |
| Transactional business logic (sales, stock, refunds) | Convex mutations        | Needs the transaction boundary                           |
| Reads for UI                                         | Convex queries          | Reactive, tenant-checked                                 |
| Third-party calls (M-Pesa, AI providers, SMS)        | Convex actions          | Non-transactional, can await network                     |
| Inbound webhooks                                     | Next.js Route Handlers  | Need raw body access, custom headers, provider IP checks |
| AI response streaming                                | Next.js Route Handler   | Streams tokens to the browser                            |
| Form submissions from RSC pages                      | Server Actions          | Thin — validate, call service, revalidate                |
| Scheduled work (reconciliation, digests, alerts)     | Convex cron + scheduler | Runs next to the data, no separate worker                |

**Layering rule, enforced in review:** business logic never lives in a route
handler, a Server Action or a React component.

```
Route Handler / Server Action / Convex function
        │  (transport: parse, authenticate, validate with Zod)
        ▼
    Service            services/sales, services/inventory, services/payments…
        │  (business rules, orchestration, invariants)
        ▼
   Repository          data access, always tenant-scoped
        │
        ▼
    Convex
```

Route handlers do four things and no more: parse, authenticate, validate, and
delegate. If a handler contains an `if` about business rules, it is in the
wrong place.

---

## 4. Database

**Convex is the system of record for all tenant data.**

Businesses, users, memberships, roles, products, inventory, stock movements,
sales, payments, customers, suppliers, employees, notifications, AI insights
and audit logs all live in Convex.

The decisive property is the transaction. Completing a sale is a single Convex
mutation that:

1. re-reads current stock inside the transaction,
2. rejects the sale if any line would oversell,
3. writes the sale and its lines,
4. writes one stock movement per line,
5. decrements inventory levels,
6. records the payment,
7. writes the audit log entry.

All seven happen atomically, or none do. Convex's optimistic concurrency
control retries the transaction on conflict, so two cashiers selling the last
unit of a product cannot both succeed. Getting this right in an app-layer ORM
against a serverless connection pool is possible but materially harder and is
where POS systems typically leak.

### On Drizzle

The brief specifies Drizzle ORM and also instructs: _"Do not force Drizzle into
places where it conflicts with Convex's architecture."_ They conflict directly.
Drizzle is a SQL query builder for Postgres/MySQL/SQLite; Convex is a document
database with its own transactional runtime and no SQL surface. There is no
seam where Drizzle can sit on top of Convex.

**Resolution:** Convex owns OLTP. Drizzle is retained for a _later, optional_
Postgres analytics read-model — the place where it is genuinely the right tool,
because long-range reporting over millions of sale lines wants SQL window
functions and columnar scans, not document reads. Nothing in v1 depends on it.
Full reasoning, including the alternative (drop Convex, go Postgres+Drizzle) and
why it was not chosen, is in
[ADR-0001](decisions/0001-convex-as-system-of-record.md).

The application never imports the database client directly. All access goes
through repository functions, so the read-model can be added — or the whole
store swapped — without touching services.

### Money

Every monetary value is stored as an **integer in the currency's minor unit**
(cents, and for KES also cents) alongside its ISO-4217 code. No floats, ever.
`19.99` is `1999`. Rounding happens once, at the point of display, using the
currency's exponent. This is not a preference; float arithmetic on money
produces receipts that do not add up, and in a POS that is a customer dispute.

---

## 5. Multi-tenancy

Every business is a tenant. The isolation model is **shared database,
row-level tenancy, enforced in a single choke point.**

```
Platform
├── Business A ── users · products · sales · inventory · customers
├── Business B ── users · products · sales · inventory · customers
└── Business C ── users · products · sales · inventory · customers
```

Requirement 7 says "separate database" per business. Read as intent — complete
data isolation — rather than as a literal physical instruction: a database per
tenant makes migrations, cross-tenant platform analytics and the free tier
economically unworkable at SME price points. The isolation guarantee is met by
enforcement, not by physical separation, and the enforcement is designed to be
un-bypassable rather than merely conventional.

**The rules:**

1. Every tenant-owned document carries `businessId` as its first indexed field.
2. Every index begins with `businessId` (`by_business_and_sku`, not `by_sku`).
3. **The client never supplies `businessId`.** It is derived server-side from
   the authenticated identity plus the active membership, on every single call.
4. All tenant data access goes through one wrapper. Repositories are not
   allowed to call `ctx.db` directly:

   ```ts
   // convex/lib/tenancy.ts
   export const tenantQuery = customQuery(query, {
     args: {},
     input: async (ctx) => {
       const identity = await ctx.auth.getUserIdentity();
       if (!identity) throw new AppError("UNAUTHENTICATED");
       const { user, business, membership, role } = await resolveActiveContext(
         ctx,
         identity.subject,
       );
       return {
         ctx: { ...ctx, tenant: { user, business, membership, role } },
         args: {},
       };
     },
   });
   ```

   A function written with `tenantQuery`/`tenantMutation` cannot see another
   tenant's rows without a deliberate, reviewable act.

5. A lint rule bans raw `ctx.db` outside `convex/lib/`, and the test suite
   includes a cross-tenant matrix: for every tenant-scoped function, business A
   attempting to read or write business B's entity must fail closed.

Switching businesses (one owner, several shops) re-resolves the whole context
server-side; there is no client-held tenant token to tamper with.

---

## 6. Authentication and authorization

**Clerk for identity, Convex for tenancy and permissions.**

Clerk covers what the requirements ask for and what is expensive to build
safely: email login, phone-number login with SMS OTP (essential in this market,
where a shop owner may not have an email address they check), two-factor
authentication, session management and device revocation. Convex verifies
Clerk's JWT on every function call.

The split matters: **Clerk answers "who is this person", Convex answers "what
may they do here".** Tenancy and roles deliberately do _not_ live in Clerk
Organizations — that would put authorization state in a vendor we may replace,
and it does not model a cashier who works at two shops with different
permissions in each.

```
User ──< Membership >── Business
             │
             └── Role ──< Permission[]
```

### RBAC, not role checks

Permissions are the unit of authorization; roles are named bundles of them.
Code always asks about a permission, never about a role name:

```ts
// yes
requirePermission(ctx, "reports:financial:read");

// no — this is what the brief rules out
if (user.role === "owner" || user.role === "manager") { … }
```

Seeded system roles (a business may later define custom ones):

| Permission                            | Owner | Manager | Cashier |
| ------------------------------------- | :---: | :-----: | :-----: |
| `sales:create`                        |  ✅   |   ✅    |   ✅    |
| `sales:refund`                        |  ✅   |   ✅    |    —    |
| `sales:discount` (within cap)         |  ✅   |   ✅    |   ✅    |
| `sales:discount:override` (above cap) |  ✅   |   ✅    |    —    |
| `products:read`                       |  ✅   |   ✅    |   ✅    |
| `products:write`                      |  ✅   |   ✅    |    —    |
| `inventory:read`                      |  ✅   |   ✅    |   ✅    |
| `inventory:adjust`                    |  ✅   |   ✅    |    —    |
| `suppliers:manage`                    |  ✅   |   ✅    |    —    |
| `customers:read` / `customers:write`  |  ✅   |   ✅    |   ✅    |
| `reports:operational:read`            |  ✅   |   ✅    |    —    |
| `reports:financial:read`              |  ✅   |    —    |    —    |
| `employees:manage`                    |  ✅   |    —    |    —    |
| `roles:manage`                        |  ✅   |    —    |    —    |
| `settings:write`                      |  ✅   |    —    |    —    |
| `subscription:manage`                 |  ✅   |    —    |    —    |
| `ai:query`                            |  ✅   |   ✅    |    —    |
| `audit:read`                          |  ✅   |    —    |    —    |

The requirement "cashiers cannot access profit reports" is satisfied
structurally: cost price and margin are stripped from payloads at the
repository boundary when `reports:financial:read` is absent, so the data never
reaches the browser. Hiding a nav link is not access control.

---

## 7. Payments

Payments are abstracted from the first commit. The POS knows about _taking a
payment_, never about M-Pesa.

```
              PaymentService
                    │
    ┌───────────────┼────────────────┬───────────────┐
    ▼               ▼                ▼               ▼
CashProvider   MpesaProvider   AirtelProvider    CardProvider
   (v1)            (v1)          (later)          (later)
```

```ts
export interface PaymentProvider {
  readonly method: PaymentMethod;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  parseCallback(raw: RawCallback): Promise<NormalizedPaymentEvent>;
  queryStatus(providerRef: string): Promise<PaymentStatus>;
}
```

Adding Airtel Money means writing one file and registering it. No POS,
receipt or reporting code changes.

### The M-Pesa flow, including the parts that go wrong

```
Cashier taps "M-Pesa"
   │
   ├─▶ payment row created: status=pending, idempotencyKey, providerRef=null
   │
   ├─▶ Convex action → Daraja STK push → CheckoutRequestID stored
   │
   ├─▶ POS shows "Waiting for customer PIN…" (subscription on the payment row)
   │
   ├─◀ Daraja POSTs the callback → /api/payments/mpesa/callback
   │      • provider IP allowlist + unguessable path token
   │      • raw body persisted to paymentEvents before any parsing
   │      • unique index on (provider, externalId) → duplicate callbacks are
   │        recorded and then ignored, not reprocessed
   │      • single mutation: mark payment succeeded + complete the sale
   │
   └─▶ Timeout path (~60s, no callback):
          scheduled STK-query reconciliation → succeeded | failed | still
          pending → retry with backoff, cap, then flag for manual review
```

Every branch the brief lists is a real state in the model:
`pending · succeeded · failed · cancelled · timeout · reversed`.

**Non-negotiables:**

- Secrets are server-side only. Consumer key, secret, passkey and shortcode
  never enter a client bundle.
- Idempotency is enforced by unique index, not by an `if` statement — a
  duplicate callback that races an in-flight one loses at the database level.
- No fake success. There is no code path that marks a payment succeeded without
  a verified provider confirmation, in any environment. The sandbox is
  configured by environment variable; the logic is identical.
- A daily reconciliation job compares Convex payments against provider
  statements and raises a variance notification. Payments are not
  fire-and-forget.

---

## 8. AI architecture

Two layers: a provider abstraction, and a tool layer that is the _only_ path
from a model to business data.

```
                       AIService
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  OpenAIProvider    GeminiProvider    AnthropicProvider
```

```ts
export interface AIProvider {
  readonly id: AIProviderId;
  generate(req: AIRequest): Promise<AIResponse>;
  stream(req: AIRequest): AsyncIterable<AIStreamChunk>;
  supportsTools: boolean;
}
```

Providers are selected by configuration and can differ per workload — a cheap
fast model for insight summaries, a stronger one for the conversational
assistant. Business logic never names a model.

### The tool boundary

The model gets **no database access**. It gets a registry of typed, read-only
tools, each declaring the permission it requires:

```ts
defineTool({
  name: "get_sales_summary",
  description: "Total sales, transaction count and average basket for a period.",
  input: z.object({ from: z.string().date(), to: z.string().date() }),
  requiredPermission: "reports:operational:read",
  handler: async (ctx, input) => salesService.summarize(ctx.tenant, input),
});
```

v1 tool set: `get_sales_summary`, `get_product_sales`, `get_top_products`,
`get_inventory_status`, `get_low_stock_products`, `get_customer_summary`,
`get_sales_trends`, `get_profit_summary` (owner only),
`get_employee_performance`.

Every call runs the full chain:

```
AI ─▶ Tool ─▶ Authorization ─▶ Tenant-scoped data ─▶ AI response
```

The authorization step is not advisory. Tools execute with the _requesting
user's_ context; a cashier's assistant literally cannot call
`get_profit_summary`, and a model that hallucinates a `businessId` argument
gets nowhere because tools do not accept one.

**Hallucinated data is treated as a defect.** Answers are grounded in tool
results; when no tool returns data, the assistant says it does not have that
information rather than inventing a figure. Every AI answer stores the tool
calls and results that produced it, so any number on screen is traceable.

**Write actions** (create a purchase order, launch a promotion) are out of v1
scope and, when added, follow: AI proposes → the proposal is persisted → a
permitted human confirms → the ordinary authorized service executes it. The
model never gets a destructive verb.

**Prompt injection** is an active concern, not a theoretical one: product
names, customer notes and supplier fields are attacker-controllable by anyone
with a cashier login. Tool output is delimited and labelled as untrusted data,
never concatenated into the system prompt.

---

## 9. Offline capability

The single hardest requirement, and the one most likely to be underestimated.
Convex's reactive cache keeps a warm client fast; it does **not** survive a
reload, and it does not queue writes. Offline needs deliberate machinery:

- **Catalogue cache** — products, categories, prices and tax rates persisted to
  IndexedDB, refreshed on connect.
- **Outbox** — completed sales are written locally first, with a
  client-generated UUID, then drained to the server in order when connectivity
  returns. That UUID is the idempotency key, so a replay after a flaky
  reconnect cannot double-post a sale.
- **Cash only, by design.** M-Pesa requires the network by definition. Offline
  sales accept cash and are marked as such.
- **Honest stock.** Offline stock is a projection, not a reservation. The
  server is authoritative on sync; oversells are surfaced as reconciliation
  items rather than silently absorbed.
- **Visible state.** The cashier always sees online/offline and the pending
  count. Hiding degradation from the operator is how POS deployments lose trust.

Detail in [ADR-0005](decisions/0005-offline-first-pos.md). Scope note: v1 ships
the outbox and cash-only offline sales; full multi-device offline conflict
resolution is explicitly Phase 7.

---

## 10. Auditing and observability

**Audit log.** Append-only, tenant-scoped, never edited or deleted. Written
inside the same transaction as the action it records, so an audited action
cannot succeed without its log entry. Covers login, sale created, sale
refunded, product modified, stock adjusted, discount approved, employee
created, permission changed and payment recorded — each with actor, business,
action, entity, timestamp and metadata.

**Logging.** Structured JSON, correlation ID per request. Money amounts, PII,
tokens and full webhook payloads are redacted at the logger, not at each call
site. Payment callback bodies are stored in `paymentEvents` (access-controlled)
rather than in application logs.

**Errors.** A typed `AppError` hierarchy with stable codes. Clients receive a
code and a safe message; stack traces and internals stay server-side. Error
monitoring (Sentry) is wired in Phase 2, not bolted on before launch.

---

## 11. Hosting and deployment

| Environment | App                   | Data                      |
| ----------- | --------------------- | ------------------------- |
| Local       | `next dev`            | `convex dev`              |
| Preview     | Vercel preview per PR | Convex preview deployment |
| Production  | Vercel production     | Convex production         |

Vercel for the app; Convex Cloud for data, with the deployment region chosen
for East African latency. Preview deployments get isolated Convex deployments
so a PR can never touch production data.

Production readiness is treated as a build requirement, not a launch task:
environment variables validated at boot (the app refuses to start with a
missing secret rather than failing on the first sale), production-safe logging,
health checks, error monitoring, and separate M-Pesa sandbox/production
credentials.

---

## 12. Testing

The rule from the brief holds: a feature is not done because the UI works.
Critical business logic ships with tests, and the following are treated as
release-blocking:

- **Tenant isolation** — the cross-tenant matrix described in §5.
- **Authorization** — every permission, positive and negative, per role.
- **Sale arithmetic** — line totals, order-of-operations for discount vs tax,
  inclusive and exclusive tax, multi-currency rounding to minor units.
- **Inventory** — deduction on sale, restock on refund, concurrent-sale
  oversell prevention, ledger-vs-level reconciliation.
- **Payments** — every state transition; duplicate callback; out-of-order
  callback; timeout then late success; malformed and forged callbacks.
- **AI tools** — permission enforcement per tool and refusal to answer without
  grounding data.

Vitest for unit and integration (against a real Convex test deployment, not
mocks — mocked transactions prove nothing about transactional behaviour),
Playwright for the cashier journey and the offline path via network throttling.

---

## 13. What this architecture deliberately does not do yet

Named so that they stay out of v1 while the seams remain in place: restaurant
tables and kitchen orders, pharmacy batch/expiry tracking, salon appointments,
the module marketplace, mobile apps, WhatsApp/SMS receipt delivery, loyalty
points, accounting integrations, computer-vision inventory, voice assistant,
and AI write-actions.

The architecture accommodates each — industry modules hang off `businessType`
with per-module schema extensions; receipt delivery is a channel behind the
existing receipt renderer; loyalty is a ledger next to customers — but none is
built until the MVP is stable. See [`MVP-SCOPE.md`](MVP-SCOPE.md) for the exact
line.
