import Link from "next/link";
import { Suspense } from "react";
import { ButtonLink, PageHeader, Skeleton } from "@/components/ui";
import { ReservationTable } from "@/components/reservation-table";
import { isFrontDesk, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dayBounds, getReservationsBetween, todayKey } from "@/lib/data/dashboard";
import { formatDate, plural } from "@/lib/format";

export const metadata = { title: "Today" };

export default function DashboardHome() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Today />
    </Suspense>
  );
}

async function Today() {
  const user = await requireStaff();
  const supabase = await createClient();
  const today = todayKey();
  const { from, to } = dayBounds(today);
  const frontDesk = isFrontDesk(user.role);

  const [appointments, pendingRes, paymentsRes] = await Promise.all([
    getReservationsBetween(from, to),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("status", "pending"),
    frontDesk
      ? supabase.from("payments").select("id", { count: "exact", head: true }).eq("status", "awaiting_verification")
      : Promise.resolve({ count: 0 }),
  ]);

  const active = appointments.filter((a) => !["cancelled", "rejected", "expired"].includes(a.status));
  const waiting = appointments.filter((a) => a.status === "checked_in").length;
  const done = appointments.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader
        title={`Good day, ${user.fullName.split(" ")[0] || "there"}`}
        description={formatDate(from)}
        actions={frontDesk && <ButtonLink href="/dashboard/reservations/new">New booking</ButtonLink>}
      />

      <dl className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={user.role === "dentist" ? "Your patients today" : "Appointments today"} value={active.length} />
        <Stat label="In the waiting room" value={waiting} />
        <Stat label="Completed" value={done} />
        {frontDesk ? (
          <Stat
            label="Need your action"
            value={(pendingRes.count ?? 0) + (paymentsRes.count ?? 0)}
            detail={<><Link href="/dashboard/reservations?status=pending" className="underline">{pendingRes.count ?? 0} to approve</Link>, <Link href="/dashboard/payments" className="underline">{plural(paymentsRes.count ?? 0, "payment")}</Link></>}
            highlight={(pendingRes.count ?? 0) + (paymentsRes.count ?? 0) > 0}
          />
        ) : <Stat label="Pending approval" value={pendingRes.count ?? 0} />}
      </dl>

      <h2 className="mb-3 text-xl font-bold">Today&apos;s schedule</h2>
      <ReservationTable items={appointments} role={user.role} timeOnly emptyTitle="No appointments today" />
    </>
  );
}

function Stat({ label, value, detail, highlight }: { label: string; value: number; detail?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-panel)] p-4 ring-1 ${highlight ? "bg-sun-soft ring-sun/30" : "bg-surface ring-line"}`}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-display text-3xl font-bold tabular-nums">{value}</dd>
      {detail && <dd className="mt-1 text-xs text-muted">{detail}</dd>}
    </div>
  );
}
