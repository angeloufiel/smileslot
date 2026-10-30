import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];
type Tables = Database["public"]["Tables"];

export type AppRole = Enums["app_role"];
export type ReservationStatus = Enums["reservation_status"];
export type PaymentStatus = Enums["payment_status"];
export type PaymentTxnStatus = Enums["payment_txn_status"];
export type PaymentMethod = Enums["payment_method"];

export type Service = Tables["services"]["Row"];
export type Resource = Tables["resources"]["Row"];
export type Reservation = Tables["reservations"]["Row"];
export type ClinicSettings = Tables["clinic_settings"]["Row"];

/** Result type returned by every Server Action, so forms can show errors inline. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };
