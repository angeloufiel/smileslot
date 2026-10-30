import Link from "next/link";
import { Suspense } from "react";
import { Button, ButtonLink, PageHeader, Select, Skeleton } from "@/components/ui";
import { ReservationTable } from "@/components/reservation-table";
import { isFrontDesk, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dayBounds, todayKey } from "@/lib/data/dashboard";
import { humanize } from "@/lib/format";
import type { ReservationStatus } from "@/lib/types";

export const metadata = { title: "Appointments" };

const VIEWS = { upcoming: "Upcoming", today: "Today", past: "Past", all: "All" } as const;
const STATUSES: ReservationStatus[] = ["pending", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "rejected", "no_show", "expired"];

export default function ReservationsPage({ searchParams }: PageProps<"/dashboard/reservations">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Reservations searchParams={searchParams} />
    </Suspense>
  );
}

async function Reservations({ searchParams }: { searchParams: PageProps<"/dashboard/reservations">["searchParams"] }) {
  const user = await requireStaff("/dashboard/reservations");
  const params = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const view = (str(params.view) in VIEWS ? str(params.view) : "upcoming") as keyof typeof VIEWS;
  const status = STATUSES.includes(str(params.status) as ReservationStatus) ? (str(params.status) as ReservationStatus) : "";
  // Keep only safe characters: the search text goes into a PostgREST filter string,
  // where commas and parentheses would change the meaning of the filter.
  const q = str(params.q).replace(/[^\p{L}\p{N} @.\-]/gu, "").trim().slice(0, 60);

  const supabase = await createClient();
  let query = supabase
    .from("reservations")
    .select("id, reference_code, starts_at, ends_at, status, source, contact_name, contact_phone, price, amount_paid, payment_status, service:services(name), dentist:resources(id, name)")
    .limit(200);

  const now = new Date().toISOString();
  if (view === "upcoming") query = query.gte("starts_at", now).order("starts_at");
  else if (view === "past") query = query.lt("starts_at", now).order("starts_at", { ascending: false });
  else if (view === "today") {
    const { from, to } = dayBounds(todayKey());
    query = query.gte("starts_at", from).lt("starts_at", to).order("starts_at");
  } else query = query.order("starts_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (q) query = query.or(`contact_name.ilike.%${q}%,reference_code.ilike.%${q}%,contact_phone.ilike.%${q}%,contact_email.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Appointments"
        description={user.role === "dentist" ? "Your appointments only." : "Every appointment at the clinic."}
        actions={isFrontDesk(user.role) && <ButtonLink href="/dashboard/reservations/new">New booking</ButtonLink>}
      />
      <form className="mb-5 flex flex-wrap items-end gap-3" role="search">
        <nav aria-label="Time range" className="flex rounded-[var(--radius-control)] bg-surface p-1 ring-1 ring-line">
          {Object.entries(VIEWS).map(([key, label]) => (
            <Link
              key={key}
              href={`/dashboard/reservations?${new URLSearchParams({ view: key, ...(status && { status }), ...(q && { q }) })}`}
              aria-current={view === key ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === key ? "bg-ink text-white" : "hover:bg-canvas"}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <input type="hidden" name="view" value={view} />
        <label className="sr-only" htmlFor="status">Status</label>
        <div className="w-44">
          <Select name="status" defaultValue={status}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </div>
        <label className="sr-only" htmlFor="q">Search</label>
        <input
          id="q" name="q" defaultValue={q} placeholder="Name, phone, email or SS- reference"
          className="min-h-11 w-72 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm"
        />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <ReservationTable items={data ?? []} role={user.role} emptyTitle="No appointments match these filters" />
      {data?.length === 200 && <p className="mt-3 text-sm text-muted">Showing the first 200. Narrow the filters to see more.</p>}
    </>
  );
}
