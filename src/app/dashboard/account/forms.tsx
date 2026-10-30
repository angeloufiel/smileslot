"use client";

import { changeMyPassword, updateMyName } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input } from "@/components/ui";

export function NameForm({ name }: { name: string }) {
  return (
    <ActionForm action={updateMyName} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      {({ pending, errors }) => (
        <>
          <Field label="Full name" name="fullName" error={errors.fullName}>
            <Input name="fullName" defaultValue={name} required maxLength={120} error={errors.fullName} autoComplete="name" />
          </Field>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save name"}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changeMyPassword} resetOnSuccess className="grid gap-4 sm:grid-cols-3">
      {({ pending, errors }) => (
        <>
          <Field label="Current password" name="current" error={errors.current}>
            <Input name="current" type="password" required autoComplete="current-password" error={errors.current} />
          </Field>
          <Field label="New password" name="next" error={errors.next} hint="At least 10 characters">
            <Input name="next" type="password" required minLength={10} autoComplete="new-password" error={errors.next} />
          </Field>
          <Field label="New password again" name="confirm" error={errors.confirm}>
            <Input name="confirm" type="password" required autoComplete="new-password" error={errors.confirm} />
          </Field>
          <div className="sm:col-span-3"><Button type="submit" disabled={pending}>{pending ? "Changing…" : "Change password"}</Button></div>
        </>
      )}
    </ActionForm>
  );
}
