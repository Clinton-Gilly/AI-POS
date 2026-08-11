/**
 * Uniqueness in Convex.
 *
 * Convex has no unique indexes — `index()` takes no uniqueness option, and
 * nothing in the database rejects a second row with the same key. The
 * guarantee comes from the transaction model instead: Convex mutations run at
 * serializable isolation under optimistic concurrency control. A mutation that
 * reads "no row with this key exists" and then inserts one is safe, because a
 * concurrent mutation reading the same absence conflicts on commit and is
 * retried — and the retry re-reads, now finds the committed row, and takes the
 * other branch.
 *
 * This matters because the usual warning about read-then-write is correct
 * under weaker isolation (read committed, repeatable read), where the check
 * and the insert can interleave. Under serializable OCC they cannot. The
 * check-then-act shape below is the documented Convex approach, not a
 * shortcut around a missing constraint.
 *
 * Two consequences worth keeping in mind:
 *
 *  - The guarantee only holds *inside a mutation*. Reading in a query and
 *    writing in a later mutation is a different, unsafe shape — the read is
 *    not part of the writing transaction.
 *  - Under contention Convex retries, so these helpers must stay cheap and
 *    side-effect free. They only read.
 *
 * Corrects ADR-0003 and docs/DATA-MODEL.md, which described the mechanism as a
 * unique index. The guarantee is the same; the mechanism is not.
 */

import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "./errors";

/**
 * Throw DUPLICATE when a product in this business already uses `sku`.
 *
 * `excludeId` lets an update skip its own row.
 */
export async function assertSkuAvailable(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  sku: string,
  excludeId?: Id<"products">,
): Promise<void> {
  const existing = await ctx.db
    .query("products")
    .withIndex("by_business_and_sku", (q) =>
      q.eq("businessId", businessId).eq("sku", sku),
    )
    .first();

  if (existing && existing._id !== excludeId) {
    throw appError("DUPLICATE", `SKU "${sku}" is already used by another product.`);
  }
}

/**
 * Throw DUPLICATE when a product in this business already uses `barcode`.
 *
 * Scoped to the business: two different shops legitimately stock the same
 * physical product, so the same barcode across tenants is expected and must
 * not collide.
 */
export async function assertBarcodeAvailable(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  barcode: string,
  excludeId?: Id<"products">,
): Promise<void> {
  const existing = await ctx.db
    .query("products")
    .withIndex("by_business_and_barcode", (q) =>
      q.eq("businessId", businessId).eq("barcode", barcode),
    )
    .first();

  if (existing && existing._id !== excludeId) {
    throw appError(
      "DUPLICATE",
      `Barcode "${barcode}" is already used by another product.`,
    );
  }
}

/**
 * Find an existing row by a business-scoped natural key, for callers that want
 * idempotency rather than an error — the shape Phase 4 needs for a sale's
 * `clientRequestId` and a payment's `idempotencyKey`.
 */
export async function findExistingSaleByRequestId(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  clientRequestId: string,
): Promise<Doc<"sales"> | null> {
  return ctx.db
    .query("sales")
    .withIndex("by_business_and_client_request_id", (q) =>
      q.eq("businessId", businessId).eq("clientRequestId", clientRequestId),
    )
    .first();
}
