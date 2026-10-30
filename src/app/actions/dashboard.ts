"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFrontDesk, requireOwner, requireStaff } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { paymentReviewedEmail, sendEmail, statusChangedEmail } from "@/lib/email";
import { NEEDS_REASON } from "@/lib/status";
import { fieldErrors, phoneSchema } from "@/lib/validation";
import type { ActionResult, ReservationStatus } from "@/lib/types";

/*
 * Staff actions. Each one:
 *   1. checks the role (fast, friendly failure),
 *   2. runs the query AS THE SIGNED-IN STAFF MEMBER, so Row Level Security and the
 *      database triggers make the final decision. A dentist calling an owner-only
 *      action still gets blocked by Postgres even if step 1 had a bug.
 */

const uuid = z.uuid();
const STATUSES = ["pending", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "rejected", "no_show", "expired"] as const;

// ---------------------------------------------------------------- reservations

export async function updateReservationStatus(formData: FormData): Promise<ActionResult> {
  await requireStaff();
  const parsed = z.object({
    id: uuid,
    status: z.enum(STATUSES),
    reason: z.string().trim().max(500).optional(),
  }).safeParse({ id: formData.get("id"), status: formData.get("status"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { id, status, reason } = parsed.data;
  if (NEEDS_REASON.includes(status as ReservationStatus) && !reason) {
    return { ok: false, error: "Add a short reason. The patient will see it.", fieldErrors: { reason: "Required" } };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reservations")
    .update({ status, status_reason: reason ?? null })
    .eq("id", id)
    .select("reference_code, contact_email, contact_name, starts_at, status, status_reason")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "You can't change this appointment." }; // RLS hid the row

  if (["confirmed", "rejected", "cancelled"].includes(status)) {
    await sendEmail(statusChangedEmail({
      to: data.contact_email, name: data.contact_name, reference: data.reference_code,
      status: data.status, startsAt: data.starts_at, reason: data.status_reason,
    }));
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: undefined, message: `Marked ${status.replaceAll("_", " ")}.` };
}

export async function addReservationNote(formData: FormData): Promise<ActionResult> {
  const user = await requireStaff();
  const parsed = z.object({ id: uuid, body: z.string().trim().min(1, "Write a note.").max(2000) })
    .safeParse({ id: formData.get("id"), body: formData.get("body") });
  if (!parsed.success) return { ok: false, error: "Write a note first.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("reservation_notes")
    .insert({ reservation_id: parsed.data.id, author_id: user.id, body: parsed.data.body });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath(`/dashboard/reservations/${parsed.data.id}`);
  return { ok: true, data: undefined, message: "Note added." };
}

export async function rescheduleReservation(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({ id: uuid, resourceId: uuid, startsAt: z.iso.datetime({ offset: true }) })
    .safeParse({ id: formData.get("id"), resourceId: formData.get("resourceId"), startsAt: formData.get("startsAt") });
  if (!parsed.success) return { ok: false, error: "Choose a dentist and a new time." };
  const supabase = await createClient();
  // The trigger recalculates the end time; the exclusion constraint blocks any overlap.
  const { data, error } = await supabase.from("reservations")
    .update({ starts_at: parsed.data.startsAt, resource_id: parsed.data.resourceId, status_reason: "Rescheduled by the clinic" })
    .eq("id", parsed.data.id)
    .select("reference_code, contact_email, contact_name, starts_at, status")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "You can't change this appointment." };
  await sendEmail(statusChangedEmail({
    to: data.contact_email, name: data.contact_name, reference: data.reference_code,
    status: "rescheduled", startsAt: data.starts_at, reason: "The clinic moved your appointment to this new time.",
  }));
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: undefined, message: "Appointment moved." };
}

const staffBookingSchema = z.object({
  serviceId: uuid,
  resourceId: uuid,
  startsAt: z.iso.datetime({ offset: true, message: "Choose a date and time." }),
  source: z.enum(["walk_in", "phone", "manual"]),
  fullName: z.string().trim().min(2, "Enter the patient's name.").max(120),
  email: z.email("Enter the patient's email.").max(254),
  phone: phoneSchema,
  notes: z.string().trim().max(1000).optional(),
});

/** Walk-in and phone bookings. Staff may book outside the online rules (e.g. today, no notice),
 *  but the database still refuses overlaps with the dentist's other appointments. */
export async function createStaffBooking(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await requireFrontDesk();
  const parsed = staffBookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const b = parsed.data;
  const supabase = await createClient();

  const { data: service } = await supabase.from("services").select("price").eq("id", b.serviceId).single();
  if (!service) return { ok: false, error: "That service doesn't exist." };

  // Find the patient by email, or create them.
  const email = b.email.toLowerCase();
  let { data: customer } = await supabase.from("customers").select("id").ilike("email", email).maybeSingle();
  if (!customer) {
    const created = await supabase.from("customers").insert({ full_name: b.fullName, email, phone: b.phone }).select("id").single();
    if (created.error) return { ok: false, error: friendlyDbError(created.error) };
    customer = created.data;
  }

  // reference_code is filled in by the database default (same SS-XXXXXXXX format as online bookings).
  const { data, error } = await supabase.from("reservations").insert({
    customer_id: customer.id,
    service_id: b.serviceId,
    resource_id: b.resourceId,
    starts_at: b.startsAt,
    ends_at: b.startsAt,        // recalculated by the database trigger
    blocked_until: b.startsAt,  // recalculated by the database trigger
    status: "confirmed",
    source: b.source,
    contact_name: b.fullName,
    contact_email: email,
    contact_phone: b.phone,
    patient_notes: b.notes || null,
    price: service.price,
    created_by: user.id,
  }).select("id").single();
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/reservations/${data.id}?created=1`);
}

// ---------------------------------------------------------------- payments

export async function reviewPayment(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({
    id: uuid,
    decision: z.enum(["verified", "rejected"]),
    reason: z.string().trim().max(500).optional(),
  }).safeParse({ id: formData.get("id"), decision: formData.get("decision"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (parsed.data.decision === "rejected" && !parsed.data.reason) {
    return { ok: false, error: "Tell the patient why the payment was rejected.", fieldErrors: { reason: "Required" } };
  }

  const supabase = await createClient();
  // verified_by / verified_at are stamped by the database, not sent from here.
  const { data, error } = await supabase.from("payments")
    .update({ status: parsed.data.decision, rejection_reason: parsed.data.reason ?? null })
    .eq("id", parsed.data.id)
    .eq("status", "awaiting_verification")
    .select("amount, reservation:reservations(reference_code, contact_email, contact_name)")
    .maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "This payment was already reviewed." };

  if (data.reservation) {
    await sendEmail(paymentReviewedEmail({
      to: data.reservation.contact_email, name: data.reservation.contact_name,
      reference: data.reservation.reference_code, amount: Number(data.amount),
      approved: parsed.data.decision === "verified", reason: parsed.data.reason,
    }));
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: undefined, message: parsed.data.decision === "verified" ? "Payment verified." : "Payment rejected." };
}

export async function recordPayment(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({
    reservationId: uuid,
    kind: z.enum(["payment", "refund"]),
    method: z.enum(["cash", "gcash", "maya", "bank_transfer", "card"]),
    amount: z.coerce.number().positive("Enter an amount.").max(1_000_000),
    referenceNo: z.string().trim().max(100).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the amount.", fieldErrors: fieldErrors(parsed.error) };
  const p = parsed.data;
  const supabase = await createClient();
  // Payments received at the desk are verified on the spot by the staff member recording them.
  const { error } = await supabase.from("payments").insert({
    reservation_id: p.reservationId, kind: p.kind, method: p.method, amount: p.amount,
    reference_no: p.referenceNo || null, status: "verified",
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: undefined, message: p.kind === "refund" ? "Refund recorded." : "Payment recorded." };
}

/** Short-lived link to a private receipt file. Only front desk may view receipts. */
export async function getProofUrl(paymentId: string): Promise<string | null> {
  await requireFrontDesk();
  if (!uuid.safeParse(paymentId).success) return null;
  const supabase = await createClient();
  // RLS check first: can this staff member see the payment at all?
  const { data } = await supabase.from("payments").select("proof_path").eq("id", paymentId).maybeSingle();
  if (!data?.proof_path) return null;
  const { data: signed } = await createAdminClient().storage.from("payment-proofs").createSignedUrl(data.proof_path, 60 * 5);
  return signed?.signedUrl ?? null;
}

// ---------------------------------------------------------------- catalog & schedule

export async function saveService(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({
    id: uuid.optional().or(z.literal("")),
    name: z.string().trim().min(2, "Enter a name.").max(120),
    categoryId: uuid.optional().or(z.literal("")),
    description: z.string().trim().max(2000).optional(),
    duration: z.coerce.number().int().min(5, "At least 5 minutes.").max(480),
    buffer: z.coerce.number().int().min(0).max(120),
    price: z.coerce.number().min(0, "Price can't be negative."),
    deposit: z.coerce.number().min(0),
    requiresApproval: z.string().optional(),
    isActive: z.string().optional(),
    dentistIds: z.array(uuid).default([]),
  }).refine((v) => v.deposit <= v.price, { path: ["deposit"], message: "Deposit can't be more than the price." })
    .safeParse({ ...Object.fromEntries(formData), dentistIds: formData.getAll("dentistIds") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const s = parsed.data;
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const supabase = await createClient();
  const row = {
    name: s.name, slug, category_id: s.categoryId || null, description: s.description || null,
    duration_minutes: s.duration, buffer_minutes: s.buffer, price: s.price, deposit_amount: s.deposit,
    requires_approval: s.requiresApproval === "on", is_active: s.isActive === "on",
  };
  const result = s.id
    ? await supabase.from("services").update(row).eq("id", s.id).select("id").single()
    : await supabase.from("services").insert(row).select("id").single();
  if (result.error) {
    return { ok: false, error: result.error.code === "23505" ? "A service with this name already exists." : friendlyDbError(result.error) };
  }

  const serviceId = result.data.id;
  await supabase.from("service_resources").delete().eq("service_id", serviceId);
  if (s.dentistIds.length) {
    const { error } = await supabase.from("service_resources").insert(s.dentistIds.map((resource_id) => ({ service_id: serviceId, resource_id })));
    if (error) return { ok: false, error: friendlyDbError(error) };
  }
  revalidatePath("/dashboard/services");
  revalidatePath("/");
  return { ok: true, data: undefined, message: "Service saved." };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveWorkingHours(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const resourceId = uuid.safeParse(formData.get("resourceId"));
  if (!resourceId.success) return { ok: false, error: "Invalid dentist." };

  // Form sends rows like start_1_0 / end_1_0 (weekday 1, block 0). Empty = no block.
  const rows: { resource_id: string; weekday: number; start_time: string; end_time: string }[] = [];
  for (let day = 0; day <= 6; day++) {
    for (let block = 0; block < 2; block++) {
      const start = String(formData.get(`start_${day}_${block}`) ?? "");
      const end = String(formData.get(`end_${day}_${block}`) ?? "");
      if (!start && !end) continue;
      if (!TIME.test(start) || !TIME.test(end) || end <= start) {
        return { ok: false, error: "Each block needs a start time before its end time." };
      }
      rows.push({ resource_id: resourceId.data, weekday: day, start_time: start, end_time: end });
    }
  }
  for (const r of rows) {
    const overlap = rows.find((o) => o !== r && o.weekday === r.weekday && o.start_time < r.end_time && r.start_time < o.end_time);
    if (overlap) return { ok: false, error: "Two time blocks on the same day overlap." };
  }

  const supabase = await createClient();
  const del = await supabase.from("working_hours").delete().eq("resource_id", resourceId.data);
  if (del.error) return { ok: false, error: friendlyDbError(del.error) };
  if (rows.length) {
    const ins = await supabase.from("working_hours").insert(rows);
    if (ins.error) return { ok: false, error: friendlyDbError(ins.error) };
  }
  revalidatePath("/dashboard/schedule");
  return { ok: true, data: undefined, message: "Working hours saved." };
}

export async function addClosure(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({ date: z.iso.date("Pick a date."), reason: z.string().trim().max(200).optional() })
    .safeParse({ date: formData.get("date"), reason: formData.get("reason") || undefined });
  if (!parsed.success) return { ok: false, error: "Pick a date.", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_closures").insert({ closed_on: parsed.data.date, reason: parsed.data.reason ?? null });
  if (error) return { ok: false, error: error.code === "23505" ? "That date is already closed." : friendlyDbError(error) };
  revalidatePath("/dashboard/schedule");
  return { ok: true, data: undefined, message: "Closure added. No online bookings that day." };
}

export async function removeClosure(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_closures").delete().eq("id", id.data);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard/schedule");
  return { ok: true, data: undefined };
}

export async function addTimeOff(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const parsed = z.object({
    resourceId: uuid,
    from: z.iso.datetime({ local: true }), to: z.iso.datetime({ local: true }),
    reason: z.string().trim().max(200).optional(),
  }).safeParse({ resourceId: formData.get("resourceId"), from: formData.get("from"), to: formData.get("to"), reason: formData.get("reason") || undefined });
  if (!parsed.success || parsed.data.to <= parsed.data.from) return { ok: false, error: "Choose a start and an end after it." };
  const toUtc = (local: string) => new Date(`${local.length === 16 ? local + ":00" : local}+08:00`).toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from("resource_time_off").insert({
    resource_id: parsed.data.resourceId,
    period: `[${toUtc(parsed.data.from)},${toUtc(parsed.data.to)})`,
    reason: parsed.data.reason ?? null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard/schedule");
  return { ok: true, data: undefined, message: "Time off added." };
}

// ---------------------------------------------------------------- owner only

export async function saveSettings(formData: FormData): Promise<ActionResult> {
  await requireOwner();
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    tagline: z.string().trim().max(200).optional(),
    email: z.email().optional().or(z.literal("")),
    phone: z.string().trim().max(30).optional(),
    address: z.string().trim().max(300).optional(),
    slotInterval: z.coerce.number().int().min(5).max(120),
    minNotice: z.coerce.number().int().min(0).max(10080),
    maxAdvance: z.coerce.number().int().min(1).max(365),
    cutoff: z.coerce.number().int().min(0).max(720),
    expiry: z.coerce.number().int().min(5).max(10080),
    autoConfirm: z.string().optional(),
    bookingPolicy: z.string().trim().max(2000).optional(),
    cancellationPolicy: z.string().trim().max(2000).optional(),
    paymentInstructions: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const s = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("clinic_settings").update({
    name: s.name, tagline: s.tagline || null, email: s.email || null, phone: s.phone || null, address: s.address || null,
    slot_interval_minutes: s.slotInterval, min_notice_minutes: s.minNotice, max_advance_days: s.maxAdvance,
    cancellation_cutoff_hours: s.cutoff, pending_expiry_minutes: s.expiry, auto_confirm: s.autoConfirm === "on",
    booking_policy: s.bookingPolicy || null, cancellation_policy: s.cancellationPolicy || null,
    payment_instructions: s.paymentInstructions || null,
  }).eq("id", 1).select("id").maybeSingle();
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data) return { ok: false, error: "Only the clinic owner can change settings." };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Settings saved." };
}

export async function setUserRole(formData: FormData): Promise<ActionResult> {
  await requireOwner();
  const parsed = z.object({ userId: uuid, role: z.enum(["owner", "secretary", "dentist", "patient"]), resourceId: uuid.optional().or(z.literal("")) })
    .safeParse({ userId: formData.get("userId"), role: formData.get("role"), resourceId: formData.get("resourceId") ?? "" });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { userId, role, resourceId } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, error: friendlyDbError(error) };

  // Link (or unlink) the dentist's calendar to this login.
  await supabase.from("resources").update({ profile_id: null }).eq("profile_id", userId);
  if (role === "dentist" && resourceId) {
    const { error: linkError } = await supabase.from("resources").update({ profile_id: userId }).eq("id", resourceId);
    if (linkError) return { ok: false, error: friendlyDbError(linkError) };
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, data: undefined, message: "Role updated." };
}

// ---------------------------------------------------------------- notifications

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireStaff();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).is("read_at", null);
  revalidatePath("/dashboard", "layout");
}
