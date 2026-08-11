import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="bg-surface-sunken flex min-h-screen items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
