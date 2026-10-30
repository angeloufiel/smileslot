"use client";

import { useState } from "react";
import { saveSettings, setUserRole } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { AppRole, ClinicSettings } from "@/lib/types";

export function SettingsForm({ s }: { s: ClinicSettings }) {
  return (
    <ActionForm action={saveSettings} className="grid gap-4 md:grid-cols-2">
      {({ pending, errors }) => (
        <>
          <Field label="Clinic name" name="name" error={errors.name}><Input name="name" defaultValue={s.name} error={errors.name} /></Field>
          <Field label="Tagline" name="tagline"><Input name="tagline" defaultValue={s.tagline ?? ""} /></Field>
          <Field label="Email" name="email" error={errors.email}><Input name="email" type="email" defaultValue={s.email ?? ""} error={errors.email} /></Field>
          <Field label="Phone" name="phone"><Input name="phone" defaultValue={s.phone ?? ""} /></Field>
          <div className="md:col-span-2"><Field label="Address" name="address"><Input name="address" defaultValue={s.address ?? ""} /></Field></div>

          <h3 className="pt-2 font-semibold md:col-span-2">Booking rules</h3>
          <Field label="Time slot every (min)" name="slotInterval" error={errors.slotInterval}><Input name="slotInterval" type="number" min={5} max={120} defaultValue={s.slot_interval_minutes} /></Field>
          <Field label="Minimum notice (min)" name="minNotice" hint="How soon patients can book online"><Input name="minNotice" type="number" min={0} defaultValue={s.min_notice_minutes} /></Field>
          <Field label="Book up to (days ahead)" name="maxAdvance"><Input name="maxAdvance" type="number" min={1} max={365} defaultValue={s.max_advance_days} /></Field>
          <Field label="Online cancellation until (hours before)" name="cutoff"><Input name="cutoff" type="number" min={0} defaultValue={s.cancellation_cutoff_hours} /></Field>
          <Field label="Hold unpaid deposit bookings for (min)" name="expiry"><Input name="expiry" type="number" min={5} defaultValue={s.pending_expiry_minutes} /></Field>
          <label className="flex items-center gap-2 self-end pb-3 text-sm">
            <input type="checkbox" name="autoConfirm" defaultChecked={s.auto_confirm} className="h-4 w-4 accent-cobalt" />
            Confirm bookings automatically when no deposit or approval is needed
          </label>

          <h3 className="pt-2 font-semibold md:col-span-2">What patients read</h3>
          <div className="md:col-span-2"><Field label="Before your visit" name="bookingPolicy"><Textarea name="bookingPolicy" defaultValue={s.booking_policy ?? ""} /></Field></div>
          <div className="md:col-span-2"><Field label="Cancellation policy" name="cancellationPolicy"><Textarea name="cancellationPolicy" defaultValue={s.cancellation_policy ?? ""} /></Field></div>
          <div className="md:col-span-2"><Field label="Payment instructions (GCash, Maya, bank)" name="paymentInstructions"><Textarea name="paymentInstructions" defaultValue={s.payment_instructions ?? ""} /></Field></div>
          <p className="text-sm text-muted md:col-span-2">Time zone: {s.timezone}. Currency: {s.currency}.</p>
          <div className="md:col-span-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div>
        </>
      )}
    </ActionForm>
  );
}

export function RoleForm({
  userId, role, resourceId, dentists, isSelf,
}: { userId: string; role: AppRole; resourceId: string | null; dentists: { id: string; name: string }[]; isSelf: boolean }) {
  const [current, setCurrent] = useState<AppRole>(role);
  return (
    <ActionForm action={setUserRole} className="flex flex-wrap items-end gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="userId" value={userId} />
          <div className="w-40">
            <Select name="role" aria-label="Role" value={current} onChange={(e) => setCurrent(e.target.value as AppRole)}>
              <option value="patient">Patient</option>
              <option value="dentist">Dentist</option>
              <option value="secretary">Secretary</option>
              <option value="owner">Owner</option>
            </Select>
          </div>
          {current === "dentist" && (
            <div className="w-48">
              <Select name="resourceId" aria-label="Dentist calendar" defaultValue={resourceId ?? ""}>
                <option value="">Choose calendar…</option>
                {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
          )}
          <Button type="submit" variant="secondary" disabled={pending || (isSelf && current !== "owner")}>Save</Button>
        </>
      )}
    </ActionForm>
  );
}
