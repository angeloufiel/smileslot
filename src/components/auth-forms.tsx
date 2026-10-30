"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  forgotPasswordAction, resetPasswordAction, signInAction, signUpAction,
} from "@/app/actions/auth";
import { Alert, Button, Field, Input } from "@/components/ui";

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {notice && <Alert tone="info">{notice}</Alert>}
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" name="email" error={errors.email}>
        <Input name="email" type="email" autoComplete="email" required error={errors.email} />
      </Field>
      <Field label="Password" name="password" error={errors.password}>
        <Input name="password" type="password" autoComplete="current-password" required error={errors.password} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-cobalt hover:underline">Forgot password?</Link>
        <Link href="/signup" className="text-cobalt hover:underline">Create an account</Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Field label="Full name" name="fullName" error={errors.fullName}>
        <Input name="fullName" autoComplete="name" required error={errors.fullName} />
      </Field>
      <Field label="Mobile number" name="phone" error={errors.phone}>
        <Input name="phone" type="tel" autoComplete="tel" required error={errors.phone} />
      </Field>
      <Field label="Email" name="email" error={errors.email}>
        <Input name="email" type="email" autoComplete="email" required error={errors.email} />
      </Field>
      <Field label="Password" name="password" error={errors.password} hint="At least 10 characters">
        <Input name="password" type="password" autoComplete="new-password" required error={errors.password} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating account…" : "Create account"}</Button>
      <p className="text-sm text-muted">
        Bookings you made as a guest with the same email appear in your account after you confirm your email.
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  if (state?.ok) return <Alert tone="success">{state.message}</Alert>;
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Email" name="email" error={errors.email}>
        <Input name="email" type="email" autoComplete="email" required error={errors.email} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state && !state.ok && <Alert>{state.error}</Alert>}
      <Field label="New password" name="password" error={errors.password} hint="At least 10 characters">
        <Input name="password" type="password" autoComplete="new-password" required error={errors.password} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : "Save new password"}</Button>
    </form>
  );
}
