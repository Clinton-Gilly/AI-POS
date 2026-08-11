# Implementation Roadmap

**Status:** Proposed (Phase 1 deliverable)

Small, independently testable phases. Each has an explicit exit criterion — a
demonstrable capability, not a percentage. A phase is not complete until its
tests pass and its criterion is met in a preview deployment.

Phases 2–6 are sequenced by dependency, not by preference; each one's exit
criterion is the next one's precondition.

---

## Phase 1 — Architecture ✅

Requirements analysis, architecture, data model, authorization model, payment
architecture, AI architecture, folder structure, risk register.

**Exit:** this documentation set, reviewed and approved.

---

## Phase 2 — Foundation

The tenancy and authorization substrate. Everything after this assumes it is
correct, so it gets disproportionate test attention.

**2.1 Project skeleton**
Next.js App Router, TypeScript strict, Tailwind, shadcn/ui, ESLint/Prettier,
Vitest, Playwright, `.env.example`, Zod-validated env config that throws at
boot.

**2.2 Convex + schema**
Full v1 schema with every index. Codegen committed. Local and preview
deployments wired.

**2.3 Authentication**
Clerk integration, JWT verification in Convex, sign-in/sign-up, email and
phone/OTP, session handling, protected route middleware.

**2.4 Tenancy**
`tenantQuery` / `tenantMutation` / `tenantAction` wrappers. Server-side context
resolution. Lint rule banning raw `ctx.db` outside `convex/model/`. Business
switcher.

**2.5 RBAC**
Permission constants, seeded system roles, `requirePermission`, server-side
enforcement helpers, permission-aware UI primitives.

**2.6 Cross-cutting**
`AppError` hierarchy, redacting structured logger, audit log writer, money
utilities (minor units, currency exponents, rounding), Zod schema conventions.

**2.7 Shell**
Authenticated layout, navigation, business-branded theming via CSS custom
properties, responsive breakpoints, empty/loading/error states.

**2.8 Onboarding**
Business registration wizard: details, logo, currency, timezone, business type,
tax setup. Creates business + owner membership + default location + default role
set in one transaction.

> **Exit:** two businesses exist. A user in business A cannot read or write any
> entity in business B — proven by the cross-tenant test matrix, not by
> inspection. A cashier is denied every owner-only permission. Money utilities
> pass property-based rounding tests.

---

## Phase 3 — Products & inventory

**3.1** Categories CRUD.
**3.2** Products CRUD: SKU/barcode uniqueness per business, cost/selling price,
unit, tax rate, image upload, soft delete.
**3.3** Product search: name/SKU/barcode, indexed, benchmarked to sub-100ms at
5,000 products.
**3.4** Stock movements ledger + inventory levels projection, written in one
transaction.
**3.5** Manual adjustments with mandatory reason, permission-gated, audited.
**3.6** Low-stock detection, notifications, dashboard surface.
**3.7** Inventory history and valuation views.
**3.8** Suppliers CRUD.
**3.9** Seed script: realistic Kenyan retail catalogue.

> **Exit:** 120 seeded products. An adjustment updates the ledger and the level
> atomically. The nightly reconciliation job confirms
> `sum(movements) == level` for every product. Cost price is absent from
> payloads sent to a cashier session.

---

## Phase 4 — POS & payments

The core of the product, and where the highest-severity bugs live.

**4.1 Terminal UI** — search, category grid, cart, quantity, keyboard shortcuts,
tablet-first layout.
**4.2 Sale calculation** — pure `calculateTotals`: line discounts, order
discount, inclusive/exclusive tax, minor-unit rounding. Written test-first;
this function is the arithmetic authority for receipts, reports and margins.
**4.3 Discounts** — cashier cap, manager approval flow above threshold, audited.
**4.4 Customers at the till** — select or quick-create by phone.
**4.5 Cash payment** — tender, change, shift attribution.
**4.6 `completeSale`** — the core transaction: validate, re-check stock, write
sale + lines + movements + levels + payment + audit, atomically. Concurrency
test: N parallel sales of the last unit, exactly one succeeds.
**4.7 M-Pesa** — Daraja client (auth, STK push, STK query), provider
implementation, payment state machine.
**4.8 M-Pesa callback** — route handler with IP allowlist and path token, raw
persistence before parsing, unique-index dedupe, sale finalisation.
**4.9 Timeout & reconciliation** — scheduled STK query, backoff, manual-review
flag, daily reconciliation job.
**4.10 Split tender.**
**4.11 Receipts** — document model, ESC/POS thermal, HTML/PDF, signed public
digital receipt, QR code.
**4.12 Transaction history** — filters by date, cashier, method, customer.
**4.13 Refunds** — full and partial, approval, restock, audit.
**4.14 Shifts** — open/close, cash count, variance.
**4.15 Offline** — catalogue cache, outbox, drain loop, idempotent replay,
visible sync state, cash-only enforcement.

> **Exit:** a complete cash sale and a complete M-Pesa sale against the Daraja
> sandbox, each producing a printed and a digital receipt with correct stock
> deduction. Duplicate callbacks are provably no-ops. A sale created with the
> network disabled syncs exactly once on reconnect, verified by replaying the
> same outbox entry twice.

---

## Phase 5 — Dashboard & reporting

**5.1** Dashboard: today's sales, transactions, revenue, estimated profit,
low-stock count.
**5.2** Sales trend chart, business-timezone day boundaries.
**5.3** Top products, recent transactions, customer growth.
**5.4** Sales reports: period, by product, by cashier, by payment method.
**5.5** Financial report: revenue, COGS, gross profit — owner-only, enforced at
the repository boundary.
**5.6** Inventory reports: movement, wastage, valuation.
**5.7** CSV export.
**5.8** Report query performance against 90 days of seeded sales.

> **Exit:** every dashboard figure reconciles exactly with the underlying sale
> records for the same period, computed in the business's timezone. A manager
> session receives no margin data in any report payload.

---

## Phase 6 — AI

**6.1** `AIProvider` interface + OpenAI, Gemini and Anthropic adapters,
configurable per workload.
**6.2** Tool contract: Zod input schema + `requiredPermission` + handler.
**6.3** v1 tool set (nine tools) over existing services — no new data paths.
**6.4** Executor: resolves tenant context, enforces permissions, bounds
execution, logs calls.
**6.5** Assistant UI: streaming chat, conversation history, tool-call
transparency.
**6.6** Grounding: no answer without tool data; refusal copy when data is
absent; injection-resistant prompt construction with tool output labelled
untrusted.
**6.7** Scheduled insights: low-stock forecast, sales trends, anomalies.
**6.8** Cost controls: per-tenant token accounting, rate limits, caching.

> **Exit:** "How much did I sell today?" returns the exact figure from
> `get_sales_summary`, matching the dashboard to the shilling. A cashier
> session cannot invoke `get_profit_summary` — verified by test, not by prompt
> instruction. Asking about data the tools cannot supply produces an admission,
> not a number.

---

## Phase 7+ — Beyond MVP

Sequenced in [`MVP-SCOPE.md`](MVP-SCOPE.md): operational depth (purchase
orders, multi-location, variants, loyalty redemption), reach (WhatsApp/SMS
receipts, more payment providers, Swahili/French, mobile apps), industry
modules, then platform and advanced AI.

---

## Cross-cutting, every phase

These are not a phase; they are conditions of merge:

- Tests written with the feature, not after it.
- Tenant scoping and permission checks on every new function, with negative
  tests.
- Audit entries for every new mutating action.
- No `TODO` on anything security-relevant — that is a merge blocker, per the
  development rules.
- Preview deployment green before merge.
- Documentation updated in the same PR when architecture changes.
