import Link from "next/link";
import { Suspense } from "react";
import { Badge, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireFrontDesk } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatPeso, formatRef, humanize, methodLabel } from "@/lib/format";
import { ProofLink, ReviewPaymentButtons } from "../reservations/[id]/panels";

export const metadata = { title: "Payments" };

export default function PaymentsPage({ searchParams }: PageProps<"/dashboard/payments">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}

async function Payments({ searchParams }: { searchParams: PageProps<"/dashboard/payments">["searchParams"] }) {
  await requireFrontDesk("/dashboard/payments");
  const params = await searchParams;
  const showAll = params.status === "all";
  const supabase = await createClient();

  let query = supabase
    .from("payments")
    .select("id, kind, method, amount, status, reference_no, proof_path, created_at, rejection_reason, verified_at, reservation:reservations(id, reference_code, contact_name, starts_at), verifier:profiles!payments_verified_by_fkey(full_name)")
    .order("created_at", { ascending: !showAll })
    .limit(200);
  if (!showAll) query = query.eq("status", "awaiting_verification");
  const { data: payments, error } = await query;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title={showAll ? "All payments" : "Payments to verify"}
        description={showAll ? "Most recent first." : "Check each receipt against the clinic's GCash, Maya or bank app before verifying. Oldest first."}
        actions={<Link className="text-sm font-semibold text-cobalt hover:underline" href={showAll ? "/dashboard/payments" : "/dashboard/payments?status=all"}>{showAll ? "Show only payments to verify" : "Show all payments"}</Link>}
      />
      {(payments ?? []).length === 0 ? (
        <EmptyState title={showAll ? "No payments yet" : "All caught up"}>{!showAll && "New GCash, Maya and bank receipts appear here."}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Submitted</th>
                <th scope="col" className="px-4 py-3 font-medium">Booking</th>
                <th scope="col" className="px-4 py-3 font-medium">Payment</th>
                <th scope="col" className="px-4 py-3 font-medium">Receipt</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(payments ?? []).map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                  <td className="px-4 py-3">
                    {p.reservation && (
                      <Link href={`/dashboard/reservations/${p.reservation.id}`} className="font-semibold text-cobalt hover:underline">
                        {p.reservation.contact_name}
                      </Link>
                    )}
                    <span className="block text-xs text-muted">No. {formatRef(p.reservation?.reference_code)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold tabular-nums">{p.kind === "refund" && "Refund, "}{formatPeso(p.amount)}</span>
                    <span className="block text-xs text-muted">{methodLabel(p.method)}{p.reference_no && `, ref ${p.reference_no}`}</span>
                  </td>
                  <td className="px-4 py-3">{p.proof_path ? <ProofLink paymentId={p.id} /> : <span className="text-muted">None</span>}</td>
                  <td className="px-4 py-3">
                    {p.status === "awaiting_verification" ? <ReviewPaymentButtons paymentId={p.id} amountLabel={formatPeso(p.amount)} /> : (
                      <>
                        <Badge tone={p.status === "verified" ? "success" : "danger"}>{humanize(p.status)}</Badge>
                        <span className="mt-1 block text-xs text-muted">{p.verifier?.full_name}{p.rejection_reason && `: ${p.rejection_reason}`}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
