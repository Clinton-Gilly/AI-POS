/**
 * @vitest-environment edge-runtime
 *
 * Catalogue: uniqueness, search, and tenant isolation for every Phase 3 entity.
 *
 * The uniqueness tests matter more than they look. Convex has no unique
 * indexes — the guarantee comes from serializable transactions, so a
 * read-then-insert inside a mutation is correct. These assert the behaviour
 * that design claims, rather than trusting the reasoning.
 * See convex/lib/uniqueness.ts.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import { identity, seedBusiness, setup } from "./helpers";

let t: ReturnType<typeof setup>;
let amani: Awaited<ReturnType<typeof seedBusiness>>;
let jirani: Awaited<ReturnType<typeof seedBusiness>>;

beforeEach(async () => {
  t = setup();
  amani = await seedBusiness(t, "amani");
  jirani = await seedBusiness(t, "jirani", { currency: "UGX", country: "UG" });
});

const asOwner = () => t.withIdentity(identity(amani.ownerSubject, "Amani Owner"));
const asCashier = () => t.withIdentity(identity(amani.cashierSubject, "Amani Cashier"));
const asJiraniOwner = () =>
  t.withIdentity(identity(jirani.ownerSubject, "Jirani Owner"));

async function expectRejection(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(new RegExp(code));
}

const baseProduct = {
  name: "Maize Flour 2kg",
  sku: "MF-2KG",
  unit: "packet" as const,
  costPriceMinor: 17000,
  sellingPriceMinor: 21000,
};

describe("SKU and barcode uniqueness", () => {
  it("rejects a duplicate SKU within a business", async () => {
    await asOwner().mutation(api.products.create, baseProduct);
    await expectRejection(
      asOwner().mutation(api.products.create, { ...baseProduct, name: "Another" }),
      "DUPLICATE",
    );
  });

  it("rejects a duplicate barcode within a business", async () => {
    await asOwner().mutation(api.products.create, {
      ...baseProduct,
      barcode: "6161100010014",
    });
    await expectRejection(
      asOwner().mutation(api.products.create, {
        ...baseProduct,
        sku: "MF-1KG",
        barcode: "6161100010014",
      }),
      "DUPLICATE",
    );
  });

  it("allows the same SKU and barcode in a different business", async () => {
    // Two shops legitimately stock the same physical product. Uniqueness that
    // spanned tenants would make the second shop unable to list it.
    await asOwner().mutation(api.products.create, {
      ...baseProduct,
      barcode: "6161100010014",
    });

    const other = await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      barcode: "6161100010014",
    });
    expect(other.productId).toBeDefined();
  });

  it("lets a product keep its own SKU when updated", async () => {
    const { productId } = await asOwner().mutation(api.products.create, baseProduct);
    await asOwner().mutation(api.products.update, {
      productId,
      sku: "MF-2KG",
      name: "Maize Flour 2kg (Jogoo)",
    });

    const product = await asOwner().query(api.products.get, { productId });
    expect(product.name).toBe("Maize Flour 2kg (Jogoo)");
  });

  it("rejects an update that takes another product's SKU", async () => {
    await asOwner().mutation(api.products.create, baseProduct);
    const { productId } = await asOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "MK-500",
      name: "Milk 500ml",
    });

    await expectRejection(
      asOwner().mutation(api.products.update, { productId, sku: "MF-2KG" }),
      "DUPLICATE",
    );
  });

  it("normalises SKUs to upper case so case cannot smuggle a duplicate", async () => {
    await asOwner().mutation(api.products.create, baseProduct);
    await expectRejection(
      asOwner().mutation(api.products.create, {
        ...baseProduct,
        sku: "mf-2kg",
        name: "Sneaky",
      }),
      "DUPLICATE",
    );
  });
});

describe("product search", () => {
  beforeEach(async () => {
    await asOwner().mutation(api.products.create, {
      ...baseProduct,
      barcode: "6161100010014",
    });
    await asOwner().mutation(api.products.create, {
      name: "Milk 500ml",
      sku: "MK-500",
      barcode: "6161100020013",
      unit: "packet",
      costPriceMinor: 5500,
      sellingPriceMinor: 7000,
    });
    await asOwner().mutation(api.products.create, {
      name: "Maize Flour 1kg",
      sku: "MF-1KG",
      unit: "packet",
      costPriceMinor: 9000,
      sellingPriceMinor: 11500,
    });
  });

  it("returns exactly one product for a scanned barcode", async () => {
    // A scan must not be buried under fuzzy name matches.
    const results = await asCashier().query(api.products.search, {
      term: "6161100020013",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Milk 500ml");
  });

  it("returns exactly one product for an exact SKU", async () => {
    const results = await asCashier().query(api.products.search, { term: "MF-1KG" });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Maize Flour 1kg");
  });

  it("matches on name for a partial term", async () => {
    const results = await asCashier().query(api.products.search, { term: "Maize" });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.name.includes("Maize"))).toBe(true);
  });

  it("returns nothing for an empty term rather than the whole catalogue", async () => {
    expect(await asCashier().query(api.products.search, { term: "  " })).toEqual([]);
  });

  it("never returns another business's products", async () => {
    await asJiraniOwner().mutation(api.products.create, {
      name: "Maize Flour 2kg",
      sku: "JIRANI-MF",
      unit: "packet",
      costPriceMinor: 1,
      sellingPriceMinor: 2,
    });

    const results = await asCashier().query(api.products.search, { term: "Maize" });
    expect(results.every((r) => r.sku !== "JIRANI-MF")).toBe(true);
  });

  it("excludes deactivated products", async () => {
    const list = await asOwner().query(api.products.list, {});
    const milk = list.find((p) => p.sku === "MK-500")!;

    await asOwner().mutation(api.products.setActive, {
      productId: milk._id,
      isActive: false,
    });

    const results = await asCashier().query(api.products.search, { term: "Milk" });
    expect(results).toHaveLength(0);
  });
});

describe("cross-tenant isolation for catalogue entities", () => {
  it("refuses to read another business's product", async () => {
    const { productId } = await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "JIRANI-1",
    });

    await expectRejection(
      asOwner().query(api.products.get, { productId }),
      "NOT_FOUND",
    );
  });

  it("refuses to update another business's product", async () => {
    const { productId } = await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "JIRANI-2",
    });

    await expectRejection(
      asOwner().mutation(api.products.update, { productId, sellingPriceMinor: 1 }),
      "NOT_FOUND",
    );
  });

  it("refuses to adjust stock on another business's product", async () => {
    const { productId } = await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "JIRANI-3",
      openingQuantity: 50,
    });

    await expectRejection(
      asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -50,
        reason: "Theft",
      }),
      "NOT_FOUND",
    );

    // And the target is untouched.
    const levels = await asJiraniOwner().query(api.inventory.levels, {});
    expect(levels[0]!.quantity).toBe(50);
  });

  it("refuses to file a product under another business's category", async () => {
    const { categoryId } = await asJiraniOwner().mutation(api.categories.create, {
      name: "Jirani Category",
    });

    await expectRejection(
      asOwner().mutation(api.products.create, {
        ...baseProduct,
        sku: "MF-X",
        categoryId,
      }),
      "NOT_FOUND",
    );
  });

  it("refuses to read another business's stock history", async () => {
    const { productId } = await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "JIRANI-4",
      openingQuantity: 10,
    });

    await expectRejection(
      asOwner().query(api.inventory.history, { productId }),
      "NOT_FOUND",
    );
  });

  it("keeps supplier lists separate", async () => {
    await asOwner().mutation(api.suppliers.create, { name: "Nairobi Wholesalers" });
    await asJiraniOwner().mutation(api.suppliers.create, { name: "Kampala Traders" });

    const mine = await asOwner().query(api.suppliers.list, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]!.name).toBe("Nairobi Wholesalers");
  });

  it("refuses to update another business's supplier", async () => {
    const { supplierId } = await asJiraniOwner().mutation(api.suppliers.create, {
      name: "Kampala Traders",
    });

    await expectRejection(
      asOwner().mutation(api.suppliers.update, { supplierId, name: "Hijacked" }),
      "NOT_FOUND",
    );
  });

  it("keeps inventory levels separate", async () => {
    await asOwner().mutation(api.products.create, {
      ...baseProduct,
      openingQuantity: 10,
    });
    await asJiraniOwner().mutation(api.products.create, {
      ...baseProduct,
      sku: "JIRANI-5",
      openingQuantity: 99,
    });

    const mine = await asOwner().query(api.inventory.levels, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]!.quantity).toBe(10);
  });
});

describe("categories", () => {
  it("allows one level of nesting and refuses two", async () => {
    const { categoryId: parent } = await asOwner().mutation(api.categories.create, {
      name: "Groceries",
    });
    const { categoryId: child } = await asOwner().mutation(api.categories.create, {
      name: "Flour",
      parentId: parent,
    });

    await expectRejection(
      asOwner().mutation(api.categories.create, {
        name: "Maize Flour",
        parentId: child,
      }),
      "VALIDATION",
    );
  });

  it("uncategorises products when a category is deactivated", async () => {
    const { categoryId } = await asOwner().mutation(api.categories.create, {
      name: "Flour",
    });
    const { productId } = await asOwner().mutation(api.products.create, {
      ...baseProduct,
      categoryId,
    });

    await asOwner().mutation(api.categories.update, { categoryId, isActive: false });

    const product = await asOwner().query(api.products.get, { productId });
    expect(product.categoryId).toBeUndefined();
  });
});

describe("product lifecycle", () => {
  it("deactivates rather than deletes, so historical references still resolve", async () => {
    const { productId } = await asOwner().mutation(api.products.create, baseProduct);
    await asOwner().mutation(api.products.setActive, { productId, isActive: false });

    // Gone from the default list...
    expect(await asOwner().query(api.products.list, {})).toHaveLength(0);
    // ...but still resolvable by id, which is what a past sale line needs.
    const product = await asOwner().query(api.products.get, { productId });
    expect(product.name).toBe("Maize Flour 2kg");
    expect(product.isActive).toBe(false);
  });

  it("refuses a negative price", async () => {
    await expectRejection(
      asOwner().mutation(api.products.create, {
        ...baseProduct,
        sellingPriceMinor: -1,
      }),
      "VALIDATION",
    );
  });

  it("refuses a fractional price, which would not be a whole cent", async () => {
    await expectRejection(
      asOwner().mutation(api.products.create, {
        ...baseProduct,
        sellingPriceMinor: 1999.5,
      }),
      "VALIDATION",
    );
  });

  it("does not track stock for a service", async () => {
    const { productId } = await asOwner().mutation(api.products.create, {
      name: "Haircut",
      sku: "SVC-CUT",
      unit: "service",
      costPriceMinor: 0,
      sellingPriceMinor: 30000,
    });

    await expectRejection(
      asOwner().mutation(api.inventory.adjust, {
        productId,
        quantityDelta: -1,
        reason: "n/a",
      }),
      "VALIDATION",
    );
  });
});
