import "server-only";
import { connection } from "next/server";
import { createAnonClient } from "@/lib/supabase/server";
import { addDays, clinicDateKey } from "@/lib/format";

/**
 * Public catalog reads. They use the anonymous client, so they can only ever
 * return what RLS allows a guest to see (active services, active dentists).
 * connection() marks them as request-time data: availability changes by the minute.
 */

export async function getClinic() {
  await connection();
  const { data, error } = await createAnonClient().from("clinic_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getServices() {
  await connection();
  const { data, error } = await createAnonClient()
    .from("services")
    .select("id, name, slug, description, duration_minutes, price, deposit_amount, requires_approval, sort_order, category:service_categories(name, sort_order)")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data;
}
export type PublicService = Awaited<ReturnType<typeof getServices>>[number];

export async function getDentists() {
  await connection();
  const supabase = createAnonClient();
  const [{ data: resources, error }, { data: links }] = await Promise.all([
    supabase.from("resources").select("id, name, title, bio").eq("is_active", true).eq("type", "dentist").order("name"),
    supabase.from("service_resources").select("service_id, resource_id"),
  ]);
  if (error) throw error;
  return (resources ?? []).map((r) => ({
    ...r,
    serviceIds: (links ?? []).filter((l) => l.resource_id === r.id).map((l) => l.service_id),
  }));
}
export type PublicDentist = Awaited<ReturnType<typeof getDentists>>[number];

export async function getWorkingHours() {
  await connection();
  const { data } = await createAnonClient().from("working_hours").select("resource_id, weekday, start_time, end_time");
  return data ?? [];
}

/** First open slots for a service, looking ahead up to `days` days. Powers the homepage hero. */
export async function getNextOpenSlots(serviceId: string, limit = 6, days = 10) {
  await connection();
  const supabase = createAnonClient();
  const today = clinicDateKey(new Date());
  const out: { resource_id: string; resource_name: string; slot_start: string }[] = [];
  for (let i = 0; i < days && out.length < limit; i++) {
    const { data } = await supabase.rpc("get_available_slots", { p_service_id: serviceId, p_date: addDays(today, i) });
    for (const s of data ?? []) {
      if (out.length >= limit) break;
      // One chip per time: skip a second dentist at the exact same minute
      if (!out.some((o) => o.slot_start === s.slot_start)) out.push(s);
    }
  }
  return out;
}
