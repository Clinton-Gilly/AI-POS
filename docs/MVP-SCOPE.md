# MVP Scope — Build Now vs Build Later

**Status:** Proposed (Phase 1 deliverable)

The requirements document describes a mature platform. Shipping all of it
before any of it is used by a real shop would be the primary way this project
fails. This page draws the line.

**The MVP test:** a single Kenyan retail shop can run its entire trading day on
this system — sell, take cash and M-Pesa, print a receipt, keep stock accurate,
close the till, and see what happened — and its owner can ask the assistant a
question about the day and get an answer grounded in real data.

Anything not required by that sentence is deferred.

---

## BUILD NOW — v1

### Foundation

- Next.js App Router, TypeScript strict, Tailwind, shadcn/ui
- Convex schema, all v1 tables and indexes
- Clerk auth: email + phone/OTP login, 2FA available
- Multi-tenancy with server-side context resolution and the enforced wrapper
- RBAC: Owner / Manager / Cashier with the permission matrix
- Zod validation on every input boundary
- Typed error handling, structured redacting logger
- Environment validation at boot
- Audit logging for the full audited action set
- App shell, navigation, business-branded theming

### Business setup

- Registration and onboarding wizard
- Name, logo upload, contact details, location, currency, timezone, business type
- Branding: primary/secondary colour, receipt header/footer
- Tax rate configuration (inclusive and exclusive)
- Discount policy: cashier cap, approval threshold

### Products & inventory

- Categories (one level of nesting)
- Products: SKU, barcode, cost price, selling price, unit, image, tax rate,
  low-stock threshold, active/inactive
- Fast product search (name, SKU, barcode) — sub-100ms
- Stock levels per product
- Stock movements ledger with reasons
- Manual stock adjustments (permission-gated)
- Low-stock alerts and notifications
- Inventory history view
- Suppliers CRUD

### POS

- Cashier terminal: search, category browse, barcode scanning (keyboard-wedge)
- Cart: add, quantity, remove, line discount, order discount
- Tax calculation, inclusive and exclusive
- Customer selection (optional) and quick-create by phone
- **Cash payment** with change calculation
- **M-Pesa payment** via Daraja STK push, real callbacks, full state machine
- Split tender (cash + M-Pesa on one sale)
- Transaction confirmation and receipt
- Transaction history with filters
- Refunds: full and partial, with approval and restock
- Shift open/close with cash reconciliation
- Keyboard shortcuts throughout
- **Offline: cash sales queue to a local outbox and sync on reconnect**

### Receipts

- Receipt document model with business branding
- Thermal printer output (ESC/POS, 58mm and 80mm)
- Browser print / PDF
- Digital receipt at a signed public URL with QR code on the printed copy

### Dashboard & reports

- Today: sales, transactions, revenue, estimated profit
- Sales trend chart (configurable period)
- Top-selling products
- Low-stock list
- Recent transactions
- Customer growth
- Sales report (daily/period, by product, by cashier)
- Financial report: revenue, COGS, gross profit — **owner only**
- Inventory report: movements, wastage, current valuation
- CSV export

### Customers & employees

- Customer CRUD, purchase history, spend totals
- Loyalty points accrual (display only)
- Employee invite, role assignment, suspend
- Employee sales performance

### AI

- Provider abstraction with OpenAI, Gemini and Anthropic adapters, configurable
- Business assistant: streaming chat over the v1 tool set
- Tools with per-tool permission enforcement and tenant scoping
- Scheduled insights: low-stock forecast, sales trend, simple anomalies
- Full traceability — every answer stores its tool calls and results

### Non-functional

- Test suites for tenancy, authorization, sale arithmetic, inventory, payments,
  AI tool authorization
- Playwright cashier journey including the offline path
- Vercel + Convex production configuration, error monitoring, health check
- Realistic seed data

---

## BUILD LATER

Ordered roughly by expected sequence, with the seam that keeps each cheap.

### Phase 7 — Operational depth

| Feature                                            | Seam already in place                                    |
| -------------------------------------------------- | -------------------------------------------------------- |
| Purchase orders (receive stock, supplier payments) | `purchaseOrders` table exists in v1 schema               |
| Multi-location / branches, stock transfers         | `locationId` on inventory and sales from day one         |
| Product variants (size, colour)                    | Sale lines snapshot name and price; `variantId` slots in |
| Custom roles beyond the three system roles         | `roles` is already a table, not an enum                  |
| Loyalty redemption ledger                          | `loyaltyPoints` accrues in v1                            |
| Expenses tracking                                  | Reporting already separates revenue from COGS            |
| Audit log archival and retention                   | Append-only design tolerates cold storage                |

### Phase 8 — Reach

| Feature                                         | Seam                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| WhatsApp / SMS / email receipt delivery         | Receipt renderer is already channel-agnostic               |
| Airtel Money, card, bank transfer, credit terms | `PaymentProvider` interface — one file per provider        |
| Swahili and French UI                           | i18n catalogue wired from v1                               |
| Multi-currency beyond the business default      | Currency + exponent stored next to every amount            |
| Mobile apps (Android/iOS)                       | Convex functions are the shared API                        |
| Two-way accounting sync (QuickBooks, Sage)      | Sales and payments are already an append-only event source |
| Cash drawer, weighing scale                     | `unit: "kg"` and ESC/POS drawer kick already modelled      |

### Phase 9 — Industry modules

Restaurant (tables, kitchen orders, menus) · Pharmacy (batches, expiry,
prescriptions) · Salon (appointments, service packages) · Hardware
(bulk units) — each a vertical slice against the module extension points in
[`PROJECT-STRUCTURE.md` §4](PROJECT-STRUCTURE.md), gated by `businessType`.

### Phase 10 — Platform & advanced AI

Module marketplace · AI write-actions behind
propose → confirm → authorized-execute · AI sales forecasting · computer-vision
inventory · voice assistant · Postgres analytics read-model with Drizzle
([ADR-0001](decisions/0001-convex-as-system-of-record.md)) · system
administrator console · self-serve subscription billing.

---

## Explicitly out of v1, and why

| Deferred                                                | Reason                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full offline (M-Pesa, multi-device conflict resolution) | M-Pesa cannot work offline by definition. Multi-device offline conflict resolution is a research-grade problem; v1 ships single-device cash-only offline, which covers the actual failure mode — a shop with intermittent internet                                       |
| Separate physical database per tenant (requirement 7)   | Read as intent, not instruction. Row-level tenancy with enforced scoping delivers the isolation guarantee; a database per tenant makes migrations and SME-tier pricing unworkable. Revisit only for an enterprise customer with a contractual data-residency requirement |
| Native mobile apps                                      | The responsive web app covers "view sales, manage inventory, receive notifications" on a phone. Native ships once the API surface has stopped moving                                                                                                                     |
| Two-factor enforced by default                          | Available from v1 via Clerk, but mandatory 2FA at a shop counter where staff share a terminal creates lockouts. Owner-configurable                                                                                                                                       |
| AI write-actions                                        | An LLM with destructive verbs against live inventory is the single highest-severity risk in this system. Read-only until the confirmation flow is built and tested                                                                                                       |
| Subscription self-service billing                       | v1 tenants are onboarded manually. The `subscriptions` table exists so no migration is needed later                                                                                                                                                                      |

---

## Definition of done for v1

Not "the UI works". A feature ships when:

1. Business logic has tests, including the failure paths.
2. Authorization is enforced server-side and covered by a negative test.
3. Tenant scoping is enforced and covered by the cross-tenant matrix.
4. Inputs are Zod-validated at the boundary.
5. Mutating actions write audit entries in the same transaction.
6. Errors are typed and safe — no internals leak to the client.
7. No mock data, no fake payment success, no fake AI responses on any path
   that reaches production.
8. It works on a 1280×800 tablet and a 390px phone.
