"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { useTenant } from "@/lib/auth/use-permission";
import { toClientError } from "@/lib/errors";

interface SupplierValues {
  supplierId?: Id<"suppliers">;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  addressLine: string;
}

const empty: SupplierValues = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  addressLine: "",
};

export default function SuppliersPage() {
  const tenant = useTenant();
  const suppliers = useQuery(api.suppliers.list, {});
  const [editing, setEditing] = useState<SupplierValues | null>(null);

  const canManage = tenant?.permissions.includes("suppliers:manage") ?? false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-ink text-xl font-semibold">Suppliers</h1>
          <p className="text-ink-muted mt-0.5 text-sm">Who you buy stock from.</p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing(empty)}>
            <Plus className="size-4" aria-hidden />
            New supplier
          </Button>
        )}
      </div>

      {suppliers === undefined ? (
        <p className="text-ink-muted text-sm">Loading suppliers…</p>
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          description="Add the wholesalers and distributors you buy from."
          action={
            canManage ? (
              <Button onClick={() => setEditing(empty)}>Add a supplier</Button>
            ) : undefined
          }
        />
      ) : (
        <Table caption="Suppliers">
          <thead>
            <tr>
              <Th>Supplier</Th>
              <Th>Contact</Th>
              <Th>Phone</Th>
              {canManage && <Th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <Tr key={supplier._id}>
                <Td className="font-medium">{supplier.name}</Td>
                <Td className="text-ink-muted">{supplier.contactName ?? "—"}</Td>
                <Td className="text-ink-muted tabular">{supplier.phone ?? "—"}</Td>
                {canManage && (
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditing({
                          supplierId: supplier._id,
                          name: supplier.name,
                          contactName: supplier.contactName ?? "",
                          phone: supplier.phone ?? "",
                          email: supplier.email ?? "",
                          addressLine: supplier.addressLine ?? "",
                        })
                      }
                    >
                      Edit
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && <SupplierDialog initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplierDialog({
  initial,
  onClose,
}: {
  initial: SupplierValues;
  onClose: () => void;
}) {
  const create = useMutation(api.suppliers.create);
  const update = useMutation(api.suppliers.update);

  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof SupplierValues>(key: K, value: SupplierValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: values.name,
        contactName: values.contactName || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        addressLine: values.addressLine || undefined,
      };
      if (values.supplierId) {
        await update({ supplierId: values.supplierId, ...payload });
      } else {
        await create(payload);
      }
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
      title={values.supplierId ? "Edit supplier" : "New supplier"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !values.name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Supplier name" required>
          {(props) => (
            <Input
              {...props}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Nairobi Wholesalers Ltd"
              autoFocus
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">
            {(props) => (
              <Input
                {...props}
                value={values.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
            )}
          </Field>
          <Field label="Phone">
            {(props) => (
              <Input
                {...props}
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
                inputMode="tel"
                placeholder="0722 000 111"
              />
            )}
          </Field>
        </div>
        <Field label="Email">
          {(props) => (
            <Input
              {...props}
              value={values.email}
              onChange={(e) => set("email", e.target.value)}
              inputMode="email"
            />
          )}
        </Field>
        <Field label="Address">
          {(props) => (
            <Input
              {...props}
              value={values.addressLine}
              onChange={(e) => set("addressLine", e.target.value)}
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
