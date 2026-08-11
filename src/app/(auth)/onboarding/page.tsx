import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata = { title: "Set up your business" };

export default function OnboardingPage() {
  return (
    <main className="bg-surface-sunken min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-ink text-2xl font-semibold">Set up your business</h1>
          <p className="text-ink-muted mt-1 text-sm">
            Three short steps. You can change any of this later in Settings.
          </p>
        </header>
        <OnboardingWizard />
      </div>
    </main>
  );
}
