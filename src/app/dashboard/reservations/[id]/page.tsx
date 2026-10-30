import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Alert, Badge, PageHeader, Panel, Skeleton } from "@/components/ui";
import { StatusButtons } from "@/components/status-buttons";
import { isFrontDesk, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStaffDentists } from "@/lib/data/dashboard";
import { formatDateTime, formatPeso, humanize, methodLabel } from "@/lib/format";
import { PAYMENT_TONE, STATUS_TONE } from "@/lib/status";
import { NoteForm, ProofLink, RecordPaymentForm, RescheduleForm, ReviewPaymentButtons } from "./panels";

export const metadata = { title: "Appointment" };

export default function ReservationPage({ params, searchParams }: PageProps<"/dashboard/reservations/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <ReservationDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ReservationDetail({ params, searchParams }: PageProps<"/dashboard/reservations/[id]">) {
  const user = await requireStaff();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const frontDesk = isFrontDesk(user.role);

  // RLS: a dentist asking for another dentist's appointment gets null here → 404.
  const { data: r } = await supabase
    .from("reservations")
    .select("*, service:services(name, duration_minutes), dentist:resources(id, name), customer:customers(id, full_name, is_vip)")
    .eq("id", id)
    .maybeSingle();
  if (!r) notFound();

  const [{ data: payments }, { data: notes }, { data: history }, dentists] = await Promise.all([
    frontDesk
      ? supabase.from("payments").select("*").eq("reservation_id", id).order("created_at")
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("reservation_notes").select("id, body, created_at, author:profiles(full_name)").eq("reservation_id", id).order("created_at", { ascending: false }),
    supabase.from("reservation_status_history").select("id, from_status, to_status, reason, changed_at, actor:profiles(full_name)").eq("reservation_id", id).order("changed_at"),
    frontDesk ? getStaffDentists() : Promise.resolve([]),
  ]);

  const balance = Math.max(0, Number(r.price) - Number(r.amount_paid));
  const localStart = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(r.starts_at)).replace(" ", "T");

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/dashboard/reservations" className="text-cobalt hover:underline">Appointments</Link></p>
      <PageHeader title={r.contact_name} description={`${r.reference_code}, ${r.service?.name} with ${r.dentist?.name}`} />
      {sp.created && <div className="mb-4"><Alert tone="success">Booking created.</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[r.status]}>{humanize(r.status)}</Badge>
              {frontDesk && <Badge tone={PAYMENT_TONE[r.payment_status]}>{humanize(r.payment_status)}</Badge>}
              {r.customer?.is_vip && <Badge tone="info">VIP</Badge>}
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <Item label="When">{formatDateTime(r.starts_at)} to {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(new Date(r.ends_at))}</Item>
              <Item label="Booked via">{humanize(r.source)}, {formatDateTime(r.created_at)}</Item>
              <Item label="Phone"><a href={`tel:${r.contact_phone}`} className="text-cobalt hover:underline">{r.contact_phone}</a></Item>
              <Item label="Email">{r.contact_email}</Item>
              {r.patient_notes && <Item label="Patient's note" wide>{r.patient_notes}</Item>}
              {r.status_reason && <Item label="Last status note" wide>{r.status_reason}</Item>}
              {r.expires_at && r.status === "pending" && <Item label="Hold expires">{formatDateTime(r.expires_at)}</Item>}
            </dl>
            <div className="mt-6 border-t border-line pt-5">
              <StatusButtons id={r.id} status={r.status} role={user.role} />
            </div>
          </Panel>

          {frontDesk && (
            <Panel>
              <h2 className="text-lg font-bold">Payments</h2>
              <p className="mt-1 text-sm text-muted">
                {formatPeso(r.amount_paid)} paid of {formatPeso(r.price)}
                {Number(r.deposit_required) > 0 && `, deposit ${formatPeso(r.deposit_required)}`}
              </p>
              {payments && payments.length > 0 && (
                <ul className="mt-4 divide-y divide-line rounded-[var(--radius-control)] ring-1 ring-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                      <div>
                        <p className="font-semibold">
                          {p.kind === "refund" ? "Refund, " : ""}{methodLabel(p.method)} {formatPeso(p.amount)}
                        </p>
                        <p className="text-muted">
                          {formatDateTime(p.created_at)}{p.reference_no && `, ref ${p.reference_no}`}
                          {p.rejection_reason && `, rejected: ${p.rejection_reason}`}
                        </p>
                        {p.proof_path && <ProofLink paymentId={p.id} />}
                      </div>
                      {p.status === "awaiting_verification"
                        ? <ReviewPaymentButtons paymentId={p.id} />
                        : <Badge tone={p.status === "verified" ? "success" : "danger"}>{humanize(p.status)}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {!["cancelled", "rejected", "expired"].includes(r.status) && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-cobalt">Record a payment or refund at the desk</summary>
                  <div className="mt-4"><RecordPaymentForm reservationId={r.id} balance={balance} /></div>
                </details>
              )}
            </Panel>
          )}

          {frontDesk && ["pending", "confirmed"].includes(r.status) && (
            <Panel>
              <h2 className="mb-1 text-lg font-bold">Move appointment</h2>
              <p className="mb-4 text-sm text-muted">You can pick any time; the system still refuses times that overlap the dentist&apos;s other appointments.</p>
              <RescheduleForm reservationId={r.id} dentists={dentists} currentDentistId={r.resource_id} currentLocal={localStart} />
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel>
            <h2 className="mb-4 text-lg font-bold">Staff notes</h2>
            <NoteForm reservationId={r.id} />
            <ul className="mt-5 space-y-4">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="text-sm">
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{n.author?.full_name ?? "Staff"}, {formatDateTime(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <h2 className="mb-4 text-lg font-bold">History</h2>
            <ol className="space-y-3 border-l-2 border-line pl-4 text-sm">
              {(history ?? []).map((h) => (
                <li key={h.id}>
                  <p className="font-semibold">{h.from_status ? `${humanize(h.from_status)} to ${humanize(h.to_status)}` : `Created as ${humanize(h.to_status)}`}</p>
                  <p className="text-xs text-muted">{h.actor?.full_name || "Patient or system"}, {formatDateTime(h.changed_at)}</p>
                  {h.reason && <p className="text-xs text-muted">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
