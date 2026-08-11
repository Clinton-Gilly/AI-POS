# Application Structure

**Status:** Proposed (Phase 1 deliverable)

The layout follows Next.js App Router conventions where they are clearer than a
generic `src/` taxonomy, and departs from them where a POS needs stronger
boundaries — notably by keeping business logic out of route handlers entirely.

---

## 1. Tree

```
AI-POS/
├── convex/                          # Convex backend — schema, functions, crons
│   ├── schema.ts                    # Single source of truth for all tables/indexes
│   ├── lib/
│   │   ├── tenancy.ts               # tenantQuery / tenantMutation / tenantAction wrappers
│   │   ├── permissions.ts           # requirePermission, permission constants
│   │   ├── errors.ts                # AppError hierarchy, typed codes
│   │   ├── money.ts                 # minor-unit arithmetic, rounding
│   │   └── audit.ts                 # writeAuditLog — called inside mutations
│   ├── model/                       # Repository layer — the ONLY place ctx.db is touched
│   │   ├── products.ts
│   │   ├── inventory.ts
│   │   ├── sales.ts
│   │   ├── payments.ts
│   │   ├── customers.ts
│   │   ├── suppliers.ts
│   │   ├── businesses.ts
│   │   └── memberships.ts
│   ├── products.ts                  # Public function surface (queries/mutations)
│   ├── inventory.ts
│   ├── sales.ts                     # completeSale — the core transaction
│   ├── payments.ts
│   ├── customers.ts
│   ├── suppliers.ts
│   ├── employees.ts
│   ├── reports.ts
│   ├── ai.ts
│   ├── businesses.ts
│   ├── crons.ts                     # reconciliation, low-stock scan, digests
│   └── _generated/                  # Convex codegen (committed)
│
├── src/
│   ├── app/
│   │   ├── (auth)/                  # Unauthenticated: sign-in, sign-up, onboarding
│   │   │   ├── sign-in/
│   │   │   ├── sign-up/
│   │   │   └── onboarding/          # Business registration wizard
│   │   ├── (app)/                   # Authenticated shell: nav, tenant context, branding
│   │   │   ├── layout.tsx           # Resolves tenant server-side, injects brand CSS vars
│   │   │   ├── dashboard/
│   │   │   ├── products/
│   │   │   ├── inventory/
│   │   │   ├── customers/
│   │   │   ├── suppliers/
│   │   │   ├── employees/
│   │   │   ├── reports/
│   │   │   ├── assistant/           # AI business assistant
│   │   │   └── settings/
│   │   │       ├── business/
│   │   │       ├── branding/
│   │   │       ├── taxes/
│   │   │       ├── roles/
│   │   │       └── subscription/
│   │   ├── pos/                     # Deliberately OUTSIDE (app) — its own minimal
│   │   │   ├── layout.tsx           # chrome, no sidebar, offline-capable shell
│   │   │   └── page.tsx
│   │   └── api/
│   │       ├── payments/
│   │       │   └── mpesa/
│   │       │       ├── callback/route.ts     # STK callback
│   │       │       └── timeout/route.ts      # Daraja queue timeout
│   │       ├── ai/
│   │       │   └── chat/route.ts             # Streaming assistant
│   │       ├── receipts/
│   │       │   └── [saleId]/route.ts         # Public digital receipt (signed token)
│   │       └── health/route.ts
│   │
│   ├── components/
│   │   ├── ui/                      # shadcn/ui primitives — wrapped once, never inlined
│   │   ├── pos/                     # Cart, ProductGrid, PaymentDialog, ReceiptPreview
│   │   ├── dashboard/               # StatTile, SalesTrendChart, TopProductsTable
│   │   ├── inventory/
│   │   ├── products/
│   │   ├── reports/
│   │   ├── assistant/
│   │   └── shared/                  # AppShell, DataTable, EmptyState, MoneyText…
│   │
│   ├── services/                    # Business logic. No React, no Next, no HTTP.
│   │   ├── sales/
│   │   │   ├── calculate-totals.ts  # Pure. Discounts, tax, rounding. Heavily tested
│   │   │   ├── complete-sale.ts
│   │   │   └── refund-sale.ts
│   │   ├── inventory/
│   │   ├── payments/
│   │   │   ├── payment-service.ts   # Provider-agnostic orchestration
│   │   │   └── providers/
│   │   │       ├── types.ts         # PaymentProvider interface
│   │   │       ├── cash.ts
│   │   │       ├── mpesa/
│   │   │       │   ├── client.ts    # Daraja HTTP: auth, STK push, STK query
│   │   │       │   ├── provider.ts
│   │   │       │   └── callback.ts  # Verify → normalise → dedupe
│   │   │       └── registry.ts
│   │   ├── customers/
│   │   ├── receipts/
│   │   │   ├── render.ts            # Channel-agnostic receipt document model
│   │   │   ├── thermal.ts           # ESC/POS
│   │   │   └── html.ts              # Digital / print / PDF
│   │   ├── reports/
│   │   └── ai/
│   │       ├── ai-service.ts
│   │       ├── providers/
│   │       │   ├── types.ts         # AIProvider interface
│   │       │   ├── openai.ts
│   │       │   ├── gemini.ts
│   │       │   ├── anthropic.ts
│   │       │   └── registry.ts
│   │       ├── tools/
│   │       │   ├── define-tool.ts   # Tool contract: schema + requiredPermission
│   │       │   ├── registry.ts
│   │       │   ├── sales-tools.ts
│   │       │   ├── inventory-tools.ts
│   │       │   └── customer-tools.ts
│   │       ├── executor.ts          # Authorization gate — tools run through here only
│   │       └── prompts/
│   │
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── permissions.ts       # Permission union — shared with convex/
│   │   │   ├── require-permission.ts
│   │   │   └── tenant-context.ts    # Server-side resolution. Never reads client input
│   │   ├── validation/              # Zod schemas, shared client + server
│   │   ├── money/                   # Minor-unit arithmetic, formatting, currency table
│   │   ├── offline/
│   │   │   ├── outbox.ts            # IndexedDB queue + drain loop
│   │   │   ├── catalogue-cache.ts
│   │   │   └── sync-status.ts
│   │   ├── errors/
│   │   ├── logger/                  # Structured, redacting
│   │   └── utils/
│   │
│   ├── config/
│   │   ├── env.ts                   # Zod-validated env. Throws at boot, not at first sale
│   │   ├── currencies.ts            # Minor-unit exponents
│   │   ├── permissions.ts           # Role → permission seed matrix
│   │   └── feature-flags.ts
│   │
│   ├── types/
│   └── i18n/                        # Message catalogues: en, sw, fr
│
├── tests/
│   ├── unit/                        # Pure logic: totals, tax, money, permissions
│   ├── integration/                 # Against a real Convex test deployment
│   │   ├── tenancy.test.ts          # Cross-tenant isolation matrix
│   │   ├── sales.test.ts
│   │   ├── inventory.test.ts
│   │   └── payments/
│   │       ├── mpesa-callback.test.ts
│   │       └── idempotency.test.ts
│   └── e2e/                         # Playwright: cashier journey, offline path
│
├── docs/                            # This documentation set
├── scripts/
│   └── seed.ts                      # Realistic dev data
├── .env.example
└── package.json
```

---

## 2. Layering rules

```
  UI (app/, components/)
        │  may call
        ▼
  Services (services/)          ← all business rules live here
        │  may call
        ▼
  Repositories (convex/model/)  ← only layer allowed to touch ctx.db
        │
        ▼
  Convex
```

Enforced, not merely documented:

- **`ctx.db` outside `convex/model/` and `convex/lib/` is a lint error.** This
  is what makes tenant scoping un-bypassable rather than a habit.
- **Route handlers and Server Actions contain no business rules.** Parse,
  authenticate, validate, delegate, return. A business `if` in a route handler
  fails review.
- **Services are framework-free.** No React imports, no `next/*`, no
  `Request`/`Response`. This is what keeps them unit-testable and what makes a
  later extraction into a standalone Node service mechanical.
- **Components never call providers directly.** A component that imports the
  M-Pesa client or the OpenAI SDK is a bug — that is how secrets end up in
  client bundles.
- **One direction only.** Services never import from `app/` or `components/`.

## 3. Why `/pos` sits outside `(app)`

The cashier surface has different requirements from every other page: no
sidebar, no analytics widgets, minimum JavaScript, aggressive caching, and it
must render and function with no network. Nesting it inside the authenticated
dashboard shell would drag that shell's layout, data fetching and bundle into
the till. Its own route group keeps the till's critical path short and its
offline story tractable.

## 4. Where future modules attach

Industry modules (restaurant tables, pharmacy batches, salon appointments) are
built as vertical slices that plug into fixed extension points rather than
threading `if (businessType === …)` through core code:

- a schema extension file under `convex/modules/<module>/`,
- a route group under `src/app/(app)/<module>/`,
- registration in `config/modules.ts`, gated by `business.businessType` and the
  subscription plan.

Core sales, inventory and payment code stays untouched when a module is added —
which is the precondition for the marketplace in requirement 14 ever being
viable.
