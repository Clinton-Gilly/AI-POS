"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { fromMajor, toMajor } from "@/lib/money";
import type { CurrencyCode } from "@/config/currencies";
import { toClientError } from "@/lib/errors";

const UNITS = [
  { value: "piece", label: "Piece" },
  { value: "packet", label: "Packet" },
  { value: "kg", label: "Kilogram" },
  { value: "litre", label: "Litre" },
  { value: "box", label: "Box" },
  { value: "service", label: "Service (no stock)" },
] as const;

type Unit = (typeof UNITS)[number]["value"];

export interface ProductFormValues {
  productId?: Id<"products">;
  name: string;
  sku: string;
  barcode: string;
  unit: Unit;
  costMajor: string;
  priceMajor: string;
  categoryId: string;
  lowStockThreshold: string;
  openingQuantity: string;
}

export const emptyProduct: ProductFormValues = {
  name: "",
  sku: "",
  barcode: "",
  unit: "piece",
  costMajor: "",
  priceMajor: "",
  categoryId: "",
  lowStockThreshold: "",
  openingQuantity: "",
};

export function ProductForm({
  open,
  initial,
  currency,
  canSeeCost,
  onClose,
}: {
  open: boolean;
  initial: ProductFormValues;
  currency: CurrencyCode;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const categories = useQuery(api.categories.list, {});
  const create = useMutation(api.products.create);
  const update = useMutation(api.products.update);

  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formKey, setFormKey] = useState(0);

  // Re-seed the form when a different product is opened for editing.
  const initialKey = `${initial.productId ?? "new"}-${open}`;
  const [seenKey, setSeenKey] = useState(initialKey);
  if (seenKey !== initialKey) {
    setSeenKey(initialKey);
    setValues(initial);
    setError(null);
    setFormKey((k) => k + 1);
  }

  const isEdit = Boolean(values.productId);

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const shared = {
        name: values.name,
        sku: values.sku,
        barcode: values.barcode || undefined,
        categoryId: values.categoryId
          ? (values.categoryId as Id<"categories">)
          : undefined,
        sellingPriceMinor: fromMajor(values.priceMajor || "0", currency),
        lowStockThreshold: values.lowStockThreshold
          ? Number(values.lowStockThreshold)
          : undefined,
      };

      if (values.productId) {
        await update({
          productId: values.productId,
          unit: values.unit,
          // Cost is only sent when the user was allowed to see it — otherwise
          // an edit by a manager would blank a value they never received.
          ...(canSeeCost
            ? { costPriceMinor: fromMajor(values.costMajor || "0", currency) }
            : {}),
          ...shared,
        });
      } else {
        await create({
          unit: values.unit,
          costPriceMinor: fromMajor(values.costMajor || "0", currency),
          openingQuantity: values.openingQuantity
            ? Number(values.openingQuantity)
            : undefined,
          ...shared,
        });
      }
      onClose();
    } catch (caught) {
      setError(toClientError(caught).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit product" : "New product"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || !values.name.trim() || !values.sku.trim()}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create product"}
          </Button>
        </>
      }
    >
      <div key={formKey} className="space-y-4">
        <Field label="Name" required>
          {(props) => (
            <Input
              {...props}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Maize Flour 2kg"
              autoFocus
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SKU" required hint="Your own code for this product.">
            {(props) => (
              <Input
                {...props}
                value={values.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder="MF-2KG"
              />
            )}
          </Field>
          <Field label="Barcode" hint="Scan or type. Leave blank if none.">
            {(props) => (
              <Input
                {...props}
                value={values.barcode}
                onChange={(e) => set("barcode", e.target.value)}
                inputMode="numeric"
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit">
            {(props) => (
              <Select
                {...props}
                value={values.unit}
                onChange={(e) => set("unit", e.target.value as Unit)}
              >
                {UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(props) => (
              <Select
                {...props}
                value={values.categoryId}
                onChange={(e) => set("categoryId", e.target.value)}
              >
                <option value="">Uncategorised</option>
                {(categories ?? []).map((category) => (
                  <option key={category._id} value={category._id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {canSeeCost && (
            <Field label={`Cost price (${currency})`} hint="What you pay.">
              {(props) => (
                <Input
                  {...props}
                  value={values.costMajor}
                  onChange={(e) => set("costMajor", e.target.value)}
                  inputMode="decimal"
                  placeholder="170.00"
                />
              )}
            </Field>
          )}
          <Field label={`Selling price (${currency})`} required hint="What you charge.">
            {(props) => (
              <Input
                {...props}
                value={values.priceMajor}
                onChange={(e) => set("priceMajor", e.target.value)}
                inputMode="decimal"
                placeholder="210.00"
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Low stock alert at" hint="Leave blank to use the shop default.">
            {(props) => (
              <Input
                {...props}
                value={values.lowStockThreshold}
                onChange={(e) => set("lowStockThreshold", e.target.value)}
                inputMode="numeric"
                placeholder="12"
              />
            )}
          </Field>
          {!isEdit && values.unit !== "service" && (
            <Field label="Stock on hand" hint="Recorded as opening stock.">
              {(props) => (
                <Input
                  {...props}
                  value={values.openingQuantity}
                  onChange={(e) => set("openingQuantity", e.target.value)}
                  inputMode="numeric"
                  placeholder="48"
                />
              )}
            </Field>
          )}
        </div>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Build form values from an existing product row. */
export function toFormValues(
  product: {
    _id: Id<"products">;
    name: string;
    sku: string;
    barcode?: string;
    unit: string;
    sellingPriceMinor: number;
    costPriceMinor?: number;
    categoryId?: Id<"categories">;
    lowStockThreshold?: number;
  },
  currency: CurrencyCode,
): ProductFormValues {
  return {
    productId: product._id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? "",
    unit: product.unit as Unit,
    costMajor:
      product.costPriceMinor !== undefined
        ? String(toMajor(product.costPriceMinor, currency))
        : "",
    priceMajor: String(toMajor(product.sellingPriceMinor, currency)),
    categoryId: product.categoryId ?? "",
    lowStockThreshold:
      product.lowStockThreshold !== undefined ? String(product.lowStockThreshold) : "",
    openingQuantity: "",
  };
}
