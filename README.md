# AI-POS

**AI-Powered Customizable Point of Sale (POS) SaaS Platform for African SMEs.**

A multi-tenant POS platform that goes beyond recording transactions — it turns
business data into analytics, AI intelligence, recommendations and automation.

> POS → Business Data → Analytics → AI Intelligence → Recommendations → Automation

Built for retail shops, supermarkets, restaurants, pharmacies, salons, hardware
stores and wholesalers across Kenya and the wider African market, with
first-class support for M-Pesa, offline operation and multi-currency pricing.

---

## Status

**Phase 3 — Products & inventory complete.** The catalogue, the stock ledger
and supplier records are implemented and tested. There is no selling yet: the
till and payments are Phase 4.

| Phase | Scope                                                          | Status         |
| ----- | -------------------------------------------------------------- | -------------- |
| 1     | Architecture & data model                                      | ✅ Complete    |
| 2     | Foundation — Next.js, Convex, Clerk, tenancy, RBAC, onboarding | ✅ Complete    |
| 3     | Products & inventory                                           | ✅ Complete    |
| 4     | POS & payments (Cash, M-Pesa)                                  | ⏳ Next        |
| 5     | Dashboard & reporting                                          | ⏳ Not started |
| 6     | AI assistant & insights                                        | ⏳ Not started |

**Exit criteria met, proven by test rather than inspection — 116 tests pass.**

- _Phase 2._ Two businesses exist; a user in business A cannot read or write
  any entity in business B, and a cashier is denied every owner-only
  permission. See [`tests/convex/tenancy.test.ts`](tests/convex/tenancy.test.ts).
- _Phase 3._ `sum(stockMovements) == inventoryLevels.quantity` holds after
  every operation, an adjustment updates ledger and level atomically or not at
  all, and cost price is absent from every payload a cashier session receives.
  See [`tests/convex/inventory.test.ts`](tests/convex/inventory.test.ts) and
  [`catalogue.test.ts`](tests/convex/catalogue.test.ts).

---

## Documentation

Start here, in order:

| Document                                                 | What it covers                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)           | System architecture — frontend, backend, database, auth, payments, AI, hosting, multi-tenancy |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md)               | Entities, relationships, indexes, tenancy keys                                                |
| [`docs/PROJECT-STRUCTURE.md`](docs/PROJECT-STRUCTURE.md) | Proposed folder structure and layering rules                                                  |
| [`docs/MVP-SCOPE.md`](docs/MVP-SCOPE.md)                 | Explicit BUILD NOW vs BUILD LATER boundary                                                    |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)                     | Phased, testable implementation plan                                                          |
| [`docs/RISKS.md`](docs/RISKS.md)                         | Technical risks and mitigations                                                               |
| [`docs/SECURITY.md`](docs/SECURITY.md)                   | Security model, threat notes, non-negotiables                                                 |
| [`docs/decisions/`](docs/decisions/)                     | Architecture Decision Records (ADRs)                                                          |

The product specification this plan is derived from is
_AI-Powered Customizable Point of Sale (POS) SaaS Platform_ (requirements
document, v1).

---

## Intended stack

| Layer    | Choice                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui                                                                                   |
| Backend  | Next.js Route Handlers + Server Actions; Convex functions for data access                                                                            |
| Database | Convex (system of record for all tenant data)                                                                                                        |
| ORM      | Drizzle — scoped to the optional Postgres analytics read-model only, **not** to OLTP ([ADR-0001](docs/decisions/0001-convex-as-system-of-record.md)) |
| Auth     | Clerk (identity) + Convex (tenancy & RBAC)                                                                                                           |
| Payments | Provider abstraction — Cash and M-Pesa Daraja in v1                                                                                                  |
| AI       | Provider abstraction over OpenAI, Google Gemini and Anthropic Claude, with server-side tool calling                                                  |
| Hosting  | Vercel (app) + Convex Cloud (data)                                                                                                                   |
| Testing  | Vitest (unit/integration), Playwright (E2E)                                                                                                          |

Two stack decisions in the brief needed resolution before implementation —
both are recorded as ADRs:

- **Convex + Drizzle.** These do not compose: Drizzle is a SQL ORM and Convex is
  not SQL. Forcing Drizzle over Convex would mean giving up exactly the
  properties a POS needs. See
  [ADR-0001](docs/decisions/0001-convex-as-system-of-record.md).
- **Offline mode.** Convex's reactive cache is not a durable offline store. A
  local-first outbox is required. See
  [ADR-0005](docs/decisions/0005-offline-first-pos.md).

---

## Getting started

Cloning fresh? [`SETUP.md`](SETUP.md) walks the whole sequence step by step,
including the parts below that are easy to get wrong — start there if this is
your first time in the repo. The short version:

```bash
npm install
cp .env.example .env.local        # fill in your Convex and Clerk values

npx convex dev                    # provisions a dev deployment, watches functions
npm run dev                       # http://localhost:3000
```

Two pieces of setup are easy to miss and both fail closed rather than loudly:

1. **Clerk JWT template.** Create one named exactly `convex` in the Clerk
   dashboard, then point the Convex deployment at its issuer:
   `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev`.
   Without it, `ctx.auth.getUserIdentity()` returns null and every tenant
   function refuses with `UNAUTHENTICATED`.
2. **Environment variables** are validated by Zod at boot, so a missing secret
   stops the app starting instead of surfacing at a customer's first payment.

Secrets are never committed. `.env.example` documents every variable the
platform reads; see [`docs/SECURITY.md`](docs/SECURITY.md) for the rules on
which are server-only.

### Commands

| Command             | Does                                            |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Next.js dev server                              |
| `npm run convex`    | Convex dev deployment + codegen watcher         |
| `npm test`          | Vitest — unit and Convex integration suites     |
| `npm run typecheck` | `tsc --noEmit`                                  |
| `npm run lint`      | ESLint, including the tenancy and secrets rules |
| `npm run verify`    | typecheck + lint + tests, as CI runs them       |

### How the guardrails are enforced

Two ESLint rules do work that review alone would eventually miss:

- **Raw `ctx.db` is banned outside `convex/model/` and `convex/lib/`.** Tenant
  scoping lives in the repository layer, so a query cannot quietly skip it.
  ([ADR-0002](docs/decisions/0002-row-level-multi-tenancy.md))
- **`process.env` is banned outside `src/config/env.ts`**, so no secret escapes
  boot-time validation or reaches a client bundle.
  ([`docs/SECURITY.md` §5](docs/SECURITY.md))

A suppression of either is a review blocker, not a workaround.

---

## License

Proprietary. All rights reserved.
