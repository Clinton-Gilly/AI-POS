/**
 * Development seed data.
 *
 * Realistic volume and shape matter: AI insight quality (Phase 6), trend charts
 * (Phase 5) and query performance are all meaningless against ten toy rows. This
 * builds a Kenyan retail catalogue — the goods an actual duka stocks, at prices
 * someone would recognise.
 *
 * Guarded three ways, because a seed that can run against real data is a
 * data-loss incident waiting to happen:
 *   1. It is an `internalMutation`, so no client can call it.
 *   2. It refuses to run against a business that already has products.
 *   3. It only ever inserts; it never updates or deletes.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

interface SeedProduct {
  name: string;
  sku: string;
  barcode?: string;
  /** Cost and selling price in KES cents. */
  cost: number;
  price: number;
  unit: "piece" | "kg" | "litre" | "packet" | "box" | "service";
  stock: number;
  lowStockThreshold?: number;
}

const CATALOGUE: Array<{ category: string; products: SeedProduct[] }> = [
  {
    category: "Flour & Grains",
    products: [
      {
        name: "Maize Flour 2kg",
        sku: "MF-2KG",
        barcode: "6161100010014",
        cost: 17000,
        price: 21000,
        unit: "packet",
        stock: 48,
        lowStockThreshold: 12,
      },
      {
        name: "Maize Flour 1kg",
        sku: "MF-1KG",
        barcode: "6161100010021",
        cost: 9000,
        price: 11500,
        unit: "packet",
        stock: 60,
      },
      {
        name: "Wheat Flour 2kg",
        sku: "WF-2KG",
        barcode: "6161100010038",
        cost: 19500,
        price: 24000,
        unit: "packet",
        stock: 30,
      },
      {
        name: "Rice Pishori 1kg",
        sku: "RC-PSH-1",
        cost: 18000,
        price: 23000,
        unit: "kg",
        stock: 40,
      },
      {
        name: "Rice Basmati 1kg",
        sku: "RC-BSM-1",
        cost: 22000,
        price: 28000,
        unit: "kg",
        stock: 25,
      },
      {
        name: "Beans Rosecoco 1kg",
        sku: "BN-RSC-1",
        cost: 15000,
        price: 19000,
        unit: "kg",
        stock: 35,
      },
      {
        name: "Green Grams 1kg",
        sku: "BN-NDG-1",
        cost: 17000,
        price: 22000,
        unit: "kg",
        stock: 20,
      },
      {
        name: "Porridge Flour 1kg",
        sku: "PF-1KG",
        cost: 12000,
        price: 15500,
        unit: "packet",
        stock: 18,
      },
    ],
  },
  {
    category: "Dairy & Eggs",
    products: [
      {
        name: "Milk 500ml",
        sku: "MK-500",
        barcode: "6161100020013",
        cost: 5500,
        price: 7000,
        unit: "packet",
        stock: 72,
        lowStockThreshold: 24,
      },
      {
        name: "Milk 1L",
        sku: "MK-1L",
        barcode: "6161100020020",
        cost: 10500,
        price: 13000,
        unit: "litre",
        stock: 40,
      },
      {
        name: "Long Life Milk 500ml",
        sku: "MK-LL-500",
        cost: 6500,
        price: 8500,
        unit: "packet",
        stock: 30,
      },
      {
        name: "Yoghurt 250ml",
        sku: "YG-250",
        cost: 6000,
        price: 8000,
        unit: "piece",
        stock: 24,
      },
      {
        name: "Butter 250g",
        sku: "BT-250",
        cost: 22000,
        price: 27000,
        unit: "piece",
        stock: 12,
      },
      {
        name: "Eggs Tray (30)",
        sku: "EG-TRY-30",
        cost: 42000,
        price: 50000,
        unit: "box",
        stock: 15,
        lowStockThreshold: 4,
      },
      {
        name: "Cheese Slices 200g",
        sku: "CH-SLC-200",
        cost: 32000,
        price: 39000,
        unit: "packet",
        stock: 8,
      },
    ],
  },
  {
    category: "Bread & Bakery",
    products: [
      {
        name: "Bread White 400g",
        sku: "BR-WHT-400",
        barcode: "6161100030012",
        cost: 5500,
        price: 7000,
        unit: "piece",
        stock: 30,
        lowStockThreshold: 10,
      },
      {
        name: "Bread Brown 400g",
        sku: "BR-BRN-400",
        cost: 6000,
        price: 7500,
        unit: "piece",
        stock: 20,
      },
      {
        name: "Mandazi (6 pack)",
        sku: "MZ-6",
        cost: 4000,
        price: 6000,
        unit: "packet",
        stock: 15,
      },
      {
        name: "Chapati (5 pack)",
        sku: "CP-5",
        cost: 5000,
        price: 7500,
        unit: "packet",
        stock: 12,
      },
      {
        name: "Scones (4 pack)",
        sku: "SC-4",
        cost: 5000,
        price: 7000,
        unit: "packet",
        stock: 10,
      },
    ],
  },
  {
    category: "Cooking Essentials",
    products: [
      {
        name: "Cooking Oil 1L",
        sku: "CO-1L",
        barcode: "6161100040011",
        cost: 28000,
        price: 34000,
        unit: "litre",
        stock: 36,
        lowStockThreshold: 10,
      },
      {
        name: "Cooking Oil 500ml",
        sku: "CO-500",
        cost: 15000,
        price: 18500,
        unit: "litre",
        stock: 40,
      },
      {
        name: "Cooking Fat 500g",
        sku: "CF-500",
        cost: 16000,
        price: 20000,
        unit: "piece",
        stock: 22,
      },
      {
        name: "Sugar 1kg",
        sku: "SG-1KG",
        barcode: "6161100040028",
        cost: 14000,
        price: 17500,
        unit: "kg",
        stock: 55,
        lowStockThreshold: 15,
      },
      {
        name: "Sugar 2kg",
        sku: "SG-2KG",
        cost: 27000,
        price: 33000,
        unit: "kg",
        stock: 25,
      },
      {
        name: "Salt 1kg",
        sku: "SL-1KG",
        cost: 3000,
        price: 4500,
        unit: "packet",
        stock: 45,
      },
      {
        name: "Tomato Paste 400g",
        sku: "TP-400",
        cost: 9000,
        price: 12000,
        unit: "piece",
        stock: 20,
      },
      {
        name: "Curry Powder 100g",
        sku: "SP-CRY-100",
        cost: 5000,
        price: 7000,
        unit: "packet",
        stock: 18,
      },
      {
        name: "Royco Cubes (10)",
        sku: "SP-RYC-10",
        cost: 4000,
        price: 5500,
        unit: "packet",
        stock: 30,
      },
    ],
  },
  {
    category: "Beverages",
    products: [
      {
        name: "Tea Leaves 250g",
        sku: "TE-250",
        barcode: "6161100050010",
        cost: 13000,
        price: 16500,
        unit: "packet",
        stock: 32,
      },
      {
        name: "Tea Bags (50)",
        sku: "TE-BAG-50",
        cost: 18000,
        price: 23000,
        unit: "box",
        stock: 20,
      },
      {
        name: "Coffee 100g",
        sku: "CF-INS-100",
        cost: 24000,
        price: 30000,
        unit: "packet",
        stock: 14,
      },
      {
        name: "Drinking Chocolate 200g",
        sku: "DC-200",
        cost: 26000,
        price: 32000,
        unit: "packet",
        stock: 10,
      },
      {
        name: "Soda 500ml",
        sku: "SD-500",
        barcode: "6161100050027",
        cost: 5000,
        price: 7000,
        unit: "piece",
        stock: 60,
        lowStockThreshold: 20,
      },
      {
        name: "Soda 2L",
        sku: "SD-2L",
        cost: 14000,
        price: 18000,
        unit: "piece",
        stock: 24,
      },
      {
        name: "Bottled Water 500ml",
        sku: "WT-500",
        cost: 2500,
        price: 4000,
        unit: "piece",
        stock: 80,
      },
      {
        name: "Bottled Water 5L",
        sku: "WT-5L",
        cost: 15000,
        price: 20000,
        unit: "piece",
        stock: 18,
      },
      {
        name: "Juice 1L",
        sku: "JC-1L",
        cost: 15000,
        price: 19000,
        unit: "litre",
        stock: 20,
      },
    ],
  },
  {
    category: "Soaps & Cleaning",
    products: [
      {
        name: "Bar Soap 800g",
        sku: "SP-BAR-800",
        barcode: "6161100060019",
        cost: 16000,
        price: 20000,
        unit: "piece",
        stock: 40,
      },
      {
        name: "Washing Powder 500g",
        sku: "WP-500",
        cost: 12000,
        price: 15500,
        unit: "packet",
        stock: 35,
      },
      {
        name: "Washing Powder 1kg",
        sku: "WP-1KG",
        cost: 22000,
        price: 27500,
        unit: "packet",
        stock: 20,
      },
      {
        name: "Dishwashing Liquid 500ml",
        sku: "DW-500",
        cost: 14000,
        price: 18000,
        unit: "piece",
        stock: 22,
      },
      {
        name: "Bleach 750ml",
        sku: "BL-750",
        cost: 11000,
        price: 14500,
        unit: "piece",
        stock: 16,
      },
      {
        name: "Toilet Cleaner 500ml",
        sku: "TC-500",
        cost: 15000,
        price: 19500,
        unit: "piece",
        stock: 12,
      },
      {
        name: "Steel Wool (3 pack)",
        sku: "SW-3",
        cost: 3000,
        price: 5000,
        unit: "packet",
        stock: 25,
      },
    ],
  },
  {
    category: "Personal Care",
    products: [
      {
        name: "Toothpaste 100ml",
        sku: "TP-100",
        barcode: "6161100070018",
        cost: 12000,
        price: 15500,
        unit: "piece",
        stock: 28,
      },
      {
        name: "Toothbrush",
        sku: "TB-STD",
        cost: 5000,
        price: 8000,
        unit: "piece",
        stock: 30,
      },
      {
        name: "Bathing Soap 125g",
        sku: "BS-125",
        cost: 6500,
        price: 9000,
        unit: "piece",
        stock: 45,
      },
      {
        name: "Petroleum Jelly 250ml",
        sku: "PJ-250",
        cost: 16000,
        price: 20500,
        unit: "piece",
        stock: 18,
      },
      {
        name: "Body Lotion 400ml",
        sku: "BL-LOT-400",
        cost: 28000,
        price: 35000,
        unit: "piece",
        stock: 12,
      },
      {
        name: "Sanitary Pads (8)",
        sku: "SN-PAD-8",
        cost: 9000,
        price: 12000,
        unit: "packet",
        stock: 24,
      },
      {
        name: "Tissue Roll (4 pack)",
        sku: "TS-4",
        cost: 14000,
        price: 18000,
        unit: "packet",
        stock: 20,
      },
      {
        name: "Shaving Razor (5)",
        sku: "RZ-5",
        cost: 7000,
        price: 10000,
        unit: "packet",
        stock: 15,
      },
    ],
  },
  {
    category: "Snacks & Confectionery",
    products: [
      {
        name: "Biscuits 100g",
        sku: "BC-100",
        cost: 4500,
        price: 6500,
        unit: "packet",
        stock: 40,
      },
      {
        name: "Crisps 50g",
        sku: "CR-50",
        cost: 4000,
        price: 6000,
        unit: "packet",
        stock: 35,
      },
      {
        name: "Groundnuts 100g",
        sku: "GN-100",
        cost: 5000,
        price: 7500,
        unit: "packet",
        stock: 28,
      },
      {
        name: "Sweets (jar)",
        sku: "SW-JAR",
        cost: 30000,
        price: 40000,
        unit: "box",
        stock: 6,
      },
      {
        name: "Chewing Gum",
        sku: "GM-STD",
        cost: 1000,
        price: 2000,
        unit: "piece",
        stock: 100,
      },
      {
        name: "Chocolate Bar 50g",
        sku: "CH-BAR-50",
        cost: 8000,
        price: 11000,
        unit: "piece",
        stock: 20,
      },
    ],
  },
  {
    category: "Household",
    products: [
      {
        name: "Matchbox (10 pack)",
        sku: "MB-10",
        cost: 3000,
        price: 5000,
        unit: "packet",
        stock: 30,
      },
      {
        name: "Candles (6 pack)",
        sku: "CN-6",
        cost: 6000,
        price: 9000,
        unit: "packet",
        stock: 20,
      },
      {
        name: "Batteries AA (4)",
        sku: "BT-AA-4",
        cost: 10000,
        price: 14000,
        unit: "packet",
        stock: 18,
      },
      {
        name: "Light Bulb LED",
        sku: "LB-LED",
        cost: 15000,
        price: 20000,
        unit: "piece",
        stock: 14,
      },
      {
        name: "Charcoal 2kg",
        sku: "CL-2KG",
        cost: 12000,
        price: 16000,
        unit: "kg",
        stock: 25,
      },
      {
        name: "Cooking Gas Refill 6kg",
        sku: "GS-6KG",
        cost: 120000,
        price: 140000,
        unit: "piece",
        stock: 8,
        lowStockThreshold: 3,
      },
      {
        name: "Jerrican 20L",
        sku: "JC-20L",
        cost: 45000,
        price: 58000,
        unit: "piece",
        stock: 6,
      },
      {
        name: "Broom",
        sku: "BM-STD",
        cost: 18000,
        price: 24000,
        unit: "piece",
        stock: 10,
      },
    ],
  },
  {
    category: "Baby Products",
    products: [
      {
        name: "Diapers Medium (10)",
        sku: "DP-M-10",
        cost: 32000,
        price: 40000,
        unit: "packet",
        stock: 15,
      },
      {
        name: "Baby Soap 100g",
        sku: "BB-SP-100",
        cost: 9000,
        price: 12000,
        unit: "piece",
        stock: 18,
      },
      {
        name: "Baby Powder 200g",
        sku: "BB-PW-200",
        cost: 15000,
        price: 19500,
        unit: "piece",
        stock: 12,
      },
      {
        name: "Baby Porridge 400g",
        sku: "BB-PR-400",
        cost: 28000,
        price: 35000,
        unit: "packet",
        stock: 10,
      },
    ],
  },
];

const SUPPLIERS = [
  {
    name: "Nairobi Wholesalers Ltd",
    contactName: "James Mwangi",
    phone: "+254722000111",
  },
  {
    name: "Rift Valley Distributors",
    contactName: "Grace Chepkoech",
    phone: "+254733000222",
  },
  { name: "Coastal Foods Supply", contactName: "Ali Hassan", phone: "+254711000333" },
  {
    name: "Highland Dairy Co-op",
    contactName: "Peter Kariuki",
    phone: "+254720000444",
  },
];

/**
 * One-shot demo setup for a fresh clone: catalogue, then trading history, for
 * whichever business the caller names — or the only business, when there is
 * exactly one, so a first-time setup needs no id lookup.
 *
 * Chains to `demoData.seedDemoBusiness` via the scheduler rather than calling
 * it directly: the trading history is itself a scheduled chain (one mutation
 * per simulated day), and scheduling here keeps this mutation's own
 * transaction small regardless of how many days are requested.
 */
export const seedDemo = internalMutation({
  args: { businessId: v.optional(v.id("businesses")), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let businessId = args.businessId;

    if (!businessId) {
      const businesses = await ctx.db.query("businesses").take(2);
      if (businesses.length === 0) {
        throw new Error(
          "No business exists yet. Sign up and complete onboarding first, " +
            "then re-run this with no businessId, or pass one explicitly.",
        );
      }
      if (businesses.length > 1) {
        throw new Error(
          "More than one business exists — pass businessId explicitly. " +
            "Find it in the Convex dashboard's Data tab, businesses table.",
        );
      }
      businessId = businesses[0]!._id;
    }

    const catalogue = await seedCatalogueFor(ctx, businessId);
    if (catalogue.skipped) return { step: "catalogue", ...catalogue };

    await ctx.scheduler.runAfter(0, internal.platform.demoData.seedDemoBusiness, {
      businessId,
      days: args.days,
    });

    return {
      step: "scheduled",
      businessId,
      catalogue,
      note: "Trading history is running in the background — one mutation per simulated day. Check the Convex dashboard's Logs tab for progress; it takes under a minute for 90 days.",
    };
  },
});

export const seedCatalogue = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => seedCatalogueFor(ctx, args.businessId),
});

/**
 * The catalogue seed's body, factored out so `seedDemo` can call it in the
 * same transaction as its own lookups rather than through a second scheduled
 * hop — the whole catalogue insert is well within one mutation's budget,
 * unlike the day-by-day trading history.
 */
async function seedCatalogueFor(ctx: MutationCtx, businessId: Id<"businesses">) {
  const business = await ctx.db.get(businessId);
  if (!business) throw new Error("Business not found");

  // Refuse to touch a business that already has a catalogue.
  const existing = await ctx.db
    .query("products")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .first();
  if (existing) {
    return { skipped: true, reason: "This business already has products." };
  }

  const location = await ctx.db
    .query("locations")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .first();
  if (!location) throw new Error("Business has no location");

  const owner = await ctx.db.get(business.ownerUserId);
  if (!owner) throw new Error("Business has no owner");

  for (const supplier of SUPPLIERS) {
    await ctx.db.insert("suppliers", {
      businessId: businessId,
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      isActive: true,
    });
  }

  let categoryCount = 0;
  let productCount = 0;

  for (const [index, group] of CATALOGUE.entries()) {
    const categoryId = await ctx.db.insert("categories", {
      businessId: businessId,
      name: group.category,
      sortOrder: index,
      isActive: true,
    });
    categoryCount++;

    for (const item of group.products) {
      const productId = await ctx.db.insert("products", {
        businessId: businessId,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        categoryId,
        unit: item.unit,
        costPriceMinor: item.cost,
        sellingPriceMinor: item.price,
        currency: business.currency,
        taxRateId: business.settings.defaultTaxRateId,
        trackInventory: true,
        lowStockThreshold: item.lowStockThreshold,
        isActive: true,
      });
      productCount++;

      const threshold =
        item.lowStockThreshold ?? business.settings.lowStockDefaultThreshold;

      await seedStock(ctx, {
        businessId: businessId,
        locationId: location._id,
        productId,
        quantity: item.stock,
        unitCostMinor: item.cost,
        threshold,
        actorUserId: owner._id,
      });
    }
  }

  return {
    skipped: false,
    categories: categoryCount,
    products: productCount,
    suppliers: SUPPLIERS.length,
  };
}

/**
 * Opening stock, written as a ledger movement plus its projection — the same
 * pair `applyMovement` writes, so seeded data satisfies the reconciliation
 * invariant rather than tripping it on the first nightly run.
 */
async function seedStock(
  ctx: MutationCtx,
  input: {
    businessId: Id<"businesses">;
    locationId: Id<"locations">;
    productId: Id<"products">;
    quantity: number;
    unitCostMinor: number;
    threshold: number;
    actorUserId: Id<"users">;
  },
): Promise<void> {
  await ctx.db.insert("inventoryLevels", {
    businessId: input.businessId,
    locationId: input.locationId,
    productId: input.productId,
    quantity: input.quantity,
    reservedQuantity: 0,
    lowStockThreshold: input.threshold,
    isLowStock: input.quantity <= input.threshold,
    updatedAt: Date.now(),
  });

  await ctx.db.insert("stockMovements", {
    businessId: input.businessId,
    locationId: input.locationId,
    productId: input.productId,
    type: "opening",
    quantityDelta: input.quantity,
    balanceAfter: input.quantity,
    unitCostMinor: input.unitCostMinor,
    reason: "Opening stock (seed)",
    referenceType: "seed",
    actorUserId: input.actorUserId,
  });
}
