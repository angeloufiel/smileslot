import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { StatusButtons } from "@/components/status-buttons";
import { formatDateTime, formatPeso, formatTime, humanize } from "@/lib/format";
import { PAYMENT_TONE, STATUS_TONE } from "@/lib/status";
import type { ReservationListItem } from "@/lib/data/dashboard";
import type { AppRole } from "@/lib/types";

export function ReservationTable({
  items, role, timeOnly = false, emptyTitle = "No appointments",
}: { items: ReservationListItem[]; role: AppRole; timeOnly?: boolean; emptyTitle?: string }) {
  if (items.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">{timeOnly ? "Time" : "When"}</th>
            <th scope="col" className="px-4 py-3 font-medium">Patient</th>
            <th scope="col" className="px-4 py-3 font-medium">Service</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 font-medium">Payment</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="font-semibold tabular-nums">{timeOnly ? formatTime(r.starts_at) : formatDateTime(r.starts_at)}</span>
                <span className="block text-xs text-muted">{r.dentist?.name}</span>
              </td>
              <td className="px-4 py-3">
                <Link href={`/dashboard/reservations/${r.id}`} className="font-semibold text-cobalt hover:underline">{r.contact_name}</Link>
                <span className="block text-xs text-muted">{r.reference_code}{r.source !== "online" && `, ${humanize(r.source)}`}</span>
              </td>
              <td className="px-4 py-3">{r.service?.name}</td>
              <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status]}>{humanize(r.status)}</Badge></td>
              <td className="px-4 py-3">
                {role === "dentist" ? <span className="text-muted">Front desk</span> : (
                  <>
                    <Badge tone={PAYMENT_TONE[r.payment_status]}>{humanize(r.payment_status)}</Badge>
                    <span className="mt-1 block text-xs text-muted tabular-nums">{formatPeso(r.amount_paid)} / {formatPeso(r.price)}</span>
                  </>
                )}
              </td>
              <td className="px-4 py-3"><StatusButtons id={r.id} status={r.status} role={role} compact /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
