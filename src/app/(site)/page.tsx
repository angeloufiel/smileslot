import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, Skeleton } from "@/components/ui";
import { CareGallery } from "@/components/care-gallery";
import { getClinic, getDentists, getNextOpenSlots, getServices, getWorkingHours } from "@/lib/data/public";
import { formatPeso, formatTime } from "@/lib/format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div className="max-w-xl">
            <h1 className="text-4xl font-extrabold sm:text-5xl">
              See a real open time. Book it in under a minute.
            </h1>
            <p className="mt-4 text-lg text-muted">
              Check-ups, cleanings, fillings and more. No calling, no waiting for a reply on Messenger.
              Book as a guest; you don&apos;t need an account.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/book">Book an appointment</ButtonLink>
              <ButtonLink href="/track" variant="secondary">Find my booking</ButtonLink>
            </div>
          </div>
          <Suspense fallback={<HeroSlotsSkeleton />}>
            <HeroSlots />
          </Suspense>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6">
        <Suspense fallback={<Skeleton className="h-80" />}>
          <Gallery />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <ServicesSection />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-48" />}>
          <TeamAndVisit />
        </Suspense>
      </div>
    </>
  );
}

/* The signature element: the clinic's actual next open check-up times. */
async function HeroSlots() {
  const services = await getServices();
  const checkup = services.find((s) => s.slug === "consultation") ?? services[0];
  if (!checkup) return null;
  const slots = await getNextOpenSlots(checkup.id, 6);

  // Group chips by clinic-local day
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const day = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "long", month: "short", day: "numeric" }).format(new Date(s.slot_start));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }

  return (
    <div className="rounded-[var(--radius-panel)] bg-canvas p-5 ring-1 ring-line sm:p-6">
      <h2 className="text-xl font-bold">Next open check-up times</h2>
      <p className="mt-1 text-sm text-muted">
        {checkup.name}, {checkup.duration_minutes} minutes, {formatPeso(checkup.price)}. Tap a time to book it.
      </p>
      {slots.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No open times in the next few days. <Link className="text-cobalt underline" href="/book">Pick a later date</Link>.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {[...byDay.entries()].map(([day, daySlots], d) => (
            <div key={day}>
              <p className="mb-2 text-sm font-semibold">{day}</p>
              <ul className="flex flex-wrap gap-2">
                {daySlots.map((s, i) => (
                  <li key={s.slot_start} className="chip-in" style={{ animationDelay: `${(d * 3 + i) * 60}ms` }}>
                    <Link
                      href={`/book?service=${checkup.id}&start=${encodeURIComponent(s.slot_start)}&dentist=${s.resource_id}`}
                      className="inline-flex flex-col rounded-[var(--radius-control)] bg-surface px-4 py-2.5 ring-1 ring-line transition-colors hover:ring-cobalt"
                    >
                      <span className="font-display text-lg font-bold">{formatTime(s.slot_start)}</span>
                      <span className="text-xs text-muted">{s.resource_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeroSlotsSkeleton() {
  return (
    <div className="rounded-[var(--radius-panel)] bg-canvas p-6 ring-1 ring-line">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="mt-3 h-4 w-72" />
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-24" />)}
      </div>
    </div>
  );
}

async function Gallery() {
  const services = await getServices();
  return <CareGallery services={services} />;
}

async function ServicesSection() {
  const services = await getServices();
  const groups = new Map<string, typeof services>();
  for (const s of services) {
    const key = s.category?.name ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <section aria-labelledby="services-title">
      <h2 id="services-title" className="text-2xl font-bold sm:text-3xl">Services and prices</h2>
      <p className="mt-1 text-muted">Prices are starting rates. Your dentist confirms the final cost before treatment.</p>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {[...groups.entries()].map(([category, items]) => (
          <div key={category}>
            <h3 className="border-b border-line pb-2 text-lg font-bold">{category}</h3>
            <ul className="divide-y divide-line">
              {items.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-sm text-muted">
                      {s.duration_minutes} min
                      {Number(s.deposit_amount) > 0 && `, ${formatPeso(s.deposit_amount)} deposit`}
                      {s.requires_approval && ", confirmed by the clinic"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold tabular-nums">{formatPeso(s.price)}</span>
                    <Link href={`/book?service=${s.id}`} className="text-sm font-semibold text-cobalt hover:underline">
                      Book<span className="sr-only"> {s.name}</span>
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

async function TeamAndVisit() {
  const [dentists, hours, clinic] = await Promise.all([getDentists(), getWorkingHours(), getClinic()]);
  return (
    <div className="grid gap-10 md:grid-cols-2">
      {dentists.length > 0 && (
      <section aria-labelledby="team-title">
        <h2 id="team-title" className="text-2xl font-bold">Our dentists</h2>
        <ul className="mt-4 space-y-4">
          {dentists.map((d) => {
            const days = [...new Set(hours.filter((h) => h.resource_id === d.id).map((h) => h.weekday))].sort();
            return (
              <li key={d.id} className="flex gap-4">
                <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-cobalt-soft font-display font-bold text-cobalt-dark">
                  {d.name.replace("Dr. ", "").split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </span>
                <div>
                  <p className="font-semibold">{d.name}</p>
                  <p className="text-sm text-muted">{d.title}{days.length > 0 && `, in clinic ${days.map((n) => WEEKDAYS[n]).join(", ")}`}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      )}
      {clinic && (
        <section aria-labelledby="visit-title">
          <h2 id="visit-title" className="text-2xl font-bold">Visiting the clinic</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {clinic.address && <div><dt className="font-semibold">Address</dt><dd className="text-muted">{clinic.address}</dd></div>}
            {clinic.phone && <div><dt className="font-semibold">Phone</dt><dd className="text-muted">{clinic.phone}</dd></div>}
            {clinic.booking_policy && <div><dt className="font-semibold">Before your visit</dt><dd className="text-muted">{clinic.booking_policy}</dd></div>}
            {clinic.cancellation_policy && <div><dt className="font-semibold">Cancelling</dt><dd className="text-muted">{clinic.cancellation_policy}</dd></div>}
          </dl>
        </section>
      )}
    </div>
  );
}
