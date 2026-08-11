"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { CURRENCIES, CURRENCY_CODES } from "@/config/currencies";
import { toClientError } from "@/lib/errors";

const BUSINESS_TYPES = [
  { value: "retail", label: "Retail shop" },
  { value: "supermarket", label: "Supermarket" },
  { value: "restaurant", label: "Restaurant" },
  { value: "pharmacy", label: "Pharmacy" },
  { value: "salon", label: "Salon" },
  { value: "hardware", label: "Hardware store" },
  { value: "wholesale", label: "Wholesaler" },
  { value: "other", label: "Other" },
] as const;

const COUNTRIES = [
  {
    code: "KE",
    label: "Kenya",
    currency: "KES",
    timezone: "Africa/Nairobi",
    vat: 1600,
  },
  {
    code: "UG",
    label: "Uganda",
    currency: "UGX",
    timezone: "Africa/Kampala",
    vat: 1800,
  },
  {
    code: "TZ",
    label: "Tanzania",
    currency: "TZS",
    timezone: "Africa/Dar_es_Salaam",
    vat: 1800,
  },
  {
    code: "RW",
    label: "Rwanda",
    currency: "RWF",
    timezone: "Africa/Kigali",
    vat: 1800,
  },
  { code: "NG", label: "Nigeria", currency: "NGN", timezone: "Africa/Lagos", vat: 750 },
  { code: "GH", label: "Ghana", currency: "GHS", timezone: "Africa/Accra", vat: 1500 },
  {
    code: "ZA",
    label: "South Africa",
    currency: "ZAR",
    timezone: "Africa/Johannesburg",
    vat: 1500,
  },
] as const;

type Step = 0 | 1 | 2;

export function OnboardingWizard() {
  const router = useRouter();
  const registerBusiness = useMutation(api.onboarding.registerBusiness);

  const [step, setStep] = useState<Step>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [businessType, setBusinessType] =
    useState<(typeof BUSINESS_TYPES)[number]["value"]>("retail");
  const [countryCode, setCountryCode] = useState("KE");
  const [currency, setCurrency] = useState("KES");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [vatBasisPoints, setVatBasisPoints] = useState(1600);
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [primaryColor, setPrimaryColor] = useState("#1F6FEB");

  const country = COUNTRIES.find((c) => c.code === countryCode) ?? COUNTRIES[0];

  /** Country drives currency, timezone and the local VAT default — a Kenyan
   *  shop should not have to know its own VAT rate to finish setup. */
  function selectCountry(code: string) {
    const next = COUNTRIES.find((c) => c.code === code);
    if (!next) return;
    setCountryCode(next.code);
    setCurrency(next.currency);
    setVatBasisPoints(next.vat);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await registerBusiness({
        name,
        businessType,
        country: country.code,
        currency,
        timezone: country.timezone,
        phone: phone || undefined,
        city: city || undefined,
        primaryColor,
        taxRateBasisPoints: vatBasisPoints,
        taxInclusivePricing: taxInclusive,
      });
      router.push("/dashboard");
    } catch (caught) {
      setError(toClientError(caught).message);
      setSubmitting(false);
    }
  }

  const canContinue = step === 0 ? name.trim().length > 0 : true;

  return (
    <Card>
      <div className="border-line flex border-b" role="list">
        {["Business", "Location & tax", "Branding"].map((label, index) => (
          <div
            key={label}
            role="listitem"
            aria-current={index === step ? "step" : undefined}
            className={
              "flex-1 px-4 py-3 text-center text-sm " +
              (index === step
                ? "text-brand border-brand border-b-2 font-medium"
                : "text-ink-subtle")
            }
          >
            <span className="tabular">{index + 1}.</span> {label}
          </div>
        ))}
      </div>

      <CardBody className="space-y-5">
        {step === 0 && (
          <>
            <Field label="Business name" required>
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Amani Mart"
                  autoFocus
                />
              )}
            </Field>
            <Field
              label="Business type"
              hint="This decides which industry features you are offered later."
            >
              {(props) => (
                <Select
                  {...props}
                  value={businessType}
                  onChange={(e) =>
                    setBusinessType(
                      e.target.value as (typeof BUSINESS_TYPES)[number]["value"],
                    )
                  }
                >
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Country">
              {(props) => (
                <Select
                  {...props}
                  value={countryCode}
                  onChange={(e) => selectCountry(e.target.value)}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Currency" hint={`Prices and receipts will use ${currency}.`}>
              {(props) => (
                <Select
                  {...props}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code} — {CURRENCIES[code].name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Town or city">
                {(props) => (
                  <Input
                    {...props}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Nairobi"
                  />
                )}
              </Field>
              <Field label="Business phone" hint="Shown on receipts.">
                {(props) => (
                  <Input
                    {...props}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0712 345 678"
                    inputMode="tel"
                  />
                )}
              </Field>
            </div>

            <Field
              label="VAT rate (%)"
              hint="Set 0 if your business is not VAT registered."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={vatBasisPoints / 100}
                  onChange={(e) =>
                    setVatBasisPoints(Math.round(Number(e.target.value) * 100))
                  }
                />
              )}
            </Field>

            <label className="text-ink flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                className="size-4"
              />
              My shelf prices already include VAT
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <Field
              label="Brand colour"
              hint="Used across your dashboard, receipts and invoices."
            >
              {(props) => (
                <div className="flex items-center gap-3">
                  <input
                    {...props}
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value.toUpperCase())}
                    className="border-line h-10 w-16 cursor-pointer rounded border"
                  />
                  <span className="text-ink-muted tabular text-sm">{primaryColor}</span>
                </div>
              )}
            </Field>

            <div className="border-line bg-surface-sunken rounded-lg border p-4">
              <p className="text-ink-subtle mb-2 text-xs font-medium tracking-wide uppercase">
                Receipt preview
              </p>
              <div
                className="bg-surface rounded p-4 text-center"
                style={{ borderTop: `3px solid ${primaryColor}` }}
              >
                <p className="text-ink font-semibold">{name || "Your business"}</p>
                <p className="text-ink-subtle text-xs">
                  {city || "Town"} · {phone || "Phone"}
                </p>
                <p className="text-ink-muted tabular mt-2 text-sm">
                  Total: {currency} 260.00
                </p>
              </div>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </CardBody>

      <div className="border-line flex items-center justify-between border-t px-5 py-4">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
          disabled={step === 0 || submitting}
        >
          Back
        </Button>

        {step < 2 ? (
          <Button
            onClick={() => setStep((s) => Math.min(2, s + 1) as Step)}
            disabled={!canContinue}
          >
            Continue
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting || name.trim().length === 0}>
            {submitting ? "Creating…" : "Create business"}
          </Button>
        )}
      </div>
    </Card>
  );
}
