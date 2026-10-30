import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Badge, Button, ButtonLink, EmptyState, Skeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPeso, formatRef, humanize } from "@/lib/format";
import { PAYMENT_TONE, STATUS_TONE } from "@/lib/status";
import type { PaymentStatus, ReservationStatus } from "@/lib/types";

export const metadata: Metadata = { title: "My bookings" };

export default function MyBookingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Suspense fallback={<Skeleton className="h-80" />}>
        <MyBookings />
      </Suspense>
    </div>
  );
}

async function MyBookings() {
  const user = await requireUser("/my/bookings");
  const supabase = await createClient();
  // No .eq("customer_id", …) needed: Row Level Security only returns this patient's rows.
  const { data: bookings } = await supabase
    .from("reservations")
    .select("id, reference_code, starts_at, status, price, amount_paid, payment_status, service:services(name), dentist:resources(name)")
    .order("starts_at", { ascending: false });

  const { upcoming, past } = splitUpcoming(bookings ?? []);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My bookings</h1>
          <p className="text-muted">Signed in as {user.email}</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/book">Book again</ButtonLink>
          <form action={signOutAction}><Button variant="secondary" type="submit">Sign out</Button></form>
        </div>
      </div>

      <h2 className="mb-3 text-xl font-bold">Upcoming</h2>
      {upcoming.length === 0 ? (
        <EmptyState title="No upcoming appointments"><Link href="/book" className="text-cobalt underline">Book a time</Link> that works for you.</EmptyState>
      ) : <BookingList items={upcoming} />}

      {past.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-xl font-bold">History</h2>
          <BookingList items={past} />
        </>
      )}
    </>
  );
}

/** Upcoming = still active and in the future. Kept outside the component so render stays pure. */
function splitUpcoming<T extends { starts_at: string; status: string }>(rows: T[]) {
  const now = Date.now();
  const upcoming = rows.filter((b) => new Date(b.starts_at).getTime() >= now && ["pending", "confirmed"].includes(b.status));
  return { upcoming, past: rows.filter((b) => !upcoming.includes(b)) };
}

type Row = {
  id: string; reference_code: string; starts_at: string; status: ReservationStatus;
  price: number; amount_paid: number; payment_status: PaymentStatus;
  service: { name: string } | null; dentist: { name: string } | null;
};

function BookingList({ items }: { items: Row[] }) {
  return (
    <ul className="divide-y divide-line rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
      {items.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">{b.service?.name}</p>
            <p className="text-sm text-muted">{formatDateTime(b.starts_at)} with {b.dentist?.name}</p>
            <p className="text-sm text-muted">Booking no. {formatRef(b.reference_code)}, {formatPeso(b.amount_paid)} of {formatPeso(b.price)} paid</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[b.status]}>{humanize(b.status)}</Badge>
            {b.payment_status !== "unpaid" && <Badge tone={PAYMENT_TONE[b.payment_status]}>{humanize(b.payment_status)}</Badge>}
            <Link href={`/track?ref=${b.reference_code}`} className="text-sm font-semibold text-cobalt hover:underline">Manage</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
