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

**Phase 1 — Architecture. Planning complete, implementation not started.**

This repository currently contains the architecture and implementation plan
only. No application code has been written yet, by design: the specification
calls for the architecture to be reviewed and approved before Phase 2
(Foundation) begins.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Architecture & data model | ✅ Complete (this repo) |
| 2 | Foundation — Next.js, Convex, auth, RBAC, tenancy | ⏳ Awaiting approval |
| 3 | Products & inventory | ⏳ Not started |
| 4 | POS & payments (Cash, M-Pesa) | ⏳ Not started |
| 5 | Dashboard & reporting | ⏳ Not started |
| 6 | AI assistant & insights | ⏳ Not started |

---

## Documentation

Start here, in order:

| Document | What it covers |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture — frontend, backend, database, auth, payments, AI, hosting, multi-tenancy |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Entities, relationships, indexes, tenancy keys |
| [`docs/PROJECT-STRUCTURE.md`](docs/PROJECT-STRUCTURE.md) | Proposed folder structure and layering rules |
| [`docs/MVP-SCOPE.md`](docs/MVP-SCOPE.md) | Explicit BUILD NOW vs BUILD LATER boundary |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased, testable implementation plan |
| [`docs/RISKS.md`](docs/RISKS.md) | Technical risks and mitigations |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security model, threat notes, non-negotiables |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (ADRs) |

The product specification this plan is derived from is
_AI-Powered Customizable Point of Sale (POS) SaaS Platform_ (requirements
document, v1).

---

## Intended stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui |
| Backend | Next.js Route Handlers + Server Actions; Convex functions for data access |
| Database | Convex (system of record for all tenant data) |
| ORM | Drizzle — scoped to the optional Postgres analytics read-model only, **not** to OLTP ([ADR-0001](docs/decisions/0001-convex-as-system-of-record.md)) |
| Auth | Clerk (identity) + Convex (tenancy & RBAC) |
| Payments | Provider abstraction — Cash and M-Pesa Daraja in v1 |
| AI | Provider abstraction over OpenAI, Google Gemini and Anthropic Claude, with server-side tool calling |
| Hosting | Vercel (app) + Convex Cloud (data) |
| Testing | Vitest (unit/integration), Playwright (E2E) |

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

There is nothing to run yet. Once Phase 2 lands, the flow will be:

```bash
npm install
cp .env.example .env.local   # fill in your own values
npx convex dev               # provisions a dev deployment, watches functions
npm run dev                  # http://localhost:3000
```

Secrets are never committed. `.env.example` documents every variable the
platform reads; see [`docs/SECURITY.md`](docs/SECURITY.md) for the rules on
which are server-only.

---

## License

Proprietary. All rights reserved.
