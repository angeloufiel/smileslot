"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  addClosure, closeTime, removeClosure, reopenTime, saveWorkingHours, type ClosedResult,
} from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { ConfirmDialog } from "@/components/dialog";
import { Alert, Button, Field, Input, Select, cx } from "@/components/ui";
import { formatDateTime, formatRef } from "@/lib/format";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/* ------------------------------------------------------------------ quick close */

type Part = "morning" | "afternoon" | "day" | "custom";
const PART_LABEL: Record<Part, string> = {
  morning: "Close morning",
  afternoon: "Close afternoon",
  day: "Close whole day",
  custom: "Close these hours",
};

/**
 * One-tap closing for urgent matters: pick the dentist and day, then press
 * Close morning / Close afternoon / Close whole day. Existing bookings in that
 * time are listed so the secretary can call those patients.
 */
export function QuickClose({ dentists, today }: { dentists: { id: string; name: string }[]; today: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [busyPart, setBusyPart] = useState<Part | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ClosedResult | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  function submit(part: Part) {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("part", part);
    setBusyPart(part);
    setError(null);
    setDone(null);
    start(async () => {
      const r = await closeTime(fd);
      setBusyPart(null);
      if (!r.ok) setError(r.error);
      else {
        setDone(r.data);
        const reason = formRef.current?.querySelector<HTMLInputElement>("input[name=reason]");
        if (reason) reason.value = "";
      }
    });
  }

  if (dentists.length === 0) {
    return <Alert tone="warning">Your account isn&apos;t linked to a dentist calendar yet. Ask the clinic owner to link it in Settings &amp; staff.</Alert>;
  }

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); submit("custom"); }} noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        {dentists.length > 1 ? (
          <Field label="Dentist" name="resourceId">
            <Select name="resourceId" id="resourceId" defaultValue={dentists[0].id}>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        ) : (
          <div>
            <p className="mb-1.5 text-sm font-medium">Dentist</p>
            <p className="flex min-h-11 items-center font-semibold">{dentists[0].name}</p>
            <input type="hidden" name="resourceId" value={dentists[0].id} />
          </div>
        )}
        <Field label="Day" name="date"><Input id="date" name="date" type="date" defaultValue={today} min={today} required /></Field>
        <Field label="Reason (only staff see this)" name="reason"><Input id="reason" name="reason" placeholder="Urgent meeting" maxLength={200} /></Field>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {(["morning", "afternoon", "day"] as const).map((part) => (
          <button
            key={part}
            type="button"
            disabled={pending}
            onClick={() => submit(part)}
            className={cx(
              "flex min-h-16 flex-col items-center justify-center rounded-[var(--radius-control)] px-4 py-3 text-center font-semibold ring-1 transition disabled:opacity-60",
              part === "day" ? "bg-danger text-white ring-danger hover:brightness-95" : "bg-surface text-ink ring-line hover:bg-danger-soft hover:ring-danger",
            )}
          >
            <span>{busyPart === part ? "Closing…" : PART_LABEL[part]}</span>
            <span className={cx("text-xs font-normal", part === "day" ? "text-white/85" : "text-muted")}>
              {part === "morning" ? "until 12:00 noon" : part === "afternoon" ? "from 12:00 noon" : "no bookings at all that day"}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <button type="button" onClick={() => setShowCustom((v) => !v)} aria-expanded={showCustom}
          className="text-sm font-semibold text-cobalt hover:underline">
          {showCustom ? "Hide other times" : "Close other hours instead (for example 2:00 to 3:30 PM)"}
        </button>
        {showCustom && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="From" name="from"><Input id="from" name="from" type="time" step={900} /></Field>
            <Field label="To" name="to"><Input id="to" name="to" type="time" step={900} /></Field>
            <Button type="submit" variant="danger" disabled={pending}>{busyPart === "custom" ? "Closing…" : PART_LABEL.custom}</Button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="mt-4 space-y-3">
        {error && <Alert>{error}</Alert>}
        {done && (
          <>
            <Alert tone="success">{done.label}</Alert>
            {done.affected.length > 0 && (
              <div className="rounded-[var(--radius-control)] bg-sun-soft p-4 ring-1 ring-sun">
                <p className="font-semibold">
                  {done.affected.length === 1 ? "1 patient is" : `${done.affected.length} patients are`} already booked in that time.
                </p>
                <p className="text-sm">Their bookings were not cancelled. Call them to move or cancel the appointment.</p>
                <ul className="mt-2 divide-y divide-sun/40 text-sm">
                  {done.affected.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span><span className="font-semibold">{a.name}</span> · {formatDateTime(a.startsAt)} · <a className="text-cobalt hover:underline" href={`tel:${a.phone}`}>{a.phone}</a></span>
                      <Link href={`/dashboard/reservations/${a.id}`} className="font-semibold text-cobalt hover:underline">Open booking {formatRef(a.ref)}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </form>
  );
}

export function ReopenButton({ id, what, kind }: { id: string; what: string; kind: "time" | "clinic" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className="min-h-9 px-3 text-sm" onClick={() => setOpen(true)}>Reopen</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reopen this time?"
        message={`${what}. Patients will be able to book it online again.`}
        confirmLabel="Yes, reopen"
        onConfirm={async () => {
          if (kind === "time") {
            const r = await reopenTime(id);
            return r.ok ? null : r.error;
          }
          const fd = new FormData();
          fd.set("id", id);
          const r = await removeClosure(fd);
          return r.ok ? null : r.error;
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ weekly hours */

type Block = { weekday: number; start_time: string; end_time: string };
type DayState = { open: boolean; am: [string, string]; pm: [string, string] };

function initialDays(hours: Block[]): Record<number, DayState> {
  const out: Record<number, DayState> = {};
  for (let d = 0; d <= 6; d++) {
    const b = hours.filter((h) => h.weekday === d).sort((a, c) => a.start_time.localeCompare(c.start_time));
    out[d] = {
      open: b.length > 0,
      am: [b[0]?.start_time.slice(0, 5) ?? "09:00", b[0]?.end_time.slice(0, 5) ?? "12:00"],
      pm: [b[1]?.start_time.slice(0, 5) ?? (b.length ? "" : "13:00"), b[1]?.end_time.slice(0, 5) ?? (b.length ? "" : "17:00")],
    };
  }
  return out;
}

export function HoursForm({ resourceId, hours }: { resourceId: string; hours: Block[] }) {
  const [days, setDays] = useState(() => initialDays(hours));
  const set = (d: number, patch: Partial<DayState>) => setDays((s) => ({ ...s, [d]: { ...s[d], ...patch } }));
  const time = "w-[7.5rem] rounded-lg border border-line bg-surface px-2 py-2";

  return (
    <ActionForm action={saveWorkingHours}>
      {({ pending }) => (
        <>
          <input type="hidden" name="resourceId" value={resourceId} />
          <ul className="divide-y divide-line">
            {ORDER.map((d) => {
              const day = days[d];
              return (
                <li key={d} className="grid gap-3 py-3 md:grid-cols-[10rem_minmax(0,1fr)] md:items-center">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={day.open}
                      onChange={(e) => set(d, { open: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span aria-hidden className={cx("relative h-6 w-11 shrink-0 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt", day.open ? "bg-mint" : "bg-line")}>
                      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", day.open ? "left-[1.375rem]" : "left-0.5")} />
                    </span>
                    <span>
                      <span className="block font-semibold">{DAYS[d]}</span>
                      <span className={cx("block text-xs", day.open ? "text-mint" : "text-muted")}>{day.open ? "Open" : "Closed"}</span>
                    </span>
                  </label>
                  {day.open ? (
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      {(["am", "pm"] as const).map((k, i) => (
                        <span key={k} className="flex items-center gap-2">
                          <span className="w-16 text-muted">{k === "am" ? "Morning" : "Afternoon"}</span>
                          <input aria-label={`${DAYS[d]} ${k === "am" ? "morning" : "afternoon"} start`} type="time" step={900}
                            name={`start_${d}_${i}`} value={day[k][0]} onChange={(e) => set(d, { [k]: [e.target.value, day[k][1]] })} className={time} />
                          <span aria-hidden>to</span>
                          <input aria-label={`${DAYS[d]} ${k === "am" ? "morning" : "afternoon"} end`} type="time" step={900}
                            name={`end_${d}_${i}`} value={day[k][1]} onChange={(e) => set(d, { [k]: [day[k][0], e.target.value] })} className={time} />
                          {k === "pm" && (day.pm[0] || day.pm[1]) && (
                            <button type="button" className="text-xs text-muted hover:text-danger hover:underline" onClick={() => set(d, { pm: ["", ""] })}>
                              No afternoon
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Day off. No bookings are offered.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-sm text-muted">The gap between morning and afternoon is lunch break. To close just one day for something urgent, use “Close time” above instead.</p>
          <Button type="submit" className="mt-3" disabled={pending}>{pending ? "Saving…" : "Save weekly hours"}</Button>
        </>
      )}
    </ActionForm>
  );
}

/* ------------------------------------------------------------------ clinic holidays */

export function ClosureForm({ today }: { today: string }) {
  return (
    <ActionForm action={addClosure} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      {({ pending, errors }) => (
        <>
          <Field label="Date" name="closure-date" error={errors.date}><Input id="closure-date" name="date" type="date" min={today} required /></Field>
          <Field label="Reason" name="closure-reason"><Input id="closure-reason" name="reason" placeholder="Holiday" /></Field>
          <Button type="submit" variant="danger" disabled={pending}>{pending ? "Closing…" : "Close the whole clinic"}</Button>
        </>
      )}
    </ActionForm>
  );
}
