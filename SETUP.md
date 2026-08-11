# Setting up a clone

For someone (or an agent) starting from a fresh `git clone`. This is the
sequence, in order — later steps depend on earlier ones actually working, not
just being attempted.

If you're an AI agent working through this: **stop and report** at any step
marked ⚠️ rather than guessing or working around it. A wrong guess here
(wrong Convex deployment, wrong Clerk app) is expensive to unwind later.

---

## 0. Before you start

Read [`README.md`](README.md) for what this project is, then
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what's built versus what's next.
**Phases 1–3 are complete and merged to `main`; Phase 4 (the till and
payments) has not been started.** Don't build Phase 4 without the project
owner's go-ahead — it's the one phase this project has deliberately paused on.

## 1. Install

```bash
git clone https://github.com/Clinton-Gilly/AI-POS.git
cd AI-POS
npm install
```

Node 20+ required. Confirm with `node -v`.

## 2. Convex

```bash
npx convex dev
```

First run prompts you to log in and either create a new Convex project or
link an existing deployment. If a deployment already exists for this project
(check with whoever has the Convex dashboard), **link to that one** rather
than creating a second — a second deployment starts empty and duplicates
effort.

This pushes `convex/schema.ts` and every function to your deployment and
writes `CONVEX_DEPLOYMENT` / regenerates `convex/_generated/` locally.

⚠️ **Check `git diff convex/_generated/` after this.** Those files were
hand-written from Convex's own codegen templates in an earlier session (no
authenticated deployment was reachable then — see the commit history on
`convex/_generated/`). Real codegen output is the source of truth. If it
differs, keep the regenerated version and commit it; don't revert to the
hand-written one.

Leave `npx convex dev` running in a terminal — it watches `convex/` and
redeploys on save.

## 3. Clerk

1. Create an application at [clerk.com](https://clerk.com) (or use the
   project's existing one — ask first).
2. **JWT Templates → New template → Convex.** Must be named exactly
   `convex`. Copy the issuer URL it shows you.
3. Point the Convex deployment at it:
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
   ```
   ⚠️ Skip this and every authenticated call fails with `UNAUTHENTICATED` —
   not a crash, just a silent wall. See `convex/auth.config.ts` for why it
   fails this way on purpose (closed, not broken).
4. Copy the publishable and secret keys from Clerk's API Keys page.

## 4. Environment

```bash
cp .env.example .env.local
```

Fill in:

```
NEXT_PUBLIC_CONVEX_URL=          # from step 2 — npx convex dashboard shows it
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

Leave the M-Pesa and AI provider variables blank — nothing in the codebase
uses them yet (Phase 4 and Phase 6 respectively). Every variable is documented
in `.env.example`, including which are server-only and why
([`docs/SECURITY.md`](docs/SECURITY.md) §5).

## 5. Run it

```bash
npm run dev
```

Open `http://localhost:3000`, sign up, and complete the onboarding wizard —
business name, country/currency, VAT rate, branding colour. This creates your
`businesses` row.

## 6. Seed demo data (optional but recommended)

Gives you something to look at instead of an empty dashboard: ~70 products
across 10 categories, 4 suppliers, 40 customers, and 90 days of realistic
trading history (Saturday peak, month-end lift, cash/M-Pesa mix). Full
reasoning in `convex/platform/demoData.ts`.

```bash
npx convex run platform/seed:seedDemo
```

With exactly one business in the deployment, this finds it automatically. If
you have more than one (e.g. you're sharing a deployment with someone else's
test business), it refuses and asks you to pass one explicitly:

```bash
npx convex run platform/seed:seedDemo '{"businessId": "j57..."}'
```

Find the id in the Convex dashboard's **Data** tab, `businesses` table.

The trading history runs as a background chain (one mutation per simulated
day) — watch it complete in the dashboard's **Logs** tab, under a minute for
90 days.

This step is idempotent in the safe direction: it refuses to touch a business
that already has products, so running it twice is a no-op, not a duplicate.

## 7. Verify everything actually works

```bash
npm run verify   # typecheck + lint + 128 tests — should all pass
npm run build    # production build
```

⚠️ If `npm run verify` fails on a fresh clone, **stop and report the exact
failure** before touching application code. A failure here means something
about the environment differs from what the test suite assumes (Node
version, a missing env var at build time) — fix that first, because building
on top of a red baseline just relocates the same failure into new code.

## 8. Look at what exists before adding to it

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and the
  reasoning behind it
- [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) — every table, every index, and
  why
- [`docs/decisions/`](docs/decisions/) — six ADRs, including two corrections
  worth reading before writing Convex queries:
  - **ADR-0001**: Convex is the system of record; Drizzle was in the original
    brief but doesn't compose with Convex — don't reach for it.
  - **ADR-0003**: idempotency (duplicate-callback protection, the kind Phase 4
    will need for M-Pesa) works through Convex's serializable transactions,
    **not** through a unique index — Convex doesn't have those. The check
    must live inside the mutation that writes. Get this wrong and Phase 4
    will have a duplicate-payment bug that only shows up under load.
- [`docs/MVP-SCOPE.md`](docs/MVP-SCOPE.md) — what's explicitly BUILD NOW vs.
  BUILD LATER. Don't build a BUILD LATER item without being asked.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — the phase plan and each phase's exit
  criterion, which is a test suite, not a vibe.

## Conventions this codebase enforces, not just documents

Two ESLint rules exist because review alone wasn't enough to keep to them —
both are checked as an error, not a warning:

- **No raw `ctx.db` outside `convex/model/`, `convex/lib/`, or
  `convex/platform/`.** Tenant scoping (`businessId` filtering) lives in the
  repository layer. A query that reaches the database directly from a public
  function has a real chance of leaking data across tenants. If you hit this
  error, move the query into `convex/model/<entity>.ts`.
- **No `process.env` outside `src/config/env.ts`.** All configuration is
  Zod-validated at boot in one place. Reading an env var directly elsewhere
  means it skips that validation and might silently be `undefined` in
  production.

Run `npm run lint` before you're surprised by CI (see below).

## A known blocker, not yours to fix

GitHub Actions has never successfully run a workflow in this repository —
confirmed with a trivial one-line test workflow that failed identically to
the real ones. This is a repository- or account-level setting (Settings →
Actions, or a billing/spending limit), not a YAML problem. See the comment
thread on PR #4 for the full diagnosis. Until the repo owner resolves it,
**`npm run verify` locally is the only CI you have** — run it before every
commit.
