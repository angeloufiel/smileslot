import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createAnonClient } from "@/lib/supabase/server";

export type Branding = { name: string; tagline: string | null; logoUrl: string | null };
export const BRANDING_TAG = "clinic-branding";
const FALLBACK: Branding = { name: "Dental Clinic", tagline: null, logoUrl: null };

/**
 * Clinic name, tagline and logo for headers, footers and page titles.
 * Cached (it changes rarely) and tagged, so saving Settings refreshes it at once with updateTag().
 */
export async function getBranding(): Promise<Branding> {
  "use cache";
  cacheTag(BRANDING_TAG);
  try {
    const { data, error } = await createAnonClient().from("clinic_settings").select("name, tagline, logo_url").eq("id", 1).maybeSingle();
    if (error || !data) throw error ?? new Error("clinic_settings row missing");
    cacheLife("hours");
    return { name: data.name, tagline: data.tagline, logoUrl: data.logo_url };
  } catch (e) {
    console.error("[branding]", e);
    cacheLife("seconds"); // don't keep a fallback around
    return FALLBACK;
  }
}
