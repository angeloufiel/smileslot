import { Suspense } from "react";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, formatRef, humanize } from "@/lib/format";

export const metadata = { title: "Audit log" };

const IGNORED = new Set(["updated_at", "created_at"]);

/** Which columns changed between old and new row data. */
function changedFields(oldData: unknown, newData: unknown): string[] {
  if (!oldData || !newData || typeof oldData !== "object" || typeof newData !== "object") return [];
  const o = oldData as Record<string, unknown>;
  const n = newData as Record<string, unknown>;
  return Object.keys(n).filter((k) => !IGNORED.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
}

export default function AuditPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Every change to appointments, payments, patients, services and settings. Written by the database itself; nobody can edit or delete it." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Audit />
      </Suspense>
    </>
  );
}

async function Audit() {
  await requireOwner("/dashboard/audit");
  const supabase = await createClient();
  const { data: logs } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  const actorIds = [...new Set((logs ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] };
  const nameOf = (id: string | null) => {
    if (!id) return "Patient, guest or system";
    const a = actors?.find((x) => x.id === id);
    return a ? `${a.full_name} (${humanize(a.role)})` : "Unknown user";
  };

  if (!logs?.length) return <EmptyState title="Nothing logged yet" />;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">When</th>
            <th scope="col" className="px-4 py-3 font-medium">Who</th>
            <th scope="col" className="px-4 py-3 font-medium">What</th>
            <th scope="col" className="px-4 py-3 font-medium">Changed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {logs.map((l) => {
            const fields = changedFields(l.old_data, l.new_data);
            const ref = (l.new_data as Record<string, unknown> | null)?.reference_code ?? (l.old_data as Record<string, unknown> | null)?.reference_code;
            return (
              <tr key={l.id}>
                <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                <td className="px-4 py-3">{nameOf(l.actor_id)}</td>
                <td className="px-4 py-3">
                  {l.action === "INSERT" ? "Created" : l.action === "UPDATE" ? "Updated" : "Deleted"} {humanize(l.table_name).replace(/s$/, "")}
                  {ref ? <span className="block text-xs text-muted">Booking no. {formatRef(String(ref))}</span> : null}
                </td>
                <td className="px-4 py-3 text-muted">{fields.length ? fields.map(humanize).join(", ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
