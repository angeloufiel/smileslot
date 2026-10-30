"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createBookingAction, getSlotsAction, type BookingConfirmation, type Slot } from "@/app/actions/booking";
import { Alert, Badge, Button, ButtonLink, cx, Field, Input, Textarea } from "@/components/ui";
import { addDays, clinicDateKey, clinicHour, formatDate, formatDateTime, formatPeso, formatTime } from "@/lib/format";

type ServiceOption = {
  id: string; name: string; description: string | null; category: string;
  duration: number; price: number; deposit: number; requiresApproval: boolean;
};
type DentistOption = { id: string; name: string; title: string | null; serviceIds: string[] };

type Props = {
  services: ServiceOption[];
  dentists: DentistOption[];
  maxAdvanceDays: number;
  paymentInstructions: string | null;
  initial: { serviceId?: string; startsAt?: string; dentistId?: string };
  patient: { fullName: string; email: string } | null;
  signedInAsStaff: boolean;
};

const DAYS_SHOWN = 14;

export function BookingWizard({ services, dentists, maxAdvanceDays, paymentInstructions, initial, patient, signedInAsStaff }: Props) {
  const today = clinicDateKey(new Date());
  const validInitialService = services.some((s) => s.id === initial.serviceId) ? initial.serviceId! : "";

  const [serviceId, setServiceId] = useState(validInitialService);
  const [dentistId, setDentistId] = useState(initial.dentistId && validInitialService ? initial.dentistId : "");
  const [date, setDate] = useState(initial.startsAt ? clinicDateKey(new Date(initial.startsAt)) : validInitialService ? today : "");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [wantedStart] = useState(initial.startsAt ?? null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, startSlots] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [wantedGone, setWantedGone] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const eligibleDentists = useMemo(() => dentists.filter((d) => d.serviceIds.includes(serviceId)), [dentists, serviceId]);
  const days = useMemo(
    () => Array.from({ length: Math.min(DAYS_SHOWN, maxAdvanceDays + 1) }, (_, i) => addDays(today, i)),
    [today, maxAdvanceDays],
  );

  // Load times whenever service, dentist or date changes.
  useEffect(() => {
    if (!serviceId || !date) return;
    startSlots(async () => {
      const result = await getSlotsAction(serviceId, date, dentistId || undefined);
      setSlots(result);
      // Every control clears the selected time before this runs, so the only time to
      // restore is the one picked on the homepage, if it's still open.
      const match = wantedStart
        ? result.find((s) => new Date(s.startsAt).getTime() === new Date(wantedStart).getTime() && (!dentistId || s.resourceId === dentistId)) ?? null
        : null;
      setSlot(match);
      setWantedGone(Boolean(wantedStart && !match && date === clinicDateKey(new Date(wantedStart))));
    });
  }, [serviceId, dentistId, date, wantedStart]);

  function chooseService(id: string) {
    setServiceId(id);
    setSlot(null);
    if (!dentists.find((d) => d.id === dentistId)?.serviceIds.includes(id)) setDentistId("");
    if (!date) setDate(today);
  }

  function submit(formData: FormData) {
    if (!slot || !service) return;
    setFormError(null);
    setErrors({});
    startSubmit(async () => {
      const result = await createBookingAction({
        serviceId: service.id,
        resourceId: slot.resourceId,
        startsAt: slot.startsAt,
        fullName: String(formData.get("fullName") ?? ""),
        email: patient?.email ?? String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        website: String(formData.get("website") ?? ""),
      });
      if (result.ok) {
        setConfirmation(result.data);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setFormError(result.error);
        setErrors(result.fieldErrors ?? {});
        if (result.error.startsWith("That time was just taken")) {
          setSlot(null);
          setSlots((prev) => prev.filter((s) => s.startsAt !== slot.startsAt));
        }
      }
    });
  }

  if (confirmation && service) {
    return <Confirmation c={confirmation} service={service} paymentInstructions={paymentInstructions} />;
  }

  const morning = slots.filter((s) => clinicHour(s.startsAt) < 12);
  const afternoon = slots.filter((s) => clinicHour(s.startsAt) >= 12);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-10">
        {signedInAsStaff && (
          <Alert tone="info">You&apos;re signed in as staff. To book for a patient, use <Link className="underline" href="/dashboard/reservations/new">Dashboard → New booking</Link>.</Alert>
        )}

        <Step n={1} title="Choose a service">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Service">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={serviceId === s.id}
                onClick={() => chooseService(s.id)}
                className={cx(
                  "rounded-[var(--radius-control)] bg-surface p-4 text-left ring-1 transition-colors",
                  serviceId === s.id ? "ring-2 ring-cobalt" : "ring-line hover:ring-ink/30",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold">{s.name}</span>
                  <span className="font-semibold tabular-nums">{formatPeso(s.price)}</span>
                </span>
                <span className="mt-1 block text-sm text-muted">
                  {s.duration} min{s.deposit > 0 && `, ${formatPeso(s.deposit)} deposit`}
                  {s.requiresApproval && ", clinic confirms"}
                </span>
              </button>
            ))}
          </div>
        </Step>

        {service && (
          <Step n={2} title="Choose a dentist">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dentist">
              {[{ id: "", name: "First available", title: "Any dentist who offers this" }, ...eligibleDentists].map((d) => (
                <button
                  key={d.id || "any"}
                  type="button"
                  role="radio"
                  aria-checked={dentistId === d.id}
                  onClick={() => { setDentistId(d.id); setSlot(null); }}
                  className={cx(
                    "rounded-[var(--radius-control)] bg-surface px-4 py-3 text-left ring-1",
                    dentistId === d.id ? "ring-2 ring-cobalt" : "ring-line hover:ring-ink/30",
                  )}
                >
                  <span className="block font-semibold">{d.name}</span>
                  <span className="block text-sm text-muted">{d.title}</span>
                </button>
              ))}
            </div>
          </Step>
        )}

        {service && (
          <Step n={3} title="Pick a date and time">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="radiogroup" aria-label="Date">
              {days.map((d) => {
                const dt = new Date(`${d}T12:00:00+08:00`);
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={date === d}
                    onClick={() => { setDate(d); setSlot(null); }}
                    className={cx(
                      "flex min-w-16 shrink-0 flex-col items-center rounded-[var(--radius-control)] px-3 py-2 ring-1",
                      date === d ? "bg-ink text-white ring-ink" : "bg-surface ring-line hover:ring-ink/30",
                    )}
                  >
                    <span className="text-xs">{d === today ? "Today" : dt.toLocaleDateString("en-PH", { weekday: "short", timeZone: "Asia/Manila" })}</span>
                    <span className="font-display text-xl font-bold">{dt.toLocaleDateString("en-PH", { day: "numeric", timeZone: "Asia/Manila" })}</span>
                    <span className="text-xs">{dt.toLocaleDateString("en-PH", { month: "short", timeZone: "Asia/Manila" })}</span>
                  </button>
                );
              })}
            </div>

            {wantedGone && (
              <div className="mt-4"><Alert tone="warning">The time you picked was just taken or is now too soon to book. Choose another time below.</Alert></div>
            )}
            <div className="mt-4" aria-live="polite">
              {!date ? null : loadingSlots ? (
                <p className="text-sm text-muted">Checking open times…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted">No open times on {formatDate(`${date}T12:00:00+08:00`)}. Try another day{dentistId && " or choose First available"}.</p>
              ) : (
                <div className="space-y-4">
                  {[["Morning", morning], ["Afternoon", afternoon]].map(([label, list]) =>
                    (list as Slot[]).length === 0 ? null : (
                      <div key={label as string}>
                        <p className="mb-2 text-sm font-semibold">{label as string}</p>
                        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${label} times`}>
                          {(list as Slot[]).map((s) => {
                            const selected = slot?.startsAt === s.startsAt && slot.resourceId === s.resourceId;
                            return (
                              <button
                                key={s.startsAt + s.resourceId}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => { setSlot(s); setWantedGone(false); }}
                                className={cx(
                                  "rounded-[var(--radius-control)] px-3 py-2 text-left text-sm ring-1",
                                  selected ? "bg-cobalt text-white ring-cobalt" : "bg-surface ring-line hover:ring-cobalt",
                                )}
                              >
                                <span className="block font-semibold">{formatTime(s.startsAt)}</span>
                                {!dentistId && <span className={cx("block text-xs", selected ? "text-white/80" : "text-muted")}>{s.resourceName}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </Step>
        )}

        {slot && (
          <Step n={4} title="Your details">
            <form action={submit} className="max-w-lg space-y-4" noValidate>
              {formError && <Alert>{formError}</Alert>}
              <Field label="Full name" name="fullName" error={errors.fullName}>
                <Input name="fullName" autoComplete="name" required defaultValue={patient?.fullName} error={errors.fullName} />
              </Field>
              <Field label="Email" name="email" error={errors.email} hint={patient ? "Bookings use your account email." : "We'll send your reference number here."}>
                <Input name="email" type="email" autoComplete="email" required defaultValue={patient?.email} readOnly={Boolean(patient)} error={errors.email} />
              </Field>
              <Field label="Mobile number" name="phone" error={errors.phone}>
                <Input name="phone" type="tel" autoComplete="tel" required placeholder="0917 123 4567" error={errors.phone} />
              </Field>
              <Field label="Anything the dentist should know? (optional)" name="notes" error={errors.notes}>
                <Textarea name="notes" maxLength={1000} placeholder="For example: sensitive lower left tooth" />
              </Field>
              {/* Honeypot field, hidden from people and screen readers */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden">
                <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
              </div>
              <p className="text-sm text-muted">
                We only use your details to manage this appointment. We don&apos;t store medical records online.
              </p>
              <Button type="submit" disabled={submitting || signedInAsStaff} className="w-full sm:w-auto">
                {submitting ? "Booking…" : service?.deposit ? "Book and hold this time" : "Book this time"}
              </Button>
            </form>
          </Step>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line">
          <h2 className="text-lg font-bold">Your appointment</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SummaryRow label="Service" value={service?.name} />
            <SummaryRow label="Dentist" value={slot?.resourceName ?? (dentistId ? dentists.find((d) => d.id === dentistId)?.name : service && "First available")} />
            <SummaryRow label="When" value={slot ? formatDateTime(slot.startsAt) : undefined} />
            {service && <SummaryRow label="Price" value={formatPeso(service.price)} />}
          </dl>
          {service && service.deposit > 0 && (
            <p className="mt-4 rounded-[var(--radius-control)] bg-sun-soft p-3 text-sm text-ink">
              A {formatPeso(service.deposit)} deposit holds your time. You&apos;ll get payment details after booking.
            </p>
          )}
          {service?.requiresApproval && (
            <p className="mt-4 rounded-[var(--radius-control)] bg-cobalt-soft p-3 text-sm">The clinic reviews this request and confirms it by email.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-3 text-xl font-bold">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-ink text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value ?? <span className="text-muted">Not chosen</span>}</dd>
    </div>
  );
}

function Confirmation({ c, service, paymentInstructions }: { c: BookingConfirmation; service: ServiceOption; paymentInstructions: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-[var(--radius-panel)] bg-surface p-6 ring-1 ring-line sm:p-8">
      <Badge tone={c.status === "confirmed" ? "success" : "warning"}>
        {c.status === "confirmed" ? "Confirmed" : c.deposit > 0 ? "Held until the deposit is paid" : "Waiting for clinic approval"}
      </Badge>
      <h2 className="mt-3 text-3xl font-bold">
        {c.status === "confirmed" ? "You're booked." : "We've received your booking."}
      </h2>
      <p className="mt-2 text-muted">{service.name} with {c.dentist}, {formatDateTime(c.startsAt)}.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-canvas p-4">
        <div>
          <p className="text-sm text-muted">Reference number</p>
          <p className="font-display text-2xl font-bold tracking-wide">{c.reference}</p>
        </div>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => navigator.clipboard.writeText(c.reference).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted">Save this number. With your email, it lets you check, pay for or cancel this booking.</p>

      {c.deposit > 0 && (
        <div className="mt-6 rounded-[var(--radius-control)] bg-sun-soft p-4 text-sm">
          <p className="font-semibold">Pay the {formatPeso(c.deposit)} deposit{c.expiresAt && ` by ${formatTime(c.expiresAt)}`}</p>
          {paymentInstructions && <p className="mt-2 whitespace-pre-line">{paymentInstructions}</p>}
          <p className="mt-2">Then open <strong>Find my booking</strong> and upload your receipt. Unpaid holds are released automatically.</p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href={`/track?ref=${c.reference}`}>{c.deposit > 0 ? "Upload my receipt" : "Manage this booking"}</ButtonLink>
        <ButtonLink href="/" variant="secondary">Back to home</ButtonLink>
      </div>
    </div>
  );
}
