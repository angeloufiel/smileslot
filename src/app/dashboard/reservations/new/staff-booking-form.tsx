"use client";

import { useState, useTransition } from "react";
import { getSlotsAction, type Slot } from "@/app/actions/booking";
import { createStaffBooking } from "@/app/actions/dashboard";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { formatPeso, formatTime } from "@/lib/format";

type Props = {
  services: { id: string; name: string; duration: number; price: number }[];
  dentists: { id: string; name: string; serviceIds: string[] }[];
  today: string;
};

export function StaffBookingForm({ services, dentists, today }: Props) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const eligible = dentists.filter((d) => d.serviceIds.includes(serviceId));
  const [dentistId, setDentistId] = useState(eligible[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [suggestions, setSuggestions] = useState<Slot[] | null>(null);
  const [loading, start] = useTransition();

  function pickService(id: string) {
    setServiceId(id);
    const next = dentists.filter((d) => d.serviceIds.includes(id));
    if (!next.some((d) => d.id === dentistId)) setDentistId(next[0]?.id ?? "");
    setSuggestions(null);
  }

  function findTimes() {
    start(async () => setSuggestions(await getSlotsAction(serviceId, date, dentistId || undefined)));
  }

  return (
    <ActionForm
      action={async (fd) => {
        fd.set("startsAt", date && time ? new Date(`${date}T${time}:00+08:00`).toISOString() : "");
        return createStaffBooking(fd);
      }}
      className="grid gap-6 xl:grid-cols-2"
    >
      {({ pending, errors }) => (
        <>
          <Panel>
            <h2 className="mb-4 text-lg font-bold">Appointment</h2>
            <div className="space-y-4">
              <Field label="Service" name="serviceId" error={errors.serviceId}>
                <Select name="serviceId" value={serviceId} onChange={(e) => pickService(e.target.value)}>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration} min, {formatPeso(s.price)})</option>)}
                </Select>
              </Field>
              <Field label="Dentist" name="resourceId" error={errors.resourceId}>
                <Select name="resourceId" value={dentistId} onChange={(e) => { setDentistId(e.target.value); setSuggestions(null); }}>
                  {eligible.length === 0 && <option value="">No dentist offers this service</option>}
                  {eligible.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" name="date">
                  <Input name="date" type="date" value={date} min={today} onChange={(e) => { setDate(e.target.value); setSuggestions(null); }} />
                </Field>
                <Field label="Time (clinic time)" name="time" error={errors.startsAt}>
                  <Input name="time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} error={errors.startsAt} />
                </Field>
              </div>
              <div>
                <Button type="button" variant="ghost" onClick={findTimes} disabled={loading || !dentistId}>
                  {loading ? "Checking…" : "Show open online times"}
                </Button>
                {suggestions && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestions.length === 0 && <p className="text-sm text-muted">No open online times that day. You can still enter a time manually.</p>}
                    {suggestions.map((s) => {
                      const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(s.startsAt));
                      return (
                        <button key={s.startsAt} type="button" onClick={() => setTime(hhmm)}
                          className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${time === hhmm ? "bg-cobalt text-white ring-cobalt" : "bg-surface ring-line hover:ring-cobalt"}`}>
                          {formatTime(s.startsAt)}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-2 text-sm text-muted">
                  Staff can book outside online rules (for example, right now for a walk-in). Overlaps with the dentist&apos;s other appointments are always refused.
                </p>
              </div>
              <Field label="Booked via" name="source">
                <Select name="source" defaultValue="walk_in">
                  <option value="walk_in">Walk-in</option>
                  <option value="phone">Phone call</option>
                  <option value="manual">Other</option>
                </Select>
              </Field>
            </div>
          </Panel>

          <Panel>
            <h2 className="mb-4 text-lg font-bold">Patient</h2>
            <div className="space-y-4">
              <Field label="Full name" name="fullName" error={errors.fullName}>
                <Input name="fullName" error={errors.fullName} />
              </Field>
              <Field label="Email" name="email" error={errors.email} hint="Existing patients are matched by email.">
                <Input name="email" type="email" error={errors.email} />
              </Field>
              <Field label="Mobile number" name="phone" error={errors.phone}>
                <Input name="phone" type="tel" error={errors.phone} />
              </Field>
              <Field label="Note from the patient (optional)" name="notes">
                <Textarea name="notes" maxLength={1000} />
              </Field>
              <Button type="submit" disabled={pending || !dentistId}>{pending ? "Booking…" : "Create booking"}</Button>
            </div>
          </Panel>
        </>
      )}
    </ActionForm>
  );
}
