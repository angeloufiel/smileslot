import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "@/components/auth-forms";
import { Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Patients and clinic staff use the same sign-in. No account? You can still{" "}
        <Link href="/book" className="text-cobalt hover:underline">book as a guest</Link>.
      </p>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function LoginForm({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const p = await searchParams;
  const next = typeof p.next === "string" ? p.next : undefined;
  const notice = p.reset ? "Password updated. Sign in with your new password."
    : p.error === "link" ? "That link is invalid or expired. Sign in, or request a new link." : undefined;
  return <SignInForm next={next} notice={notice} />;
}
