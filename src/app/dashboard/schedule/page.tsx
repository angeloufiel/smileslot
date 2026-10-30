import { Suspense } from "react";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui";
import { requireFrontDesk } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, parseRange, todayIsoDate } from "./util";
import { ClosureForm, HoursForm, RemoveClosureButton, TimeOffForm } from "./forms";

export const metadata = { title: "Hours & closures" };

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Hours and closures" description="Online booking only offers times inside these hours, outside breaks, closures and time off." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Schedule />
      </Suspense>
    </>
  );
}

async function Schedule() {
  await requireFrontDesk("/dashboard/schedule");
  const supabase = await createClient();
  const [{ data: dentists }, { data: hours }, { data: timeOff }, { data: closures }] = await Promise.all([
    supabase.from("resources").select("id, name, title").eq("type", "dentist").order("name"),
    supabase.from("working_hours").select("resource_id, weekday, start_time, end_time"),
    supabase.from("resource_time_off").select("id, resource_id, period, reason"),
    supabase.from("clinic_closures").select("id, closed_on, reason").gte("closed_on", todayIsoDate()).order("closed_on"),
  ]);

  return (
    <div className="space-y-6">
      {(dentists ?? []).map((d) => {
        const off = (timeOff ?? []).filter((t) => t.resource_id === d.id);
        return (
          <Panel key={d.id}>
            <h2 className="text-lg font-bold">{d.name}</h2>
            <p className="mb-4 text-sm text-muted">{d.title}</p>
            <HoursForm resourceId={d.id} hours={(hours ?? []).filter((h) => h.resource_id === d.id)} />
            <h3 className="mt-6 mb-2 font-semibold">Time off</h3>
            {off.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {off.map((t) => {
                  const [from, to] = parseRange(t.period);
                  return <li key={t.id}>{formatDateTime(from)} to {formatDateTime(to)}{t.reason && `, ${t.reason}`}</li>;
                })}
              </ul>
            )}
            <TimeOffForm resourceId={d.id} />
          </Panel>
        );
      })}

      <Panel>
        <h2 className="mb-4 text-lg font-bold">Clinic closures</h2>
        {(closures ?? []).length === 0 ? <EmptyState title="No upcoming closures" /> : (
          <ul className="mb-5 divide-y divide-line text-sm">
            {(closures ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium">{formatDate(c.closed_on)}</span>{c.reason && <span className="text-muted">, {c.reason}</span>}</span>
                <RemoveClosureButton id={c.id} />
              </li>
            ))}
          </ul>
        )}
        <ClosureForm />
      </Panel>
    </div>
  );
}
