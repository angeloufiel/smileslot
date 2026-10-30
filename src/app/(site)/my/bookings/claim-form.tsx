"use client";

import { claimBookingAction } from "@/app/actions/booking";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input } from "@/components/ui";

export function ClaimBookingForm() {
  return (
    <ActionForm action={claimBookingAction} resetOnSuccess className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      {({ pending, errors }) => (
        <>
          <Field label="Booking number" name="reference" error={errors.reference} hint="From your booking email, for example 4827-3159">
            <Input name="reference" inputMode="numeric" autoComplete="off" placeholder="4827-3159" error={errors.reference} />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending} className="sm:mb-7 sm:w-auto">{pending ? "Adding…" : "Add booking"}</Button>
        </>
      )}
    </ActionForm>
  );
}
