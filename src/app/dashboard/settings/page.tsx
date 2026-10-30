import { Suspense } from "react";
import { Badge, PageHeader, Panel, Skeleton } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { humanize } from "@/lib/format";
import { AddStaffButton, EditPersonButton, SettingsForm, type Person } from "./forms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";

export const metadata = { title: "Settings & staff" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings and staff" description="Only the clinic owner can see this page." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Settings />
      </Suspense>
    </>
  );
}

/** Login emails live in auth.users, which only the Admin API can read. Owner-only page. */
async function loginEmails(): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  try {
    const admin = createAdminClient();
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      data.users.forEach((u) => emails.set(u.id, u.email ?? ""));
      if (data.users.length < 1000) break;
    }
  } catch (e) {
    console.error("[settings] listUsers", e);
  }
  return emails;
}

async function Settings() {
  const owner = await requireOwner("/dashboard/settings");
  const supabase = await createClient();
  const [{ data: settings }, { data: people }, { data: calendars }, emails] = await Promise.all([
    supabase.from("clinic_settings").select("*").eq("id", 1).single(),
    supabase.from("profiles").select("id, full_name, role, is_active").order("full_name").limit(500),
    supabase.from("resources").select("id, name, title, profile_id").eq("type", "dentist").order("name"),
    loginEmails(),
  ]);
  const cal = calendars ?? [];
  const ORDER: Record<AppRole, number> = { owner: 0, secretary: 1, dentist: 2, patient: 3 };
  const all: Person[] = (people ?? [])
    .map((p) => {
      const c = cal.find((r) => r.profile_id === p.id);
      return { id: p.id, full_name: p.full_name, role: p.role, email: emails.get(p.id) ?? "", calendarId: c?.id ?? null, calendarTitle: c?.title ?? null };
    })
    .sort((a, b) => ORDER[a.role] - ORDER[b.role] || a.full_name.localeCompare(b.full_name));
  const staff = all.filter((p) => p.role !== "patient");
  const patients = all.filter((p) => p.role === "patient");
  const calendarOptions = cal.map(({ id, name, profile_id }) => ({ id, name, profile_id }));

  return (
    <div className="space-y-6">
      <Panel>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Staff</h2>
            <p className="text-sm text-muted">Add doctors and secretaries, fix a name, or change what someone can do.</p>
          </div>
          <AddStaffButton calendars={calendarOptions} />
        </div>
        <PeopleList people={staff} ownerId={owner.id} calendars={calendarOptions} />
        {patients.length > 0 && (
          <details className="mt-6 border-t border-line pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-cobalt">Patient accounts ({patients.length})</summary>
            <p className="mt-2 text-sm text-muted">Someone who signed up as a patient can be made staff with Edit.</p>
            <div className="mt-2"><PeopleList people={patients} ownerId={owner.id} calendars={calendarOptions} /></div>
          </details>
        )}
      </Panel>

      {settings && <Panel><h2 className="mb-4 text-lg font-bold">Clinic</h2><SettingsForm s={settings} /></Panel>}
    </div>
  );
}

const ROLE_TONE: Record<AppRole, "info" | "success" | "warning" | "neutral"> = {
  owner: "info", secretary: "warning", dentist: "success", patient: "neutral",
};

function PeopleList({
  people, ownerId, calendars,
}: { people: Person[]; ownerId: string; calendars: { id: string; name: string; profile_id: string | null }[] }) {
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => (
        <li key={p.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center">
          <div className="min-w-0">
            <p className="font-semibold">{p.full_name || "No name"} {p.id === ownerId && <span className="text-sm font-normal text-muted">(you)</span>}</p>
            <p className="truncate text-sm text-muted">
              {p.email}
              {p.role === "dentist" && ` · calendar: ${calendars.find((c) => c.id === p.calendarId)?.name ?? "not linked"}`}
            </p>
          </div>
          <span><Badge tone={ROLE_TONE[p.role]}>{humanize(p.role)}</Badge></span>
          <span className="sm:justify-self-end"><EditPersonButton person={p} calendars={calendars} isSelf={p.id === ownerId} /></span>
        </li>
      ))}
    </ul>
  );
}
