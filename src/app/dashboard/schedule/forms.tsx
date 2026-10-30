"use client";

import { useTransition } from "react";
import { addClosure, addTimeOff, removeClosure, saveWorkingHours } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input } from "@/components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first

type Block = { weekday: number; start_time: string; end_time: string };

export function HoursForm({ resourceId, hours }: { resourceId: string; hours: Block[] }) {
  const blocks = (day: number) =>
    hours.filter((h) => h.weekday === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
  return (
    <ActionForm action={saveWorkingHours}>
      {({ pending }) => (
        <>
          <input type="hidden" name="resourceId" value={resourceId} />
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th scope="col" className="py-2 font-medium">Day</th><th scope="col" className="py-2 font-medium">Morning block</th><th scope="col" className="py-2 font-medium">Afternoon block</th></tr>
            </thead>
            <tbody>
              {ORDER.map((day) => {
                const b = blocks(day);
                return (
                  <tr key={day} className="border-t border-line">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{DAYS[day]}</th>
                    {[0, 1].map((i) => (
                      <td key={i} className="py-2 pr-3">
                        <span className="flex items-center gap-1">
                          <input aria-label={`${DAYS[day]} block ${i + 1} start`} type="time" step={900} name={`start_${day}_${i}`} defaultValue={b[i]?.start_time.slice(0, 5)} className="rounded-md border border-line px-2 py-1.5" />
                          <span aria-hidden>to</span>
                          <input aria-label={`${DAYS[day]} block ${i + 1} end`} type="time" step={900} name={`end_${day}_${i}`} defaultValue={b[i]?.end_time.slice(0, 5)} className="rounded-md border border-line px-2 py-1.5" />
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-muted">Leave both times empty for a day off. The gap between blocks is a break; no bookings are offered then.</p>
          <Button type="submit" className="mt-3" disabled={pending}>{pending ? "Saving…" : "Save hours"}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function TimeOffForm({ resourceId }: { resourceId: string }) {
  return (
    <ActionForm action={addTimeOff} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      {({ pending }) => (
        <>
          <input type="hidden" name="resourceId" value={resourceId} />
          <Field label="From" name="from"><Input name="from" type="datetime-local" required /></Field>
          <Field label="To" name="to"><Input name="to" type="datetime-local" required /></Field>
          <Field label="Reason (staff only)" name="reason"><Input name="reason" placeholder="Seminar" /></Field>
          <Button type="submit" variant="secondary" disabled={pending}>Add</Button>
        </>
      )}
    </ActionForm>
  );
}

export function ClosureForm() {
  return (
    <ActionForm action={addClosure} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      {({ pending, errors }) => (
        <>
          <Field label="Date" name="date" error={errors.date}><Input name="date" type="date" required /></Field>
          <Field label="Reason" name="reason"><Input name="reason" placeholder="Holiday" /></Field>
          <Button type="submit" variant="secondary" disabled={pending}>Close this day</Button>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveClosureButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-sm font-semibold text-danger hover:underline"
      onClick={() => start(async () => { const fd = new FormData(); fd.set("id", id); await removeClosure(fd); })}
    >
      Reopen
    </button>
  );
}
