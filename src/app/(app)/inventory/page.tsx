"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { useTenant } from "@/lib/auth/use-permission";
import { formatMoney } from "@/lib/money";
import { isCurrencyCode, type CurrencyCode } from "@/config/currencies";
import { toClientError } from "@/lib/errors";

export default function InventoryPage() {
  const tenant = useTenant();
  const levels = useQuery(api.inventory.levels, {});
  const lowStock = useQuery(api.inventory.lowStock, {});

  const canAdjust = tenant?.permissions.includes("inventory:adjust") ?? false;
  const canSeeValue = tenant?.permissions.includes("reports:financial:read") ?? false;
  const valuation = useQuery(api.inventory.valuation, canSeeValue ? {} : "skip");

  const currency: CurrencyCode =
    tenant && isCurrencyCode(tenant.business.currency)
      ? tenant.business.currency
      : "KES";

  const [adjusting, setAdjusting] = useState<{
    productId: Id<"products">;
    name: string;
    quantity: number;
  } | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-ink text-xl font-semibold">Inventory</h1>
        <p className="text-ink-muted mt-0.5 text-sm">
          Stock levels and movement history.
        </p>
      </div>

      {lowStock && lowStock.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader
            title={`${lowStock.length} product${lowStock.length === 1 ? "" : "s"} running low`}
            description="Reorder before these run out."
          />
          <CardBody>
            <ul className="space-y-1.5">
              {lowStock.slice(0, 8).map((item) => (
                <li key={item.productId} className="flex items-center gap-2 text-sm">
                  <AlertTriangle
                    className={
                      item.quantity <= 0 ? "text-danger size-4" : "text-warning size-4"
                    }
                    aria-hidden
                  />
                  <span className="text-ink">{item.name}</span>
                  <span className="text-ink-muted tabular ml-auto">
                    {item.quantity} left (alert at {item.threshold})
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {canSeeValue && valuation && (
        <Card>
          <CardHeader title="Stock value" description="At cost, across all products." />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Value at cost"
              value={formatMoney(valuation.totalCostMinor, currency)}
            />
            <Metric
              label="Value at retail"
              value={formatMoney(valuation.totalRetailMinor, currency)}
            />
            <Metric label="Units on hand" value={String(valuation.unitCount)} />
          </CardBody>
        </Card>
      )}

      {levels === undefined ? (
        <p className="text-ink-muted text-sm">Loading stock…</p>
      ) : levels.length === 0 ? (
        <EmptyState
          title="No stock tracked yet"
          description="Add products with an opening quantity to see them here."
        />
      ) : (
        <Table caption="Stock levels">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>SKU</Th>
              <Th numeric>On hand</Th>
              <Th numeric>Alert at</Th>
              {canSeeValue && <Th numeric>Value</Th>}
              {canAdjust && <Th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {levels.map((level) => (
              <Tr key={level.levelId}>
                <Td>
                  <span className="font-medium">{level.name}</span>
                  {level.isLowStock && (
                    <span className="text-warning ml-2 text-xs font-medium">Low</span>
                  )}
                </Td>
                <Td className="text-ink-muted tabular">{level.sku}</Td>
                <Td numeric className={level.quantity <= 0 ? "text-danger" : undefined}>
                  {level.quantity}
                </Td>
                <Td numeric className="text-ink-subtle">
                  {level.lowStockThreshold}
                </Td>
                {canSeeValue && (
                  <Td numeric>
                    {level.stockValueMinor !== undefined
                      ? formatMoney(level.stockValueMinor, currency)
                      : "—"}
                  </Td>
                )}
                {canAdjust && (
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setAdjusting({
                          productId: level.productId,
                          name: level.name,
                          quantity: level.quantity,
                        })
                      }
                    >
                      Adjust
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {adjusting && (
        <AdjustDialog target={adjusting} onClose={() => setAdjusting(null)} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-ink tabular mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

/**
 * Stock adjustment.
 *
 * Takes a change, not a new total, and requires a reason — the ledger has to
 * record *why* stock moved, or wastage and shrinkage reports are guesswork.
 */
function AdjustDialog({
  target,
  onClose,
}: {
  target: { productId: Id<"products">; name: string; quantity: number };
  onClose: () => void;
}) {
  const adjust = useMutation(api.inventory.adjust);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [type, setType] = useState<"adjustment" | "waste">("adjustment");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = Number(delta);
  const valid = Number.isFinite(parsed) && parsed !== 0 && reason.trim().length > 0;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await adjust({
        productId: target.productId,
        quantityDelta: parsed,
        reason,
        type,
      });
      onClose();
    } catch (caught) {
      setError(toClientError(caught).message);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Adjust stock — ${target.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Saving…" : "Record adjustment"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted text-sm">
          Currently{" "}
          <span className="tabular text-ink font-medium">{target.quantity}</span> on
          hand.
        </p>

        <Field
          label="Change"
          required
          hint="Use a negative number to reduce stock, e.g. -3."
        >
          {(props) => (
            <Input
              {...props}
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              inputMode="numeric"
              placeholder="-3"
              autoFocus
            />
          )}
        </Field>

        <Field label="Type">
          {(props) => (
            <Select
              {...props}
              value={type}
              onChange={(e) => setType(e.target.value as "adjustment" | "waste")}
            >
              <option value="adjustment">Correction / recount</option>
              <option value="waste">Damaged, expired or lost</option>
            </Select>
          )}
        </Field>

        <Field label="Reason" required hint="Recorded permanently against this change.">
          {(props) => (
            <Input
              {...props}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Stock count correction"
            />
          )}
        </Field>

        {parsed < 0 && target.quantity + parsed < 0 && (
          <p className="text-warning text-sm">
            This would take stock below zero and will be refused unless negative stock
            is enabled in Settings.
          </p>
        )}

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
