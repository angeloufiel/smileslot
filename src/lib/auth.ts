import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
};

/**
 * Data Access Layer: the ONE place that reads the session and the user's role.
 * cache() makes repeated calls in the same request free.
 * The role comes from the profiles table (protected by RLS + trigger),
 * never from anything the browser can edit.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  return {
    id: profile.id,
    email: String(claimsData.claims.email ?? ""),
    fullName: profile.full_name,
    role: profile.role,
  };
});

export const STAFF_ROLES: AppRole[] = ["owner", "receptionist", "dentist"];
export const FRONT_DESK_ROLES: AppRole[] = ["owner", "receptionist"];

export async function requireUser(next = "/my/bookings"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Throws a redirect unless the user has one of the given roles. */
export async function requireRole(roles: AppRole[], next = "/dashboard"): Promise<CurrentUser> {
  const user = await requireUser(next);
  if (!roles.includes(user.role)) redirect(user.role === "patient" ? "/my/bookings" : "/dashboard");
  return user;
}

export const requireStaff = (next?: string) => requireRole(STAFF_ROLES, next);
export const requireFrontDesk = (next?: string) => requireRole(FRONT_DESK_ROLES, next);
export const requireOwner = (next?: string) => requireRole(["owner"], next);

export const isFrontDesk = (role: AppRole) => FRONT_DESK_ROLES.includes(role);
