# Data Model

**Store:** Convex (document database, ACID mutations, reactive queries)
**Status:** Proposed (Phase 1 deliverable)

Conventions used throughout:

- Every tenant-owned table carries **`businessId`** and every index on it
  **starts with `businessId`**. There are no non-tenant-prefixed indexes on
  tenant data.
- Money is an **integer in the currency's minor unit** (`priceMinor: 1999` =
  19.99). Never a float. Currency is stored next to the amount.
- Timestamps are epoch milliseconds (`number`), UTC. Business-local day
  boundaries are computed from `business.timezone` at query time — a
  "today's sales" figure that silently uses UTC is wrong for every business in
  East Africa.
- `_id` and `_creationTime` are Convex built-ins and are not re-declared.
- Deletion is soft (`isActive`, `deletedAt`) for anything a sale can reference.
  A product referenced by a sale line from three months ago must remain
  resolvable.

---

## 1. Entity relationship overview

```
                          ┌──────────┐
                          │  users   │  (platform identity, from Clerk)
                          └────┬─────┘
                               │
                        ┌──────┴───────┐
                        │ memberships  │──────┐
                        └──────┬───────┘      │
                               │              ▼
                               │          ┌────────┐
                               │          │ roles  │──▶ permissions[]
                               │          └────────┘
                               ▼
                       ┌───────────────┐
                       │  businesses   │◀── subscriptions
                       └───────┬───────┘
                               │  (businessId on everything below)
   ┌───────────┬───────────┬───┴────┬───────────┬────────────┬──────────┐
   ▼           ▼           ▼        ▼           ▼            ▼          ▼
locations  categories  products  customers  suppliers   taxRates    shifts
                          │
              ┌───────────┼────────────┐
              ▼           ▼            ▼
      inventoryLevels  stockMovements  saleLines
              ▲              ▲            │
              │              │            ▼
              └──────────────┴────────  sales ──┬── payments ──< paymentEvents
                                                 │
                                                 └── refunds

   auditLogs · notifications · aiConversations/aiMessages · aiInsights
   (all tenant-scoped, all reference businessId)
```

---

## 2. Identity and tenancy

### `users` — a person, platform-level

The only table that is not tenant-scoped. A person may belong to several
businesses.

| Field               | Type                      | Notes                                                    |
| ------------------- | ------------------------- | -------------------------------------------------------- |
| `authSubject`       | `string`                  | Clerk user id. Unique. The join to the identity provider |
| `email`             | `string?`                 | Optional — phone-only accounts are common in this market |
| `phone`             | `string?`                 | E.164                                                    |
| `name`              | `string`                  |                                                          |
| `avatarUrl`         | `string?`                 |                                                          |
| `defaultBusinessId` | `Id<"businesses">?`       | Where to land after login                                |
| `lastLoginAt`       | `number?`                 |                                                          |
| `status`            | `"active" \| "suspended"` |                                                          |

Indexes: `by_auth_subject`, `by_email`, `by_phone`.

### `businesses` — the tenant

| Field                                   | Type                                                                                                         | Notes                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                  | `string`                                                                                                     |                                                                                                                                                                                                                     |
| `slug`                                  | `string`                                                                                                     | Unique, URL-safe                                                                                                                                                                                                    |
| `ownerUserId`                           | `Id<"users">`                                                                                                |                                                                                                                                                                                                                     |
| `businessType`                          | `"retail" \| "supermarket" \| "restaurant" \| "pharmacy" \| "salon" \| "hardware" \| "wholesale" \| "other"` | Drives which industry module is enabled later                                                                                                                                                                       |
| `country`                               | `string`                                                                                                     | ISO-3166-1 alpha-2                                                                                                                                                                                                  |
| `currency`                              | `string`                                                                                                     | ISO-4217. Determines the minor-unit exponent                                                                                                                                                                        |
| `timezone`                              | `string`                                                                                                     | IANA, e.g. `Africa/Nairobi`                                                                                                                                                                                         |
| `locale`                                | `string`                                                                                                     | `en-KE`, `sw-KE`, …                                                                                                                                                                                                 |
| `phone`, `email`, `addressLine`, `city` | `string?`                                                                                                    | Printed on receipts                                                                                                                                                                                                 |
| `branding`                              | `object`                                                                                                     | `{ logoStorageId?, primaryColor, secondaryColor, receiptHeader?, receiptFooter? }`                                                                                                                                  |
| `settings`                              | `object`                                                                                                     | `{ taxInclusivePricing: boolean, defaultTaxRateId?, maxCashierDiscountPercent: number, requireApprovalAboveMinor: number, receiptPrefix: string, lowStockDefaultThreshold: number, negativeStockAllowed: boolean }` |
| `status`                                | `"onboarding" \| "active" \| "suspended" \| "cancelled"`                                                     |                                                                                                                                                                                                                     |

Indexes: `by_slug`, `by_owner`.

Branding and settings are nested objects rather than separate tables: they are
read on nearly every request, always as a unit, and never queried across
tenants. Splitting them would buy nothing and cost a join per page render.

### `memberships` — user × business, the tenancy edge

| Field             | Type                                   | Notes                                                                            |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `userId`          | `Id<"users">`                          |                                                                                  |
| `businessId`      | `Id<"businesses">`                     |                                                                                  |
| `roleId`          | `Id<"roles">`                          |                                                                                  |
| `employeeCode`    | `string?`                              | Staff number shown on receipts                                                   |
| `status`          | `"invited" \| "active" \| "suspended"` |                                                                                  |
| `invitedByUserId` | `Id<"users">?`                         |                                                                                  |
| `pinHash`         | `string?`                              | Optional short PIN for fast terminal switching (Argon2id). Never a plaintext PIN |
| `lastActiveAt`    | `number?`                              |                                                                                  |

Indexes: `by_business`, `by_user`, `by_business_and_user` (unique),
`by_business_and_status`.

This table _is_ the authorization anchor. Server-side context resolution reads
exactly one membership per request, and everything downstream inherits its
`businessId`.

### `roles` and permissions

| Field         | Type                                          | Notes                                    |
| ------------- | --------------------------------------------- | ---------------------------------------- |
| `businessId`  | `Id<"businesses">?`                           | `null` = system template role            |
| `key`         | `"owner" \| "manager" \| "cashier" \| string` |                                          |
| `name`        | `string`                                      | Display name, business-editable          |
| `permissions` | `string[]`                                    | e.g. `["sales:create", "products:read"]` |
| `isSystem`    | `boolean`                                     | System roles cannot be deleted           |

Indexes: `by_business`, `by_business_and_key`.

Permissions are strings from a single exported union in
`src/lib/auth/permissions.ts`, so a typo is a compile error rather than a
silent grant. The full matrix is in [`ARCHITECTURE.md` §6](ARCHITECTURE.md).

### `subscriptions` — SaaS billing

| Field                                     | Type                                                               | Notes                                             |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| `businessId`                              | `Id<"businesses">`                                                 |                                                   |
| `plan`                                    | `"starter" \| "business" \| "enterprise"`                          |                                                   |
| `model`                                   | `"monthly" \| "annual" \| "lifetime"`                              | Requirement 3 covers all three                    |
| `status`                                  | `"trialing" \| "active" \| "past_due" \| "cancelled" \| "expired"` |                                                   |
| `currentPeriodStart` / `currentPeriodEnd` | `number`                                                           |                                                   |
| `priceMinor`, `currency`                  | `number`, `string`                                                 |                                                   |
| `provider`, `providerRef`                 | `string?`                                                          | Reuses the payment provider abstraction           |
| `maintenanceDueAt`                        | `number?`                                                          | Lifetime licences carry an annual maintenance fee |

Indexes: `by_business`, `by_status_and_period_end` (for the renewal job).

---

## 3. Catalogue

### `locations`

Single default location is auto-created at onboarding; the table exists from v1
so that multi-branch (Phase 7) does not require a migration of every inventory
and sale row.

`businessId`, `name`, `type: "store" | "warehouse"`, `addressLine?`,
`isDefault`, `isActive`. Index: `by_business`.

### `categories`

`businessId`, `name`, `parentId: Id<"categories">?`, `sortOrder`, `isActive`.
Indexes: `by_business`, `by_business_and_parent`.

### `products`

| Field               | Type                                                           | Notes                                                                       |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `businessId`        | `Id<"businesses">`                                             |                                                                             |
| `name`              | `string`                                                       |                                                                             |
| `sku`               | `string`                                                       | Unique per business                                                         |
| `barcode`           | `string?`                                                      | Unique per business when present. Scanner lookup path                       |
| `categoryId`        | `Id<"categories">?`                                            |                                                                             |
| `description`       | `string?`                                                      |                                                                             |
| `imageStorageId`    | `string?`                                                      | Convex file storage                                                         |
| `unit`              | `"piece" \| "kg" \| "litre" \| "packet" \| "box" \| "service"` | `kg` enables the weighing-scale path later                                  |
| `costPriceMinor`    | `number`                                                       | **Financial data.** Stripped from payloads without `reports:financial:read` |
| `sellingPriceMinor` | `number`                                                       |                                                                             |
| `currency`          | `string`                                                       | Denormalised from business for correctness of historical reads              |
| `taxRateId`         | `Id<"taxRates">?`                                              | Falls back to the business default                                          |
| `trackInventory`    | `boolean`                                                      | `false` for services (salon, repairs)                                       |
| `lowStockThreshold` | `number?`                                                      | Overrides the business default                                              |
| `isActive`          | `boolean`                                                      | Soft delete                                                                 |

Indexes: `by_business`, `by_business_and_sku` (unique),
`by_business_and_barcode` (unique), `by_business_and_category`,
`by_business_and_active`. Search index `search_products` on `name` filtered by
`businessId` — POS product search must be sub-100ms.

Variants (size/colour) are **not** in v1. The seam: a future `productVariants`
table keyed by `productId`, with `saleLines.variantId` optional. Sale lines
already snapshot price and name, so adding variants does not rewrite history.

### `taxRates`

`businessId`, `name` (e.g. "VAT 16%"), `rateBasisPoints` (`1600` = 16% —
integer, same reasoning as money), `isInclusive`, `isDefault`, `isActive`.
Index: `by_business`.

Kenya's VAT is 16% and commonly quoted tax-inclusive, while some sectors quote
exclusive. Both must be exactly representable, which is why the rate is basis
points rather than a float.

### `suppliers`

`businessId`, `name`, `contactName?`, `phone?`, `email?`, `addressLine?`,
`notes?`, `isActive`. Indexes: `by_business`, `by_business_and_active`.

---

## 4. Inventory

Inventory uses a **ledger plus a projection**: `stockMovements` is the
append-only truth, `inventoryLevels` is the fast current-quantity read. Both are
written in the same transaction, so they cannot disagree; a nightly job
re-derives levels from the ledger and raises a notification on any drift.

### `inventoryLevels`

| Field                                   | Type     | Notes                     |
| --------------------------------------- | -------- | ------------------------- |
| `businessId`, `locationId`, `productId` | ids      |                           |
| `quantity`                              | `number` | Current on-hand           |
| `reservedQuantity`                      | `number` | Held by in-progress sales |
| `updatedAt`                             | `number` |                           |

Indexes: `by_business_and_location_and_product` (unique),
`by_business_and_product`, `by_business_and_low_stock`.

One document per product per location — deliberately _not_ one aggregate
document per business. Convex uses optimistic concurrency; a single hot
document would serialise every sale in the shop and produce retry storms at the
till. Per-product documents mean two cashiers selling different products never
contend.

### `stockMovements` — append-only ledger

| Field                                   | Type                                                                                                          | Notes                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `businessId`, `locationId`, `productId` | ids                                                                                                           |                                                 |
| `type`                                  | `"sale" \| "refund" \| "purchase" \| "adjustment" \| "transfer_in" \| "transfer_out" \| "waste" \| "opening"` |                                                 |
| `quantityDelta`                         | `number`                                                                                                      | Signed. Sales are negative                      |
| `balanceAfter`                          | `number`                                                                                                      | Snapshot for audit without replaying the ledger |
| `unitCostMinor`                         | `number?`                                                                                                     | For COGS and margin                             |
| `reason`                                | `string?`                                                                                                     | Required for `adjustment` and `waste`           |
| `referenceType` / `referenceId`         | `string?`                                                                                                     | `"sale"` → sale id, etc.                        |
| `actorUserId`                           | `Id<"users">`                                                                                                 |                                                 |

Indexes: `by_business_and_product_and_time`, `by_business_and_time`,
`by_business_and_reference`.

Never updated, never deleted. Corrections are new compensating movements —
which is what makes wastage and shrinkage reports (requirement 12) truthful.

### `purchaseOrders` (schema in v1, UI in Phase 7)

`businessId`, `supplierId`, `number`, `status`, `expectedAt?`, `lines[]`
(`{ productId, quantity, unitCostMinor }`), `totalMinor`, `currency`,
`receivedAt?`, `createdByUserId`. Index: `by_business_and_status`.

Present in the schema because AI reorder recommendations (Phase 6) need
somewhere to propose _into_, and because receiving stock is the natural source
of `purchase` movements.

---

## 5. Sales

### `sales`

| Field                      | Type                                                                       | Notes                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `businessId`, `locationId` | ids                                                                        |                                                                                                                               |
| `number`                   | `string`                                                                   | Human-facing receipt number, per-business sequence                                                                            |
| `clientRequestId`          | `string`                                                                   | **Client-generated UUID. Unique per business. The idempotency key** — an offline replay or double-tap cannot create two sales |
| `status`                   | `"draft" \| "completed" \| "voided" \| "refunded" \| "partially_refunded"` |                                                                                                                               |
| `customerId`               | `Id<"customers">?`                                                         | Walk-in sales have none                                                                                                       |
| `cashierUserId`            | `Id<"users">`                                                              |                                                                                                                               |
| `shiftId`                  | `Id<"shifts">?`                                                            |                                                                                                                               |
| `currency`                 | `string`                                                                   |                                                                                                                               |
| `subtotalMinor`            | `number`                                                                   | Sum of line totals before order discount                                                                                      |
| `discountTotalMinor`       | `number`                                                                   |                                                                                                                               |
| `taxTotalMinor`            | `number`                                                                   |                                                                                                                               |
| `totalMinor`               | `number`                                                                   |                                                                                                                               |
| `amountPaidMinor`          | `number`                                                                   |                                                                                                                               |
| `changeDueMinor`           | `number`                                                                   |                                                                                                                               |
| `costTotalMinor`           | `number`                                                                   | COGS snapshot — makes profit reporting a read, not a recomputation over historical prices                                     |
| `discountApprovedByUserId` | `Id<"users">?`                                                             | Set when a discount exceeded the cashier's cap                                                                                |
| `channel`                  | `"pos" \| "offline_sync"`                                                  |                                                                                                                               |
| `completedAt`              | `number?`                                                                  |                                                                                                                               |
| `deviceId`                 | `string?`                                                                  | Which terminal                                                                                                                |

Indexes: `by_business_and_completed_at`, `by_business_and_number` (unique),
`by_business_and_client_request_id` (unique), `by_business_and_customer`,
`by_business_and_cashier`, `by_business_and_status`.

### `saleLines`

| Field                                | Type                | Notes                                                                      |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------------- |
| `businessId`, `saleId`, `productId`  | ids                 |                                                                            |
| `nameSnapshot`, `skuSnapshot`        | `string`            | Receipts must reprint identically in a year, after the product was renamed |
| `quantity`                           | `number`            |                                                                            |
| `unitPriceMinor`                     | `number`            | Snapshot                                                                   |
| `costPriceMinor`                     | `number`            | Snapshot at time of sale                                                   |
| `discountMinor`                      | `number`            |                                                                            |
| `taxRateBasisPoints`, `taxInclusive` | `number`, `boolean` | Snapshot — a VAT change must not alter last year's receipts                |
| `taxAmountMinor`                     | `number`            |                                                                            |
| `lineTotalMinor`                     | `number`            |                                                                            |

Indexes: `by_sale`, `by_business_and_product` (product performance reporting).

Snapshotting is the point of this table. Joining live products at report time
would make historical receipts and margins drift whenever a price changes.

### `refunds`

`businessId`, `saleId`, `number`, `lines[]`
(`{ saleLineId, quantity, amountMinor }`), `reason`, `totalMinor`,
`restockInventory: boolean`, `approvedByUserId`, `paymentMethod`,
`createdAt`. Indexes: `by_business_and_sale`, `by_business_and_time`.

Refunds are separate documents, never mutations of the original sale: the
original must stay immutable for audit, and a partial refund needs its own
approver and reason.

### `payments`

| Field                           | Type                                                                             | Notes                                         |
| ------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| `businessId`, `saleId`          | ids                                                                              | `saleId` optional for subscription payments   |
| `method`                        | `"cash" \| "mpesa" \| "airtel" \| "card" \| "bank" \| "credit"`                  |                                               |
| `provider`                      | `string?`                                                                        | `"daraja"`, …                                 |
| `amountMinor`, `currency`       | `number`, `string`                                                               |                                               |
| `status`                        | `"pending" \| "succeeded" \| "failed" \| "cancelled" \| "timeout" \| "reversed"` |                                               |
| `idempotencyKey`                | `string`                                                                         | Unique per business                           |
| `providerRef`                   | `string?`                                                                        | M-Pesa `CheckoutRequestID`                    |
| `providerReceipt`               | `string?`                                                                        | M-Pesa receipt number, printed on the receipt |
| `payerPhone`                    | `string?`                                                                        |                                               |
| `failureCode`, `failureMessage` | `string?`                                                                        | Provider-normalised                           |
| `initiatedAt`, `settledAt`      | `number?`                                                                        |                                               |
| `reconciledAt`                  | `number?`                                                                        | Set by the daily reconciliation job           |

Indexes: `by_business_and_sale`, `by_provider_ref` (callback lookup),
`by_business_and_idempotency_key` (unique), `by_business_and_status`
(finds stuck payments), `by_business_and_settled_at`.

A sale has _many_ payments — split tender (part cash, part M-Pesa) is normal in
this market, so a single `paymentMethod` column on `sales` would have been
wrong from day one.

### `paymentEvents` — raw provider callbacks

`paymentId?`, `provider`, `eventType`, `externalId`, `payloadHash`, `payload`,
`signatureValid: boolean`, `processedAt?`, `receivedAt`, `sourceIp?`.

Indexes: **`by_provider_and_external_id` (unique — this index _is_ the
duplicate-callback defence)**, `by_payment`, `by_provider_and_received_at`.

The raw body is persisted before parsing, so a malformed or unexpected callback
is diagnosable rather than lost. Access is permission-gated; these payloads
contain customer phone numbers.

### `shifts` — register sessions

`businessId`, `locationId`, `userId`, `openedAt`, `openingFloatMinor`,
`closedAt?`, `countedCashMinor?`, `expectedCashMinor?`, `varianceMinor?`,
`notes?`. Indexes: `by_business_and_location_and_open`, `by_business_and_user`.

Cash reconciliation at shift close is how a shop actually detects till
shrinkage. It is cheap to include now and awkward to retrofit.

---

## 6. Customers

### `customers`

`businessId`, `name`, `phone?`, `email?`, `group?`, `loyaltyPoints`,
`totalSpendMinor`, `purchaseCount`, `lastPurchaseAt?`, `notes?`, `isActive`.

Indexes: `by_business`, `by_business_and_phone` (unique when present),
`by_business_and_last_purchase`. Search index on `name`.

Phone is the practical identifier in this market, not email. Loyalty points
exist as a counter in v1 (earned, displayed) with the redemption ledger
deferred — the field is there so history is not lost when the ledger arrives.

---

## 7. Platform operations

### `auditLogs`

`businessId`, `actorUserId?`, `action`, `entityType`, `entityId?`,
`metadata: object`, `ipAddress?`, `userAgent?`, `createdAt`.

Indexes: `by_business_and_time`, `by_business_and_entity`,
`by_business_and_actor`, `by_business_and_action`.

Append-only. Written in the same transaction as the audited action.
`metadata` is redacted of PII and never contains full payment payloads.
Retention/archival policy is a Phase 7 item — this table grows fastest.

### `notifications`

`businessId`, `userId?` (null = whole business), `type`
(`"low_stock" | "payment_failed" | "sales_spike" | "shift_variance" |
"ai_insight" | "subscription"`), `severity`, `title`, `body`, `entityType?`,
`entityId?`, `readAt?`, `createdAt`. Indexes: `by_business_and_created`,
`by_business_and_user_and_unread`.

### `aiConversations` / `aiMessages`

Conversations: `businessId`, `userId`, `title`, `lastMessageAt`.

Messages: `businessId`, `conversationId`, `role`
(`"user" | "assistant" | "tool"`), `content`, `toolCalls?`, `toolResults?`,
`provider`, `model`, `tokensIn`, `tokensOut`, `latencyMs`, `createdAt`.

Indexes: `by_conversation_and_time`, `by_business_and_user`.

Persisting `toolCalls` and `toolResults` is what makes an AI answer auditable:
every figure the assistant states can be traced to the tool result that
produced it. Token counts drive per-tenant AI cost attribution, which the
subscription tiers will need.

### `aiInsights`

`businessId`, `type` (`"low_stock_forecast" | "sales_trend" | "anomaly" |
"recommendation" | "reorder"`), `title`, `body`, `data: object`,
`confidence?`, `periodStart`, `periodEnd`, `generatedAt`, `dismissedAt?`,
`actedOnAt?`. Indexes: `by_business_and_generated`, `by_business_and_type`.

Generated by scheduled jobs, not on page load — dashboards must not block on a
model call, and insights must be identical for every viewer.

---

## 8. Invariants

These hold at all times and are asserted by tests:

1. `sum(stockMovements.quantityDelta)` per (product, location) equals
   `inventoryLevels.quantity`.
2. `sale.totalMinor == subtotalMinor − discountTotalMinor + taxTotalMinor`
   (exclusive tax), and every `saleLine.lineTotalMinor` is internally
   consistent with its quantity, price, discount and tax snapshot.
3. A `completed` sale has `sum(payments.amountMinor where status=succeeded) >=
totalMinor`.
4. `clientRequestId` is unique per business — replays are idempotent.
5. `(provider, externalId)` is unique in `paymentEvents` — duplicate callbacks
   are recorded once and processed once.
6. Every tenant-scoped document has a `businessId` matching the authenticated
   context that wrote it.
7. Audit entries exist for every mutating action in the audited set, in the
   same transaction as the action.
8. No monetary field is ever a non-integer.

---

## 9. Seed data

Development seeds a realistic Kenyan retail tenant — "Amani Mart", KES,
`Africa/Nairobi`, 16% inclusive VAT — with ~120 products across typical
categories (maize flour, milk, bread, cooking oil, sugar, soap, airtime),
three staff accounts (owner/manager/cashier), ~40 customers, and 90 days of
sales with realistic weekday/weekend shape and a Saturday peak. Realistic
volume and shape matter: AI insight quality, trend charts and query performance
are all meaningless against ten toy rows.
