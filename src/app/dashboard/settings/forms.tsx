"use client";

import { useState, useTransition } from "react";
import { addStaff, saveSettings, updateStaff, type NewStaff } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Dialog } from "@/components/dialog";
import { Alert, Button, Field, Input, Select, Textarea, cx } from "@/components/ui";
import { humanize } from "@/lib/format";
import type { ActionResult, AppRole, ClinicSettings } from "@/lib/types";

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

type Calendar = { id: string; name: string; profile_id: string | null };
export type Person = { id: string; full_name: string; email: string; role: AppRole; calendarId: string | null; calendarTitle: string | null };

const ROLE_HELP: Record<AppRole, string> = {
  owner: "Everything, including settings, staff and the audit log.",
  secretary: "Front desk: bookings, payments, patients, services and schedule.",
  dentist: "Sees their own appointments and can close their own time.",
  patient: "No dashboard access. Can book and see their own bookings.",
};

function RoleAndCalendar({
  role, setRole, calendar, setCalendar, calendars, personId, errors, title, allowPatient, lockOwner,
}: {
  role: AppRole; setRole: (r: AppRole) => void; calendar: string; setCalendar: (c: string) => void;
  calendars: Calendar[]; personId: string | null; errors: Record<string, string>; title: string;
  allowPatient: boolean; lockOwner: boolean;
}) {
  const free = calendars.filter((c) => !c.profile_id || c.profile_id === personId);
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Role</legend>
        <div className="grid gap-2">
          {(["secretary", "dentist", "owner", ...(allowPatient ? ["patient"] as const : [])] as AppRole[]).map((r) => (
            <label key={r} className={cx(
              "flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] p-3 ring-1",
              role === r ? "bg-cobalt-soft ring-cobalt" : "ring-line hover:bg-canvas",
              lockOwner && r !== "owner" && "cursor-not-allowed opacity-50",
            )}>
              <input type="radio" name="role" value={r} checked={role === r} disabled={lockOwner && r !== "owner"}
                onChange={() => setRole(r)} className="mt-1 h-4 w-4 accent-cobalt" />
              <span><span className="block font-semibold">{humanize(r)}</span><span className="block text-sm text-muted">{ROLE_HELP[r]}</span></span>
            </label>
          ))}
        </div>
        {lockOwner && <p className="mt-1.5 text-sm text-muted">You can&apos;t remove your own owner role.</p>}
      </fieldset>
      {role === "dentist" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Calendar" name="calendar" error={errors.calendar} hint="Where their appointments go">
            <Select name="calendar" value={calendar} onChange={(e) => setCalendar(e.target.value)} error={errors.calendar}>
              <option value="">Choose…</option>
              <option value="new">Create a new calendar</option>
              {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Title shown to patients" name="title"><Input name="title" defaultValue={title} placeholder="General Dentist" maxLength={120} /></Field>
        </div>
      )}
    </>
  );
}

export function AddStaffButton({ calendars }: { calendars: Calendar[] }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole>("dentist");
  const [calendar, setCalendar] = useState("new");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<NewStaff> | null>(null);
  const [copied, setCopied] = useState(false);

  function close() {
    if (pending) return;
    setOpen(false);
    setResult(null);
    setCopied(false);
    setRole("dentist");
    setCalendar("new");
  }
  const errors = result && !result.ok ? result.fieldErrors ?? {} : {};
  const done = result?.ok ? result.data : null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add staff member</Button>
      <Dialog open={open} onClose={close} title={done ? "Account created" : "Add a staff member"} wide>
        {done ? (
          <div className="space-y-4">
            <p>Give these sign-in details to <strong>{done.name}</strong>. They should change the password in <em>My account</em> after signing in.</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-[var(--radius-control)] bg-canvas p-4 ring-1 ring-line">
              <dt className="text-muted">Email</dt><dd className="font-semibold break-all">{done.email}</dd>
              <dt className="text-muted">Password</dt><dd className="font-mono text-lg font-bold tracking-wider">{done.password}</dd>
            </dl>
            <Alert tone="warning">This password is shown only once. Copy it now.</Alert>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={async () => {
                try { await navigator.clipboard.writeText(`Email: ${done.email}\nPassword: ${done.password}`); setCopied(true); } catch { setCopied(false); }
              }}>{copied ? "Copied" : "Copy details"}</Button>
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            noValidate
            className="space-y-4"
            action={(fd) => start(async () => setResult(await addStaff(fd)))}
          >
            {result && !result.ok && <Alert>{result.error}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" error={errors.fullName}><Input name="fullName" placeholder="Dr. Liza Mercado" required error={errors.fullName} autoComplete="off" /></Field>
              <Field label="Email (used to sign in)" name="email" error={errors.email}><Input name="email" type="email" required error={errors.email} autoComplete="off" /></Field>
            </div>
            <RoleAndCalendar role={role} setRole={setRole} calendar={calendar} setCalendar={setCalendar} calendars={calendars}
              personId={null} errors={errors} title="" allowPatient={false} lockOwner={false} />
            <p className="text-sm text-muted">We&apos;ll make a temporary password for you to give them. New dentists get every service; change that in Services and set their hours in Schedule.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create account"}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function EditPersonButton({ person, calendars, isSelf }: { person: Person; calendars: Calendar[]; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<AppRole>(person.role);
  const [calendar, setCalendar] = useState(person.calendarId ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setResult(null);
    setRole(person.role);
    setCalendar(person.calendarId ?? "");
  }
  const errors = result && !result.ok ? result.fieldErrors ?? {} : {};

  return (
    <>
      <Button variant="secondary" className="min-h-9 px-3 text-sm" onClick={() => setOpen(true)}>Edit</Button>
      <Dialog open={open} onClose={close} title={`Edit ${person.full_name || person.email}`} wide>
        <form
          noValidate
          className="space-y-4"
          action={(fd) => start(async () => {
            const r = await updateStaff(fd);
            setResult(r);
            if (r.ok) setOpen(false);
          })}
        >
          <input type="hidden" name="userId" value={person.id} />
          {result && !result.ok && <Alert>{result.error}</Alert>}
          <Field label="Full name" name="fullName" error={errors.fullName}>
            <Input name="fullName" defaultValue={person.full_name} required error={errors.fullName} autoComplete="off" />
          </Field>
          <p className="text-sm text-muted">Email: {person.email || "unknown"}</p>
          <RoleAndCalendar role={role} setRole={setRole} calendar={calendar} setCalendar={setCalendar} calendars={calendars}
            personId={person.id} errors={errors} title={person.calendarTitle ?? ""} allowPatient lockOwner={isSelf} />
          {role !== person.role && (
            <Alert tone="warning">
              {person.full_name || "This person"} will change from {humanize(person.role)} to {humanize(role)}.
              {role === "patient" && " They will lose access to the dashboard."}
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
