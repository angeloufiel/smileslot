import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Create a patient account</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        See all your appointments in one place. Already have one?{" "}
        <Link href="/login" className="text-cobalt hover:underline">Sign in</Link>
      </p>
      <SignUpForm />
    </>
  );
}
