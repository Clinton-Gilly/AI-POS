import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="bg-surface-sunken flex min-h-screen items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
