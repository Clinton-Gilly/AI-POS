"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useTenant } from "@/lib/auth/use-permission";
import { formatMoney } from "@/lib/money";
import { isCurrencyCode } from "@/config/currencies";

/**
 * Phase 2 dashboard.
 *
 * Deliberately shows the tenant and permission context rather than fabricated
 * sales figures: there are no sales in the system until Phase 4, and a
 * dashboard of placeholder numbers is exactly the "mock UI presented as
 * complete" the development rules forbid. Real analytics land in Phase 5.
 */
export default function DashboardPage() {
  const tenant = useTenant();

  if (tenant === undefined) {
    return <p className="text-ink-muted text-sm">Loading…</p>;
  }

  const currency = isCurrencyCode(tenant.business.currency)
    ? tenant.business.currency
    : "KES";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ink text-xl font-semibold">{tenant.business.name}</h1>
        <p className="text-ink-muted mt-0.5 text-sm">
          Signed in as {tenant.user.name} · {tenant.role.name}
        </p>
      </div>

      <Card>
        <CardHeader
          title="Setup complete"
          description="Your business is ready. Products and selling arrive in the next release."
        />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Detail
            label="Currency"
            value={`${currency} · ${formatMoney(0, currency)}`}
          />
          <Detail label="Timezone" value={tenant.business.timezone} />
          <Detail
            label="Pricing"
            value={
              tenant.business.settings.taxInclusivePricing
                ? "Tax inclusive"
                : "Tax exclusive"
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your access"
          description="What this account may do, enforced on the server for every request."
        />
        <CardBody>
          <ul className="flex flex-wrap gap-1.5">
            {[...tenant.permissions].sort().map((permission) => (
              <li
                key={permission}
                className="border-line text-ink-muted rounded border px-2 py-0.5 font-mono text-xs"
              >
                {permission}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-ink mt-1 text-sm">{value}</dd>
    </div>
  );
}
