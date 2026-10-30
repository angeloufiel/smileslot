import { Suspense } from "react";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui";
import { isFrontDesk, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, parseRange, todayIsoDate } from "./util";
import { ClosureForm, HoursForm, QuickClose, ReopenButton } from "./forms";

export const metadata = { title: "Schedule" };

export default function SchedulePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Schedule />
    </Suspense>
  );
}

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila" }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso));

/** "Monday, November 9, morning" rather than "12:00 AM to 12:00 PM". */
function describe(from: string, to: string) {
  const a = hhmm(from);
  const b = hhmm(to);
  const endDay = day(new Date(new Date(to).getTime() - 1).toISOString());
  if (day(from) === endDay) {
    if (a === "00:00" && b === "12:00") return `${day(from)}, morning`;
    if (a === "12:00" && b === "00:00") return `${day(from)}, afternoon`;
    if (a === "00:00" && b === "00:00") return `${day(from)}, whole day`;
    return `${day(from)}, ${time(from)} to ${time(to)}`;
  }
  return `${day(from)} ${time(from)} to ${day(to)} ${time(to)}`;
}

async function Schedule() {
  const user = await requireStaff("/dashboard/schedule");
  const frontDesk = isFrontDesk(user.role);
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [{ data: allDentists }, { data: hours }, { data: timeOff }, { data: closures }] = await Promise.all([
    supabase.from("resources").select("id, name, title, profile_id").eq("type", "dentist").eq("is_active", true).order("name"),
    supabase.from("working_hours").select("resource_id, weekday, start_time, end_time"),
    supabase.from("resource_time_off").select("id, resource_id, period, reason"),
    supabase.from("clinic_closures").select("id, closed_on, reason").gte("closed_on", todayIsoDate()).order("closed_on"),
  ]);

  // Front desk can close anyone's time; a dentist only their own calendar (RLS enforces the same rule).
  const dentists = (allDentists ?? []).filter((d) => frontDesk || d.profile_id === user.id);
  const mine = new Set(dentists.map((d) => d.id));
  const nameOf = new Map((allDentists ?? []).map((d) => [d.id, d.name]));

  const upcoming = (timeOff ?? [])
    .map((t) => { const [from, to] = parseRange(t.period); return { ...t, from, to }; })
    .filter((t) => t.to > nowIso && (frontDesk || mine.has(t.resource_id)))
    .sort((a, b) => a.from.localeCompare(b.from));

  return (
    <>
      <PageHeader
        title={frontDesk ? "Schedule" : "My schedule"}
        description="Close time when something urgent comes up. Online booking only offers times that are open."
      />
      <div className="space-y-6">
        <Panel>
          <h2 className="text-lg font-bold">Close time</h2>
          <p className="mb-4 text-sm text-muted">For an urgent meeting, emergency or personal matter. Patients won&apos;t be able to book that time online.</p>
          <QuickClose dentists={dentists.map((d) => ({ id: d.id, name: d.name }))} today={todayIsoDate()} />
        </Panel>

        <Panel>
          <h2 className="mb-3 text-lg font-bold">Closed times coming up</h2>
          {upcoming.length === 0 && (closures ?? []).length === 0 ? (
            <EmptyState title="Nothing is closed">Every working hour is open for booking.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {(closures ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-semibold">{formatDate(c.closed_on)}</span>
                    <span className="block text-sm text-muted">Whole clinic closed{c.reason ? ` · ${c.reason}` : ""}</span>
                  </span>
                  {frontDesk && <ReopenButton id={c.id} kind="clinic" what={`The clinic is closed on ${formatDate(c.closed_on)}`} />}
                </li>
              ))}
              {upcoming.map((t) => {
                const when = describe(t.from, t.to);
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-semibold">{when}</span>
                      <span className="block text-sm text-muted">{nameOf.get(t.resource_id) ?? "Dentist"}{t.reason ? ` · ${t.reason}` : ""}</span>
                    </span>
                    <ReopenButton id={t.id} kind="time" what={`${nameOf.get(t.resource_id) ?? "The dentist"} is closed ${when}`} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {frontDesk && (
          <>
            <Panel>
              <h2 className="text-lg font-bold">Close the whole clinic</h2>
              <p className="mb-4 text-sm text-muted">For holidays or events when no dentist is working.</p>
              <ClosureForm today={todayIsoDate()} />
            </Panel>

            {(allDentists ?? []).map((d) => (
              <Panel key={d.id}>
                <h2 className="text-lg font-bold">Weekly hours: {d.name}</h2>
                <p className="mb-2 text-sm text-muted">{d.title ? `${d.title}. ` : ""}Switch a day off or on, then save. This repeats every week.</p>
                <HoursForm resourceId={d.id} hours={(hours ?? []).filter((h) => h.resource_id === d.id)} />
              </Panel>
            ))}
          </>
        )}
      </div>
    </>
  );
}
