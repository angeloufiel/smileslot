import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getReservationsBetween, getStaffDentists, todayKey } from "@/lib/data/dashboard";
import { addDays, formatTime, humanize } from "@/lib/format";

export const metadata = { title: "Calendar" };

const START_HOUR = 8;
const END_HOUR = 19;
const HOUR_PX = 64;
const DENTIST_COLORS = [
  "bg-cobalt-soft ring-cobalt/40 text-cobalt-dark",
  "bg-mint-soft ring-mint/40 text-mint",
  "bg-sun-soft ring-sun/40 text-sun",
];

export default function CalendarPage({ searchParams }: PageProps<"/dashboard/calendar">) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem]" />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

function mondayOf(key: string) {
  const dow = new Date(`${key}T12:00:00+08:00`).getUTCDay(); // noon Manila is still the same date in UTC
  return addDays(key, -((dow + 6) % 7));
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/dashboard/calendar">["searchParams"] }) {
  const user = await requireStaff("/dashboard/calendar");
  const params = await searchParams;
  const requested = typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : todayKey();
  const monday = mondayOf(requested);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const [items, dentists] = await Promise.all([
    getReservationsBetween(new Date(`${monday}T00:00:00+08:00`).toISOString(), new Date(`${addDays(monday, 7)}T00:00:00+08:00`).toISOString()),
    getStaffDentists(),
  ]);
  const visible = items.filter((r) => !["cancelled", "rejected", "expired"].includes(r.status));
  const colorOf = (id?: string) => DENTIST_COLORS[Math.max(0, dentists.findIndex((d) => d.id === id)) % DENTIST_COLORS.length];
  const today = todayKey();
  const label = (k: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts }).format(new Date(`${k}T12:00:00+08:00`));

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Week of ${label(monday, { month: "long", day: "numeric", year: "numeric" })}`}
        actions={
          <>
            <ButtonLink variant="secondary" href={`/dashboard/calendar?week=${addDays(monday, -7)}`}>Previous week</ButtonLink>
            <ButtonLink variant="secondary" href="/dashboard/calendar">This week</ButtonLink>
            <ButtonLink variant="secondary" href={`/dashboard/calendar?week=${addDays(monday, 7)}`}>Next week</ButtonLink>
          </>
        }
      />

      {user.role !== "dentist" && (
        <ul className="mb-4 flex flex-wrap gap-3 text-sm" aria-label="Dentist colours">
          {dentists.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded-full ring-1 ${colorOf(d.id)}`} aria-hidden />{d.name}
            </li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}>
          <div className="border-b border-line" />
          {days.map((d) => (
            <div key={d} className={`border-b border-l border-line px-2 py-2 text-center text-sm ${d === today ? "bg-cobalt-soft" : ""}`}>
              <span className="block text-muted">{label(d, { weekday: "short" })}</span>
              <span className="font-display text-lg font-bold">{label(d, { day: "numeric" })}</span>
            </div>
          ))}

          <div className="relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
            {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-2 text-xs text-muted" style={{ top: i * HOUR_PX }}>
                {((START_HOUR + i + 11) % 12) + 1}{START_HOUR + i < 12 ? "am" : "pm"}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const dayItems = visible.filter((r) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(r.starts_at)) === d);
            // One lane per dentist working that day, so overlapping appointments sit side by side.
            const lanesFor = dentists.map((x) => x.id).filter((id) => dayItems.some((r) => r.dentist?.id === id));
            return (
              <div key={d} className="relative border-l border-line" style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}>
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                ))}
                {dayItems.map((r) => {
                  const lanes = Math.max(1, lanesFor.length);
                  const lane = Math.max(0, lanesFor.indexOf(r.dentist?.id ?? ""));
                  const start = new Date(r.starts_at);
                  const minutes = (start.getTime() - new Date(`${d}T${String(START_HOUR).padStart(2, "0")}:00:00+08:00`).getTime()) / 60000;
                  const length = (new Date(r.ends_at).getTime() - start.getTime()) / 60000;
                  return (
                    <Link
                      key={r.id}
                      href={`/dashboard/reservations/${r.id}`}
                      className={`absolute overflow-hidden rounded-md px-1.5 py-1 text-xs leading-tight ring-1 hover:z-10 hover:shadow-md ${colorOf(r.dentist?.id)} ${r.status === "pending" ? "border-l-4 border-sun" : ""}`}
                      style={{
                        top: Math.max(0, minutes) * (HOUR_PX / 60),
                        height: Math.max(22, length * (HOUR_PX / 60) - 2),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      }}
                      title={`${formatTime(r.starts_at)} ${r.contact_name}, ${r.service?.name} (${humanize(r.status)})`}
                    >
                      <span className="block truncate font-semibold">{length >= 30 ? formatTime(r.starts_at) : r.contact_name}</span>
                      {length >= 30 && <span className="block truncate">{r.contact_name}</span>}
                      {length >= 60 && <span className="block truncate opacity-80">{r.service?.name}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">A yellow edge means the booking is still pending. Cancelled, rejected and expired bookings are hidden.</p>
    </>
  );
}
