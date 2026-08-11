/**
 * The v1 schema, implementing docs/DATA-MODEL.md.
 *
 * Two conventions carry most of the correctness burden:
 *
 *  1. Every tenant-owned table carries `businessId`, and every index on it
 *     STARTS with `businessId`. A query that forgets tenancy then has no index
 *     to use — the mistake becomes a performance cliff rather than a silent
 *     data leak. (ADR-0002)
 *
 *  2. Money is an integer in the currency's minor unit, named `…Minor`. Tax
 *     rates are basis points. There is no float money in this system.
 *     (docs/RISKS.md R8)
 *
 * Tables marked "Phase N" are defined now because retrofitting a column onto a
 * table holding a year of sales is expensive, while an unused table costs
 * nothing.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ─────────────────────────── shared value shapes ─────────────────────────── */

const branding = v.object({
  logoStorageId: v.optional(v.id("_storage")),
  primaryColor: v.string(),
  secondaryColor: v.string(),
  receiptHeader: v.optional(v.string()),
  receiptFooter: v.optional(v.string()),
});

const businessSettings = v.object({
  taxInclusivePricing: v.boolean(),
  defaultTaxRateId: v.optional(v.id("taxRates")),
  /** Cap on a discount a cashier may apply without approval, in basis points. */
  maxCashierDiscountBasisPoints: v.number(),
  /** Order value above which any discount needs a manager. */
  requireApprovalAboveMinor: v.number(),
  receiptPrefix: v.string(),
  lowStockDefaultThreshold: v.number(),
  /** Some shops legitimately sell ahead of a stock delivery. Off by default. */
  negativeStockAllowed: v.boolean(),
});

const businessType = v.union(
  v.literal("retail"),
  v.literal("supermarket"),
  v.literal("restaurant"),
  v.literal("pharmacy"),
  v.literal("salon"),
  v.literal("hardware"),
  v.literal("wholesale"),
  v.literal("other"),
);

const productUnit = v.union(
  v.literal("piece"),
  v.literal("kg"),
  v.literal("litre"),
  v.literal("packet"),
  v.literal("box"),
  v.literal("service"),
);

const paymentMethod = v.union(
  v.literal("cash"),
  v.literal("mpesa"),
  v.literal("airtel"),
  v.literal("card"),
  v.literal("bank"),
  v.literal("credit"),
);

const paymentStatus = v.union(
  v.literal("pending"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("timeout"),
  v.literal("reversed"),
);

const stockMovementType = v.union(
  v.literal("sale"),
  v.literal("refund"),
  v.literal("purchase"),
  v.literal("adjustment"),
  v.literal("transfer_in"),
  v.literal("transfer_out"),
  v.literal("waste"),
  v.literal("opening"),
);

export default defineSchema({
  /* ══════════════════════ identity and tenancy ══════════════════════ */

  /** The only table that is not tenant-scoped: a person, who may work at several businesses. */
  users: defineTable({
    authSubject: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    defaultBusinessId: v.optional(v.id("businesses")),
    lastLoginAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("suspended")),
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email", ["email"])
    .index("by_phone", ["phone"]),

  businesses: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerUserId: v.id("users"),
    businessType,
    country: v.string(),
    currency: v.string(),
    timezone: v.string(),
    locale: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    city: v.optional(v.string()),
    branding,
    settings: businessSettings,
    status: v.union(
      v.literal("onboarding"),
      v.literal("active"),
      v.literal("suspended"),
      v.literal("cancelled"),
    ),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerUserId"]),

  /**
   * The tenancy edge, and the authorization anchor. Server-side context
   * resolution reads exactly one of these per request; everything downstream
   * inherits its businessId.
   */
  memberships: defineTable({
    userId: v.id("users"),
    businessId: v.id("businesses"),
    roleId: v.id("roles"),
    employeeCode: v.optional(v.string()),
    status: v.union(v.literal("invited"), v.literal("active"), v.literal("suspended")),
    invitedByUserId: v.optional(v.id("users")),
    /** Argon2id. A convenience layer inside an authenticated session, never a substitute for one. */
    pinHash: v.optional(v.string()),
    lastActiveAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_user", ["userId"])
    .index("by_business_and_user", ["businessId", "userId"])
    .index("by_business_and_status", ["businessId", "status"]),

  /** `businessId` is undefined for the system role templates seeded at onboarding. */
  roles: defineTable({
    businessId: v.optional(v.id("businesses")),
    key: v.string(),
    name: v.string(),
    permissions: v.array(v.string()),
    isSystem: v.boolean(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_key", ["businessId", "key"]),

  subscriptions: defineTable({
    businessId: v.id("businesses"),
    plan: v.union(v.literal("starter"), v.literal("business"), v.literal("enterprise")),
    model: v.union(v.literal("monthly"), v.literal("annual"), v.literal("lifetime")),
    status: v.union(
      v.literal("trialing"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    priceMinor: v.number(),
    currency: v.string(),
    provider: v.optional(v.string()),
    providerRef: v.optional(v.string()),
    /** Lifetime licences still carry an annual maintenance fee (requirement 3.3). */
    maintenanceDueAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_status_and_period_end", ["status", "currentPeriodEnd"]),

  /* ══════════════════════════ catalogue ══════════════════════════ */

  /** Multi-branch is Phase 7, but sales and stock reference a location from v1. */
  locations: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    type: v.union(v.literal("store"), v.literal("warehouse")),
    addressLine: v.optional(v.string()),
    isDefault: v.boolean(),
    isActive: v.boolean(),
  }).index("by_business", ["businessId"]),

  categories: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    parentId: v.optional(v.id("categories")),
    sortOrder: v.number(),
    isActive: v.boolean(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_parent", ["businessId", "parentId"]),

  products: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    sku: v.string(),
    barcode: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    description: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    unit: productUnit,
    /** Financial data: stripped at the repository for sessions without reports:financial:read. */
    costPriceMinor: v.number(),
    sellingPriceMinor: v.number(),
    currency: v.string(),
    taxRateId: v.optional(v.id("taxRates")),
    /** False for services — a salon haircut has no stock level. */
    trackInventory: v.boolean(),
    lowStockThreshold: v.optional(v.number()),
    isActive: v.boolean(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_sku", ["businessId", "sku"])
    .index("by_business_and_barcode", ["businessId", "barcode"])
    .index("by_business_and_category", ["businessId", "categoryId"])
    .index("by_business_and_active", ["businessId", "isActive"])
    // The till's search path. Filtered by businessId so it cannot cross tenants.
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["businessId", "isActive"],
    }),

  taxRates: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    /** Basis points: 1600 = 16%. Kenya's VAT must be exactly representable. */
    rateBasisPoints: v.number(),
    isInclusive: v.boolean(),
    isDefault: v.boolean(),
    isActive: v.boolean(),
  }).index("by_business", ["businessId"]),

  suppliers: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressLine: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_active", ["businessId", "isActive"]),

  /* ══════════════════════════ inventory ══════════════════════════ */

  /**
   * The fast current-quantity projection. One document per product per
   * location — deliberately not one aggregate per business, which would
   * serialise every sale in the shop under Convex's optimistic concurrency
   * and produce retry storms at peak. (docs/RISKS.md R4)
   */
  inventoryLevels: defineTable({
    businessId: v.id("businesses"),
    locationId: v.id("locations"),
    productId: v.id("products"),
    quantity: v.number(),
    reservedQuantity: v.number(),
    /**
     * The effective threshold, denormalised from the product (or the business
     * default) when this row is written.
     *
     * Denormalised so that "what is low right now" is an indexed lookup rather
     * than a scan that reads every product document to compare against its own
     * threshold — that fan-out is what makes a low-stock dashboard widget
     * quietly cost thousands of reads per page load.
     */
    lowStockThreshold: v.number(),
    isLowStock: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_business_and_location_and_product", [
      "businessId",
      "locationId",
      "productId",
    ])
    .index("by_business_and_product", ["businessId", "productId"])
    .index("by_business_and_low_stock", ["businessId", "isLowStock"]),

  /** Append-only ledger. Never updated, never deleted; corrections are compensating rows. */
  stockMovements: defineTable({
    businessId: v.id("businesses"),
    locationId: v.id("locations"),
    productId: v.id("products"),
    type: stockMovementType,
    /** Signed. Sales are negative. */
    quantityDelta: v.number(),
    /** Snapshot, so an audit does not require replaying the whole ledger. */
    balanceAfter: v.number(),
    unitCostMinor: v.optional(v.number()),
    reason: v.optional(v.string()),
    referenceType: v.optional(v.string()),
    referenceId: v.optional(v.string()),
    actorUserId: v.id("users"),
  })
    .index("by_business_and_product_and_time", ["businessId", "productId"])
    .index("by_business", ["businessId"])
    .index("by_business_and_reference", ["businessId", "referenceType", "referenceId"]),

  /** Phase 7 UI; present now so AI reorder recommendations have somewhere to propose into. */
  purchaseOrders: defineTable({
    businessId: v.id("businesses"),
    supplierId: v.id("suppliers"),
    number: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("partially_received"),
      v.literal("received"),
      v.literal("cancelled"),
    ),
    expectedAt: v.optional(v.number()),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        unitCostMinor: v.number(),
      }),
    ),
    totalMinor: v.number(),
    currency: v.string(),
    receivedAt: v.optional(v.number()),
    createdByUserId: v.id("users"),
  })
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_business_and_supplier", ["businessId", "supplierId"]),

  /* ════════════════════════════ sales ════════════════════════════ */

  sales: defineTable({
    businessId: v.id("businesses"),
    locationId: v.id("locations"),
    number: v.string(),
    /**
     * Client-generated UUID — the idempotency key. An offline replay or a
     * double-tapped Pay button cannot create two sales, because this is a
     * unique index rather than an application-level check. (ADR-0005)
     */
    clientRequestId: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("completed"),
      v.literal("voided"),
      v.literal("refunded"),
      v.literal("partially_refunded"),
    ),
    customerId: v.optional(v.id("customers")),
    cashierUserId: v.id("users"),
    shiftId: v.optional(v.id("shifts")),
    currency: v.string(),
    subtotalMinor: v.number(),
    discountTotalMinor: v.number(),
    taxTotalMinor: v.number(),
    totalMinor: v.number(),
    amountPaidMinor: v.number(),
    changeDueMinor: v.number(),
    /** COGS snapshot: makes profit reporting a read rather than a recomputation. */
    costTotalMinor: v.number(),
    discountApprovedByUserId: v.optional(v.id("users")),
    channel: v.union(v.literal("pos"), v.literal("offline_sync")),
    completedAt: v.optional(v.number()),
    deviceId: v.optional(v.string()),
  })
    .index("by_business_and_completed_at", ["businessId", "completedAt"])
    .index("by_business_and_number", ["businessId", "number"])
    .index("by_business_and_client_request_id", ["businessId", "clientRequestId"])
    .index("by_business_and_customer", ["businessId", "customerId"])
    .index("by_business_and_cashier", ["businessId", "cashierUserId"])
    .index("by_business_and_status", ["businessId", "status"]),

  /**
   * Every price, name and tax field is a snapshot. Joining live products at
   * report time would make historical receipts and margins drift whenever a
   * price changed.
   */
  saleLines: defineTable({
    businessId: v.id("businesses"),
    saleId: v.id("sales"),
    productId: v.id("products"),
    nameSnapshot: v.string(),
    skuSnapshot: v.string(),
    quantity: v.number(),
    unitPriceMinor: v.number(),
    costPriceMinor: v.number(),
    discountMinor: v.number(),
    taxRateBasisPoints: v.number(),
    taxInclusive: v.boolean(),
    taxAmountMinor: v.number(),
    lineTotalMinor: v.number(),
  })
    .index("by_sale", ["saleId"])
    .index("by_business_and_product", ["businessId", "productId"]),

  /** Separate documents, never mutations of the sale: the original stays immutable for audit. */
  refunds: defineTable({
    businessId: v.id("businesses"),
    saleId: v.id("sales"),
    number: v.string(),
    lines: v.array(
      v.object({
        saleLineId: v.id("saleLines"),
        quantity: v.number(),
        amountMinor: v.number(),
      }),
    ),
    reason: v.string(),
    totalMinor: v.number(),
    restockInventory: v.boolean(),
    approvedByUserId: v.id("users"),
    paymentMethod,
  })
    .index("by_business_and_sale", ["businessId", "saleId"])
    .index("by_business", ["businessId"]),

  /** A sale has many payments: split tender (part cash, part M-Pesa) is normal here. */
  payments: defineTable({
    businessId: v.id("businesses"),
    saleId: v.optional(v.id("sales")),
    method: paymentMethod,
    provider: v.optional(v.string()),
    amountMinor: v.number(),
    currency: v.string(),
    status: paymentStatus,
    idempotencyKey: v.string(),
    /** M-Pesa CheckoutRequestID. */
    providerRef: v.optional(v.string()),
    /** M-Pesa receipt number, printed on the customer's receipt. */
    providerReceipt: v.optional(v.string()),
    payerPhone: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
    initiatedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    reconciledAt: v.optional(v.number()),
  })
    .index("by_business_and_sale", ["businessId", "saleId"])
    .index("by_provider_ref", ["providerRef"])
    .index("by_business_and_idempotency_key", ["businessId", "idempotencyKey"])
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_business_and_settled_at", ["businessId", "settledAt"]),

  /**
   * Raw provider callbacks, persisted before parsing.
   *
   * `by_provider_and_external_id` IS the duplicate-callback defence: a
   * duplicate racing an in-flight callback loses at the database rather than
   * in an `if`, which is the race that fires precisely during a provider retry
   * storm. (ADR-0003)
   */
  paymentEvents: defineTable({
    paymentId: v.optional(v.id("payments")),
    provider: v.string(),
    eventType: v.string(),
    externalId: v.string(),
    payloadHash: v.string(),
    payload: v.string(),
    signatureValid: v.boolean(),
    processedAt: v.optional(v.number()),
    receivedAt: v.number(),
    sourceIp: v.optional(v.string()),
  })
    .index("by_provider_and_external_id", ["provider", "externalId"])
    .index("by_payment", ["paymentId"])
    .index("by_provider_and_received_at", ["provider", "receivedAt"]),

  /** Cash reconciliation at shift close is how a shop actually detects till shrinkage. */
  shifts: defineTable({
    businessId: v.id("businesses"),
    locationId: v.id("locations"),
    userId: v.id("users"),
    openedAt: v.number(),
    openingFloatMinor: v.number(),
    closedAt: v.optional(v.number()),
    countedCashMinor: v.optional(v.number()),
    expectedCashMinor: v.optional(v.number()),
    varianceMinor: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_business_and_location", ["businessId", "locationId"])
    .index("by_business_and_user", ["businessId", "userId"]),

  /* ═══════════════════════════ customers ═══════════════════════════ */

  customers: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    /** The practical identifier in this market — not email. */
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    group: v.optional(v.string()),
    loyaltyPoints: v.number(),
    totalSpendMinor: v.number(),
    purchaseCount: v.number(),
    lastPurchaseAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    isActive: v.boolean(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_phone", ["businessId", "phone"])
    .index("by_business_and_last_purchase", ["businessId", "lastPurchaseAt"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: ["businessId"],
    }),

  /* ═══════════════════════ platform operations ═══════════════════════ */

  /** Append-only, written in the same transaction as the action it records. */
  auditLogs: defineTable({
    businessId: v.id("businesses"),
    actorUserId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_entity", ["businessId", "entityType", "entityId"])
    .index("by_business_and_actor", ["businessId", "actorUserId"])
    .index("by_business_and_action", ["businessId", "action"]),

  notifications: defineTable({
    businessId: v.id("businesses"),
    /** Undefined targets the whole business rather than one user. */
    userId: v.optional(v.id("users")),
    type: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    title: v.string(),
    body: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    readAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_business_and_user", ["businessId", "userId"]),

  aiConversations: defineTable({
    businessId: v.id("businesses"),
    userId: v.id("users"),
    title: v.string(),
    lastMessageAt: v.number(),
  })
    .index("by_business_and_user", ["businessId", "userId"])
    .index("by_business", ["businessId"]),

  /**
   * `toolCalls` and `toolResults` are what make an AI answer auditable: every
   * figure the assistant states can be traced to the tool result that produced
   * it. Token counts drive per-tenant cost attribution. (ADR-0004)
   */
  aiMessages: defineTable({
    businessId: v.id("businesses"),
    conversationId: v.id("aiConversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("tool")),
    content: v.string(),
    toolCalls: v.optional(v.any()),
    toolResults: v.optional(v.any()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_business", ["businessId"]),

  /** Generated by scheduled jobs — dashboards must never block on a model call. */
  aiInsights: defineTable({
    businessId: v.id("businesses"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
    confidence: v.optional(v.number()),
    periodStart: v.number(),
    periodEnd: v.number(),
    generatedAt: v.number(),
    dismissedAt: v.optional(v.number()),
    actedOnAt: v.optional(v.number()),
  })
    .index("by_business_and_generated", ["businessId", "generatedAt"])
    .index("by_business_and_type", ["businessId", "type"]),
});
