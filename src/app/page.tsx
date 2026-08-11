import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="bg-surface-sunken flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-ink text-3xl font-semibold tracking-tight">AI-POS</h1>
        <p className="text-ink-muted mt-3 text-sm leading-relaxed">
          Point of sale, inventory and business intelligence for African SMEs. Sell with
          cash or M-Pesa, keep stock accurate, and ask your business questions in plain
          language.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/sign-up">
            <Button size="lg">Get started</Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
