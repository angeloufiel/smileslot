import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * SERVICE ROLE client — bypasses Row Level Security.
 *
 * Rules for using it:
 *   1. Server-only (the "server-only" import makes the build fail if a
 *      client component ever imports this file).
 *   2. Only after the caller has been authorised some other way
 *      (e.g. reference number + email verified by get_booking()).
 *   3. Only for the narrow job it is needed for: uploading a guest's payment
 *      proof and signing private file URLs.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Missing environment variable SUPABASE_SECRET_KEY.");
  return createClient<Database>(publicEnv.supabaseUrl(), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
