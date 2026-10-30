"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/redirect";
import { fieldErrors, loginSchema, signupSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";


async function findPatientUserId(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export async function signInAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const values = { email: String(formData.get("email") ?? "") }; // refill the form (React resets it after the action); never the password
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  let { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error?.code === "email_not_confirmed") {
    // Accounts made before sign-up became instant may still wait for a confirmation email.
    // The password was just checked by Supabase, so confirming here gives nothing away.
    const id = await findPatientUserId(parsed.data.email);
    if (id) {
      await createAdminClient().auth.admin.updateUserById(id, { email_confirm: true });
      ({ data, error } = await supabase.auth.signInWithPassword(parsed.data));
    }
  }
  if (error || !data.user) {
    // One message for every failure: don't reveal whether the email exists.
    return { ok: false, values, error: error?.code === "email_not_confirmed"
      ? "Your account isn't ready yet. Please try again in a minute."
      : "Email or password is incorrect." };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
  const fallback = profile?.role && profile.role !== "patient" ? "/dashboard" : "/my/bookings";
  redirect(safeNext(formData.get("next"), fallback));
}

/**
 * Patients can use their account right away (no confirmation email to click).
 * The account is created through the Admin API already marked as confirmed, then signed in.
 * Because the email isn't proven, the database never hands this account any earlier guest
 * bookings with the same email; the patient adds them with the booking number (claim_booking).
 */
export async function signUpAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"), phone: formData.get("phone"),
    email: formData.get("email"), password: formData.get("password"),
  });
  const values = { fullName: String(formData.get("fullName") ?? ""), phone: String(formData.get("phone") ?? ""), email: String(formData.get("email") ?? "") };
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error), values };
  const email = parsed.data.email.trim().toLowerCase();

  const { error } = await createAdminClient().auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    // Only name and phone are sent. The database ignores any "role" here and always creates a patient.
    user_metadata: { full_name: parsed.data.fullName, phone: parsed.data.phone },
  });
  if (error) {
    if (error.code === "email_exists" || /already|registered|exists/i.test(error.message)) {
      return { ok: false, values, error: "There's already an account with this email. Sign in instead, or use “Forgot password”.", fieldErrors: { email: "Already registered" } };
    }
    return { ok: false, values, error: error.code === "weak_password" ? "Choose a stronger password." : "We couldn't create your account. Please try again." };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
  if (signInError) return { ok: true, data: undefined, message: "Your account is ready. Sign in to continue." };
  redirect(safeNext(formData.get("next"), "/my/bookings?welcome=1"));
}

export async function forgotPasswordAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ email: z.email("Enter a valid email address.") }).safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: "Enter a valid email address.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.siteUrl()}/auth/confirm?next=/reset-password`,
  });
  return { ok: true, data: undefined, message: "If that email has an account, we've sent a link to reset the password." };
}

export async function resetPasswordAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ password: z.string().min(10, "Use at least 10 characters.").max(72) })
    .safeParse({ password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "The reset link expired. Request a new one." };
  redirect("/login?reset=1");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
