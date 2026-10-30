import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { requireFrontDesk } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/data/dashboard";
import { StaffBookingForm } from "./staff-booking-form";

export const metadata = { title: "New booking" };

export default function NewBookingPage() {
  return (
    <>
      <PageHeader title="New booking" description="For walk-ins and phone calls. The patient gets a booking number just like online bookings." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Loader />
      </Suspense>
    </>
  );
}

async function Loader() {
  await requireFrontDesk("/dashboard/reservations/new");
  const supabase = await createClient();
  const [{ data: services }, { data: dentists }, { data: links }] = await Promise.all([
    supabase.from("services").select("id, name, duration_minutes, price").eq("is_active", true).order("sort_order"),
    supabase.from("resources").select("id, name").eq("is_active", true).eq("type", "dentist").order("name"),
    supabase.from("service_resources").select("service_id, resource_id"),
  ]);
  return (
    <StaffBookingForm
      services={(services ?? []).map((s) => ({ id: s.id, name: s.name, duration: s.duration_minutes, price: Number(s.price) }))}
      dentists={(dentists ?? []).map((d) => ({ ...d, serviceIds: (links ?? []).filter((l) => l.resource_id === d.id).map((l) => l.service_id) }))}
      today={todayKey()}
    />
  );
}
