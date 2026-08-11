"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import {
  ProductForm,
  emptyProduct,
  toFormValues,
  type ProductFormValues,
} from "@/components/products/product-form";
import { useTenant } from "@/lib/auth/use-permission";
import { formatMoney } from "@/lib/money";
import { isCurrencyCode, type CurrencyCode } from "@/config/currencies";

export default function ProductsPage() {
  const tenant = useTenant();
  const products = useQuery(api.products.list, {});
  const setActive = useMutation(api.products.setActive);

  const [term, setTerm] = useState("");
  const [editing, setEditing] = useState<ProductFormValues | null>(null);

  const currency: CurrencyCode =
    tenant && isCurrencyCode(tenant.business.currency)
      ? tenant.business.currency
      : "KES";

  const canWrite = tenant?.permissions.includes("products:write") ?? false;
  const canSeeCost = tenant?.permissions.includes("reports:financial:read") ?? false;

  // Client-side filter: the full list is already loaded, so a round trip per
  // keystroke would be slower, not faster. The indexed server search is what
  // the till uses, where the catalogue is not held in memory.
  const filtered = useMemo(() => {
    if (!products) return [];
    const needle = term.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.sku.toLowerCase().includes(needle) ||
        (p.barcode ?? "").includes(needle),
    );
  }, [products, term]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ink text-xl font-semibold">Products</h1>
          <p className="text-ink-muted mt-0.5 text-sm">
            {products ? `${products.length} active` : "Loading…"}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing(emptyProduct)}>
            <Plus className="size-4" aria-hidden />
            New product
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search
          className="text-ink-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search name, SKU or barcode"
          className="pl-9"
          aria-label="Search products"
        />
      </div>

      {products === undefined ? (
        <p className="text-ink-muted text-sm">Loading products…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={term ? "No products match that search" : "No products yet"}
          description={
            term
              ? "Try a different name, SKU or barcode."
              : "Add your first product to start selling."
          }
          action={
            canWrite && !term ? (
              <Button onClick={() => setEditing(emptyProduct)}>Add a product</Button>
            ) : undefined
          }
        />
      ) : (
        <Table caption="Products">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th numeric>Stock</Th>
              {canSeeCost && <Th numeric>Cost</Th>}
              <Th numeric>Price</Th>
              {canWrite && <Th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((product) => (
              <Tr key={product._id}>
                <Td>
                  <span className="font-medium">{product.name}</span>
                  {product.barcode && (
                    <span className="text-ink-subtle tabular ml-2 text-xs">
                      {product.barcode}
                    </span>
                  )}
                </Td>
                <Td className="text-ink-muted tabular">{product.sku}</Td>
                <Td numeric>
                  {product.quantity === null ? (
                    <span className="text-ink-subtle">—</span>
                  ) : (
                    product.quantity
                  )}
                </Td>
                {canSeeCost && (
                  <Td numeric>
                    {product.costPriceMinor !== undefined
                      ? formatMoney(product.costPriceMinor, currency)
                      : "—"}
                  </Td>
                )}
                <Td numeric>{formatMoney(product.sellingPriceMinor, currency)}</Td>
                {canWrite && (
                  <Td className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(toFormValues(product, currency))}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void setActive({
                          productId: product._id as Id<"products">,
                          isActive: false,
                        })
                      }
                    >
                      Archive
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <ProductForm
          open
          initial={editing}
          currency={currency}
          canSeeCost={canSeeCost}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
