import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, clinicDateKey } from "@/lib/format";

/** UTC bounds of a clinic-local day (Asia/Manila is a fixed +08:00). */
export function dayBounds(dateKey: string) {
  return {
    from: new Date(`${dateKey}T00:00:00+08:00`).toISOString(),
    to: new Date(`${addDays(dateKey, 1)}T00:00:00+08:00`).toISOString(),
  };
}

export const todayKey = () => clinicDateKey(new Date());

/**
 * Appointments in a time range. No role filtering in code:
 * RLS gives front desk everything and a dentist only their own.
 */
export async function getReservationsBetween(from: string, to: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .select("id, reference_code, starts_at, ends_at, status, source, contact_name, contact_phone, price, amount_paid, payment_status, service:services(name), dentist:resources(id, name)")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at");
  if (error) throw error;
  return data;
}
export type ReservationListItem = Awaited<ReturnType<typeof getReservationsBetween>>[number];

export async function getStaffDentists() {
  const supabase = await createClient();
  const { data } = await supabase.from("resources").select("id, name, title, is_active, profile_id").eq("type", "dentist").order("name");
  return data ?? [];
}
