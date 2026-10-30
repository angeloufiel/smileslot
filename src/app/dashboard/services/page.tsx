import { Suspense } from "react";
import { Badge, PageHeader, Panel, Skeleton } from "@/components/ui";
import { requireFrontDesk } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPeso } from "@/lib/format";
import { ServiceForm } from "./service-form";

export const metadata = { title: "Services" };

export default function ServicesPage() {
  return (
    <>
      <PageHeader title="Services" description="What patients can book online, how long it takes and what it costs." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Services />
      </Suspense>
    </>
  );
}

async function Services() {
  await requireFrontDesk("/dashboard/services");
  const supabase = await createClient();
  const [{ data: services }, { data: categories }, { data: dentists }, { data: links }] = await Promise.all([
    supabase.from("services").select("*").order("sort_order"),
    supabase.from("service_categories").select("id, name").order("sort_order"),
    supabase.from("resources").select("id, name").eq("type", "dentist").order("name"),
    supabase.from("service_resources").select("service_id, resource_id"),
  ]);
  const props = { categories: categories ?? [], dentists: dentists ?? [] };

  return (
    <div className="space-y-4">
      {(services ?? []).map((s) => (
        <details key={s.id} className="group rounded-[var(--radius-panel)] bg-surface ring-1 ring-line">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4">
            <span>
              <span className="font-semibold">{s.name}</span>{" "}
              {!s.is_active && <Badge>Hidden</Badge>}{" "}
              {s.requires_approval && <Badge tone="info">Needs approval</Badge>}
              <span className="block text-sm text-muted">
                {s.duration_minutes} min + {s.buffer_minutes} min cleanup, {formatPeso(s.price)}
                {Number(s.deposit_amount) > 0 && `, ${formatPeso(s.deposit_amount)} deposit`}
              </span>
            </span>
            <span className="text-sm font-semibold text-cobalt group-open:hidden">Edit</span>
          </summary>
          <div className="border-t border-line p-4">
            <ServiceForm {...props} service={{ ...s, dentistIds: (links ?? []).filter((l) => l.service_id === s.id).map((l) => l.resource_id) }} />
          </div>
        </details>
      ))}
      <Panel>
        <h2 className="mb-4 text-lg font-bold">Add a service</h2>
        <ServiceForm {...props} />
      </Panel>
    </div>
  );
}
