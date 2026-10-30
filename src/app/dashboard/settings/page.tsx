import { Suspense } from "react";
import { Badge, PageHeader, Panel, Skeleton } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { humanize } from "@/lib/format";
import { RoleForm, SettingsForm } from "./forms";
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

async function Settings() {
  const owner = await requireOwner("/dashboard/settings");
  const supabase = await createClient();
  const [{ data: settings }, { data: people }, { data: dentists }] = await Promise.all([
    supabase.from("clinic_settings").select("*").eq("id", 1).single(),
    supabase.from("profiles").select("id, full_name, role, is_active, created_at").order("role").order("full_name").limit(300),
    supabase.from("resources").select("id, name, profile_id").eq("type", "dentist").order("name"),
  ]);
  const staff = (people ?? []).filter((p) => p.role !== "patient");
  const patients = (people ?? []).filter((p) => p.role === "patient");

  return (
    <div className="space-y-6">
      {settings && <Panel><h2 className="mb-4 text-lg font-bold">Clinic</h2><SettingsForm s={settings} /></Panel>}

      <Panel>
        <h2 className="text-lg font-bold">Staff accounts</h2>
        <p className="mb-4 text-sm text-muted">
          To add a staff member: ask them to create an account on the website, then find them under
          &ldquo;Patient accounts&rdquo; below and change their role. Dentists also need their calendar linked.
        </p>
        <PeopleList people={staff} ownerId={owner.id} dentists={dentists ?? []} />
        {patients.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-semibold text-cobalt">Patient accounts ({patients.length})</summary>
            <div className="mt-4"><PeopleList people={patients} ownerId={owner.id} dentists={dentists ?? []} /></div>
          </details>
        )}
      </Panel>
    </div>
  );
}

function PeopleList({
  people, ownerId, dentists,
}: {
  people: { id: string; full_name: string; role: AppRole; is_active: boolean }[];
  ownerId: string;
  dentists: { id: string; name: string; profile_id: string | null }[];
}) {
  return (
    <ul className="divide-y divide-line">
      {people.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="font-semibold">{p.full_name || "No name"} {p.id === ownerId && <Badge tone="info">You</Badge>}</p>
            <p className="text-sm text-muted">
              {humanize(p.role)}
              {p.role === "dentist" && `, calendar: ${dentists.find((d) => d.profile_id === p.id)?.name ?? "not linked"}`}
            </p>
          </div>
          <RoleForm
            userId={p.id}
            role={p.role}
            resourceId={dentists.find((d) => d.profile_id === p.id)?.id ?? null}
            dentists={dentists}
            isSelf={p.id === ownerId}
          />
        </li>
      ))}
    </ul>
  );
}
