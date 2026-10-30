"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNext } from "@/lib/redirect";
import { fieldErrors, loginSchema, signupSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/types";


export async function signInAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // One message for every failure: don't reveal whether the email exists.
    return { ok: false, error: error?.code === "email_not_confirmed"
      ? "Confirm your email first. We sent you a link when you signed up."
      : "Email or password is incorrect." };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
  const fallback = profile?.role && profile.role !== "patient" ? "/dashboard" : "/my/bookings";
  redirect(safeNext(formData.get("next"), fallback));
}

export async function signUpAction(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"), phone: formData.get("phone"),
    email: formData.get("email"), password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Only name and phone are sent. The database ignores any "role" here and always creates a patient.
      data: { full_name: parsed.data.fullName, phone: parsed.data.phone },
      emailRedirectTo: `${publicEnv.siteUrl()}/auth/confirm?next=/my/bookings`,
    },
  });
  if (error && error.code !== "user_already_exists") {
    return { ok: false, error: error.code === "weak_password" ? "Choose a stronger password." : "We couldn't create your account. Please try again." };
  }
  // Same success message even if the email is already registered (prevents account enumeration).
  return { ok: true, data: undefined, message: "Check your email for a confirmation link to finish creating your account." };
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
