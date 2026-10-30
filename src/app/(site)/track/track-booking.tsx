"use client";

import { useState, useTransition } from "react";
import {
  cancelBookingAction, lookupBookingAction, submitPaymentAction, type TrackedBooking,
} from "@/app/actions/booking";
import { Alert, Badge, Button, Field, Input, Panel, Select } from "@/components/ui";
import { formatDateTime, formatPeso, humanize } from "@/lib/format";
import { PAYMENT_TONE, STATUS_TONE } from "@/lib/status";

export function TrackBooking({ initialReference, paymentInstructions }: { initialReference: string; paymentInstructions: string | null }) {
  const [booking, setBooking] = useState<TrackedBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function find(formData: FormData) {
    setError(null); setNotice(null); setFieldErrors({});
    start(async () => {
      const result = await lookupBookingAction({
        reference: String(formData.get("reference") ?? ""),
        email: String(formData.get("email") ?? ""),
      });
      if (result.ok) setBooking(result.data);
      else { setError(result.error); setFieldErrors(result.fieldErrors ?? {}); }
    });
  }

  if (!booking) {
    return (
      <Panel className="mt-8">
        <form action={find} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Reference number" name="reference" error={fieldErrors.reference} hint="It starts with SS-, for example SS-7K4MQ2XP.">
            <Input name="reference" defaultValue={initialReference} autoCapitalize="characters" required error={fieldErrors.reference} />
          </Field>
          <Field label="Email" name="email" error={fieldErrors.email}>
            <Input name="email" type="email" autoComplete="email" required error={fieldErrors.email} />
          </Field>
          <Button type="submit" disabled={pending}>{pending ? "Looking…" : "Find booking"}</Button>
        </form>
      </Panel>
    );
  }

  const balance = Math.max(0, booking.price - booking.amountPaid);
  const depositDue = Math.max(0, booking.deposit - booking.amountPaid);
  const canPay = ["pending", "confirmed"].includes(booking.status) && balance > 0 && booking.paymentStatus !== "awaiting_verification";

  function cancel() {
    if (!booking || !confirm("Cancel this appointment? This can't be undone.")) return;
    setError(null);
    start(async () => {
      const result = await cancelBookingAction({ reference: booking.reference, email: booking.email });
      if (result.ok) { setBooking(result.data); setNotice(result.message ?? null); }
      else setError(result.error);
    });
  }

  function pay(formData: FormData) {
    if (!booking) return;
    formData.set("reference", booking.reference);
    formData.set("email", booking.email);
    setError(null); setFieldErrors({});
    start(async () => {
      const result = await submitPaymentAction(formData);
      if (result.ok) { setBooking(result.data); setNotice(result.message ?? null); }
      else { setError(result.error); setFieldErrors(result.fieldErrors ?? {}); }
    });
  }

  return (
    <div className="mt-8 space-y-6">
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Reference</p>
            <p className="font-display text-2xl font-bold tracking-wide">{booking.reference}</p>
          </div>
          <Badge tone={STATUS_TONE[booking.status]}>{humanize(booking.status)}</Badge>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted">Service</dt><dd className="font-medium">{booking.service}</dd></div>
          <div><dt className="text-muted">Dentist</dt><dd className="font-medium">{booking.dentist}</dd></div>
          <div><dt className="text-muted">When</dt><dd className="font-medium">{formatDateTime(booking.startsAt)}</dd></div>
          <div>
            <dt className="text-muted">Payment</dt>
            <dd className="flex flex-wrap items-center gap-2 font-medium">
              {formatPeso(booking.amountPaid)} of {formatPeso(booking.price)}
              <Badge tone={PAYMENT_TONE[booking.paymentStatus]}>{humanize(booking.paymentStatus)}</Badge>
            </dd>
          </div>
        </dl>
        {booking.status === "pending" && booking.expiresAt && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-sun-soft p-3 text-sm">
            Pay the {formatPeso(depositDue)} deposit by {formatDateTime(booking.expiresAt)} or this time is released.
          </p>
        )}
        {booking.paymentStatus === "awaiting_verification" && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-cobalt-soft p-3 text-sm">
            We have your receipt. The clinic is verifying it, and your time stays held meanwhile.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {booking.canCancel && <Button variant="danger" onClick={cancel} disabled={pending}>Cancel appointment</Button>}
          {!booking.canCancel && ["pending", "confirmed"].includes(booking.status) && (
            <p className="text-sm text-muted">Less than 24 hours to go. Call the clinic to cancel or change this booking.</p>
          )}
          <Button variant="ghost" onClick={() => { setBooking(null); setNotice(null); setError(null); }}>Look up another booking</Button>
        </div>
      </Panel>

      {canPay && (
        <Panel>
          <h2 className="text-xl font-bold">Send your payment receipt</h2>
          {paymentInstructions && <p className="mt-2 whitespace-pre-line text-sm text-muted">{paymentInstructions}</p>}
          <form action={pay} className="mt-5 grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Paid with" name="method" error={fieldErrors.method}>
              <Select name="method" defaultValue="gcash">
                <option value="gcash">GCash</option>
                <option value="maya">Maya</option>
                <option value="bank_transfer">Bank transfer</option>
              </Select>
            </Field>
            <Field label="Amount (₱)" name="amount" error={fieldErrors.amount}>
              <Input name="amount" type="number" inputMode="decimal" min="1" step="0.01" max={balance} defaultValue={depositDue || balance} error={fieldErrors.amount} />
            </Field>
            <Field label="Receipt reference number" name="referenceNo" error={fieldErrors.referenceNo}>
              <Input name="referenceNo" required placeholder="e.g. 1009 876 5432" error={fieldErrors.referenceNo} />
            </Field>
            <Field label="Receipt screenshot or PDF" name="proof" error={fieldErrors.proof} hint="JPG, PNG, WebP or PDF, up to 5 MB">
              <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cobalt-soft file:px-3 file:py-2 file:font-semibold file:text-cobalt-dark" />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send receipt"}</Button>
              <p className="mt-2 text-sm text-muted">A person at the clinic checks every receipt before it counts as paid.</p>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
