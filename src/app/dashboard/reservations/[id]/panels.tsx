"use client";

import { useState, useTransition } from "react";
import {
  addReservationNote, getProofUrl, recordPayment, rescheduleReservation, reviewPayment,
} from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { ConfirmDialog } from "@/components/dialog";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

export function ProofLink({ paymentId }: { paymentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        className="font-semibold text-cobalt hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const url = await getProofUrl(paymentId); // signed URL, valid for 5 minutes
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            else setError(true);
          })
        }
      >
        {pending ? "Opening…" : "View receipt"}
      </button>
      {error && <span className="ml-2 text-danger">Couldn&apos;t open the file.</span>}
    </>
  );
}

export function ReviewPaymentButtons({ paymentId, amountLabel }: { paymentId: string; amountLabel?: string }) {
  const [asking, setAsking] = useState<"verified" | "rejected" | null>(null);

  async function decide(decision: "verified" | "rejected", reason: string): Promise<string | null> {
    const fd = new FormData();
    fd.set("id", paymentId);
    fd.set("decision", decision);
    if (reason) fd.set("reason", reason);
    const r = await reviewPayment(fd);
    return r.ok ? null : r.error;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => setAsking("verified")}>Verify</Button>
      <Button type="button" variant="danger" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => setAsking("rejected")}>Reject</Button>
      <ConfirmDialog
        open={asking === "verified"}
        onClose={() => setAsking(null)}
        title={`Verify this payment${amountLabel ? ` of ${amountLabel}` : ""}?`}
        message="Only verify after you see the money in the clinic's GCash, Maya or bank app. A screenshot alone isn't proof."
        confirmLabel="Yes, money received"
        onConfirm={(reason) => decide("verified", reason)}
      />
      <ConfirmDialog
        open={asking === "rejected"}
        onClose={() => setAsking(null)}
        title="Reject this payment?"
        message="The patient is emailed so they can send a correct receipt."
        reasonLabel="Reason (the patient will see this)"
        reasonPlaceholder="For example: amount doesn't match, or no transfer found with this reference number"
        confirmLabel="Reject payment"
        tone="danger"
        onConfirm={(reason) => decide("rejected", reason)}
      />
    </div>
  );
}

export function RecordPaymentForm({ reservationId, balance }: { reservationId: string; balance: number }) {
  return (
    <ActionForm action={recordPayment} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      {({ pending, errors }) => (
        <>
          <input type="hidden" name="reservationId" value={reservationId} />
          <Field label="Type" name="kind">
            <Select name="kind" defaultValue="payment">
              <option value="payment">Payment received</option>
              <option value="refund">Refund given</option>
            </Select>
          </Field>
          <Field label="Method" name="method">
            <Select name="method" defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="gcash">GCash</option>
              <option value="maya">Maya</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
            </Select>
          </Field>
          <Field label="Amount (₱)" name="amount" error={errors.amount}>
            <Input name="amount" type="number" min="1" step="0.01" defaultValue={balance > 0 ? balance : undefined} error={errors.amount} />
          </Field>
          <Field label="Receipt / reference no. (optional)" name="referenceNo">
            <Input name="referenceNo" />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Record"}</Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function RescheduleForm({
  reservationId, dentists, currentDentistId, currentLocal,
}: { reservationId: string; dentists: { id: string; name: string }[]; currentDentistId: string; currentLocal: string }) {
  return (
    <ActionForm
      action={async (fd) => {
        const local = String(fd.get("local") ?? "");
        fd.set("startsAt", local ? new Date(`${local}:00+08:00`).toISOString() : "");
        return rescheduleReservation(fd);
      }}
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={reservationId} />
          <Field label="Dentist" name="resourceId">
            <Select name="resourceId" defaultValue={currentDentistId}>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="New date and time (clinic time)" name="local">
            <Input name="local" type="datetime-local" step={900} defaultValue={currentLocal} required />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Moving…" : "Move"}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function NoteForm({ reservationId }: { reservationId: string }) {
  return (
    <ActionForm action={addReservationNote} resetOnSuccess className="space-y-3">
      {({ pending, errors }) => (
        <>
          <input type="hidden" name="id" value={reservationId} />
          <Field label="Add an internal note" name="body" error={errors.body} hint="Only clinic staff can see notes.">
            <Textarea name="body" maxLength={2000} error={errors.body} />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
        </>
      )}
    </ActionForm>
  );
}
