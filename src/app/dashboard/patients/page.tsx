import Link from "next/link";
import { Suspense } from "react";
import { Badge, Button, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Patients" };

export default function PatientsPage({ searchParams }: PageProps<"/dashboard/patients">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Patients searchParams={searchParams} />
    </Suspense>
  );
}

async function Patients({ searchParams }: { searchParams: PageProps<"/dashboard/patients">["searchParams"] }) {
  const user = await requireStaff("/dashboard/patients");
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").replace(/[^\p{L}\p{N} @.\-]/gu, "").trim().slice(0, 60);
  const supabase = await createClient();

  // RLS: front desk sees every patient; a dentist sees only patients they've had appointments with.
  let query = supabase
    .from("customers")
    .select("id, full_name, email, phone, is_vip, profile_id, created_at, reservations(starts_at, status)")
    .order("full_name")
    .limit(200);
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data: patients, error } = await query;
  if (error) throw error;

  const rows = (patients ?? []).filter((p) => p.profile_id !== user.id);

  return (
    <>
      <PageHeader title="Patients" description={user.role === "dentist" ? "Patients you have seen or will see." : "Everyone who has booked with the clinic."} />
      <form role="search" className="mb-5 flex gap-2">
        <label htmlFor="q" className="sr-only">Search patients</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name, email or phone" className="min-h-11 w-80 rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {rows.length === 0 ? <EmptyState title="No patients found" /> : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Patient</th>
                <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                <th scope="col" className="px-4 py-3 font-medium">Visits</th>
                <th scope="col" className="px-4 py-3 font-medium">Last appointment</th>
                <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const visits = (p.reservations ?? []).filter((r) => r.status === "completed").length;
                const last = (p.reservations ?? []).map((r) => r.starts_at).sort().at(-1);
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-3">
                      <span className="font-semibold">{p.full_name}</span>{" "}
                      {p.is_vip && <Badge tone="info">VIP</Badge>}
                      <span className="block text-xs text-muted">{p.profile_id ? "Has an account" : "Guest"}</span>
                    </td>
                    <td className="px-4 py-3">{p.email}<span className="block text-xs text-muted">{p.phone}</span></td>
                    <td className="px-4 py-3 tabular-nums">{visits}</td>
                    <td className="px-4 py-3">{last ? formatDate(last) : "None"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link className="font-semibold text-cobalt hover:underline" href={`/dashboard/reservations?view=all&q=${encodeURIComponent(p.email)}`}>Bookings</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
