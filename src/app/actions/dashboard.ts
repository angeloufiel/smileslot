"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAnonClient, createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireFrontDesk, requireOwner, requireStaff } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { paymentReviewedEmail, sendEmail, statusChangedEmail } from "@/lib/email";
import { NEEDS_REASON } from "@/lib/status";
import { addDays, clinicDateKey } from "@/lib/format";
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

  // reference_code (the 8-digit booking number) is filled in by the database default.
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
  refresh();
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
  refresh();
  return { ok: true, data: undefined, message: "Clinic closed that day. No online bookings will be offered." };
}

export async function removeClosure(formData: FormData): Promise<ActionResult> {
  await requireFrontDesk();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_closures").delete().eq("id", id.data);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard/schedule");
  refresh();
  return { ok: true, data: undefined, message: "Clinic reopened that day." };
}

export type ClosedResult = {
  label: string;
  affected: { id: string; name: string; phone: string; startsAt: string; ref: string }[];
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Manila wall-clock time on a date → ISO. "24:00" means the end of that day. */
const toUtc = (date: string, hhmm: string) =>
  hhmm === "24:00"
    ? new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString()
    : new Date(`${date}T${hhmm.slice(0, 5)}:00+08:00`).toISOString();

/**
 * Close part of a dentist's day (urgent meeting, emergency).
 * Morning = until 12:00 noon, afternoon = from 12:00 noon, whole day, or a custom range.
 * The whole half-day is closed (not just working hours), so staff-made early or late
 * bookings are caught too. Dentists may close only their own time; RLS enforces that.
 * Bookings already in that time are NOT cancelled automatically; they are listed so staff can call the patients.
 */
export async function closeTime(formData: FormData): Promise<ActionResult<ClosedResult>> {
  await requireStaff();
  const parsed = z.object({
    resourceId: uuid,
    date: z.iso.date("Pick a date."),
    part: z.enum(["morning", "afternoon", "day", "custom"]),
    from: z.string().optional(),
    to: z.string().optional(),
    reason: z.string().trim().max(200).optional(),
  }).safeParse({
    resourceId: formData.get("resourceId"), date: formData.get("date"), part: formData.get("part"),
    from: formData.get("from") || undefined, to: formData.get("to") || undefined, reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Choose a dentist and a date.", fieldErrors: fieldErrors(parsed.error) };
  const { resourceId, date, part, reason } = parsed.data;
  if (date < clinicDateKey(new Date())) return { ok: false, error: "That day has already passed." };

  const supabase = await createClient();
  const { data: dentist } = await supabase.from("resources").select("name").eq("id", resourceId).maybeSingle();
  if (!dentist) return { ok: false, error: "Dentist not found." };

  let from = "00:00";
  let to = "24:00";
  if (part === "morning") to = "12:00";
  else if (part === "afternoon") from = "12:00";
  else if (part === "custom") {
    if (!parsed.data.from || !parsed.data.to || !HHMM.test(parsed.data.from) || !HHMM.test(parsed.data.to) || parsed.data.to <= parsed.data.from) {
      return { ok: false, error: "Choose a start time and an end time after it.", fieldErrors: { from: "Required" } };
    }
    from = parsed.data.from;
    to = parsed.data.to;
  }

  const start = toUtc(date, from);
  const end = toUtc(date, to);
  const { error } = await supabase.from("resource_time_off").insert({
    resource_id: resourceId,
    period: `[${start},${end})`,
    reason: reason || (part === "day" ? "Closed for the day" : part === "custom" ? "Closed" : `Closed ${part}`),
  });
  if (error) {
    return { ok: false, error: error.code === "42501" || error.message.includes("row-level security")
      ? "You can only close your own schedule." : friendlyDbError(error) };
  }

  // Bookings already inside the closed time (they stay booked; the clinic decides what to do).
  const { data: clash } = await supabase
    .from("reservations")
    .select("id, contact_name, contact_phone, starts_at, reference_code")
    .eq("resource_id", resourceId)
    .in("status", ["pending", "confirmed", "checked_in", "in_progress"])
    .lt("starts_at", end)
    .gt("blocked_until", start)
    .order("starts_at");

  revalidatePath("/dashboard/schedule");
  refresh();
  const day = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "Asia/Manila" })
    .format(new Date(`${date}T12:00:00+08:00`));
  const fmt = (hhmm: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })
    .format(new Date(toUtc(date, hhmm)));
  const when = part === "day" ? "the whole day" : part === "morning" ? "in the morning (until 12:00 noon)"
    : part === "afternoon" ? "in the afternoon (from 12:00 noon)" : `from ${fmt(from)} to ${fmt(to)}`;
  return {
    ok: true,
    data: {
      label: `${dentist.name} is closed on ${day}, ${when}. No online bookings will be offered then.`,
      affected: (clash ?? []).map((r) => ({ id: r.id, name: r.contact_name, phone: r.contact_phone, startsAt: r.starts_at, ref: r.reference_code })),
    },
  };
}

export async function reopenTime(id: string): Promise<ActionResult> {
  await requireStaff();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("resource_time_off").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false, error: "You can only reopen your own closed times." };
  revalidatePath("/dashboard/schedule");
  refresh();
  return { ok: true, data: undefined, message: "Reopened. Patients can book that time again." };
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

// ---------------------------------------------------------------- staff (owner only)

const STAFF_ROLE = z.enum(["owner", "secretary", "dentist", "patient"]);
const personName = z.string().trim().min(2, "Enter the full name.").max(120);
const calendarChoice = z.union([z.literal(""), z.literal("new"), uuid]);

/** Easy-to-read temporary password, e.g. K7QM-4TXP-9WRA (no 0/O or 1/I/L to confuse). */
function tempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/**
 * Link a dentist login to a calendar (the "resources" row the booking engine schedules).
 * "new" creates a calendar with the person's name and offers every active service.
 * Runs as the signed-in owner, so RLS still decides.
 */
async function linkCalendar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  choice: string,
  name: string,
  title: string | undefined,
): Promise<string | null> {
  // A login has at most one calendar: detach whatever it had first.
  const keep = choice !== "" && choice !== "new" ? choice : null;
  let unlinkQuery = supabase.from("resources").update({ profile_id: null }).eq("profile_id", userId);
  if (keep) unlinkQuery = unlinkQuery.neq("id", keep);
  const unlink = await unlinkQuery;
  if (unlink.error) return friendlyDbError(unlink.error);
  if (choice === "") return null;

  if (choice === "new") {
    const { data, error } = await supabase
      .from("resources")
      .insert({ type: "dentist", name, title: title || "Dentist", profile_id: userId, is_active: true })
      .select("id")
      .single();
    if (error || !data) return friendlyDbError(error);
    const { data: services } = await supabase.from("services").select("id").eq("is_active", true);
    if (services?.length) {
      const link = await supabase.from("service_resources").insert(services.map((sv) => ({ service_id: sv.id, resource_id: data.id })));
      if (link.error) return friendlyDbError(link.error);
    }
    return null;
  }

  const { data, error } = await supabase
    .from("resources")
    .update({ profile_id: userId, name, ...(title ? { title } : {}) })
    .eq("id", choice)
    .select("id");
  if (error) return error.code === "23505" ? "That calendar already belongs to another dentist." : friendlyDbError(error);
  if (!data?.length) return "Calendar not found.";
  return null;
}

export type NewStaff = { email: string; password: string; name: string };

export async function addStaff(formData: FormData): Promise<ActionResult<NewStaff>> {
  await requireOwner();
  const parsed = z.object({
    fullName: personName,
    email: z.email("Enter a valid email.").transform((v) => v.trim().toLowerCase()),
    role: z.enum(["secretary", "dentist", "owner"]),
    calendar: calendarChoice,
    title: z.string().trim().max(120).optional(),
  }).safeParse({
    fullName: formData.get("fullName"), email: String(formData.get("email") ?? "").trim(), role: formData.get("role"),
    calendar: formData.get("calendar") ?? "", title: formData.get("title") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { fullName, email, role, calendar, title } = parsed.data;
  if (role === "dentist" && calendar === "") {
    return { ok: false, error: "Choose the dentist's calendar, or create a new one.", fieldErrors: { calendar: "Required" } };
  }

  // Only the Admin API can create a login for someone else. Everything after that runs as the owner.
  const admin = createAdminClient();
  const password = tempPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    const exists = createError?.code === "email_exists" || /already|registered|exists/i.test(createError?.message ?? "");
    return exists
      ? { ok: false, error: "Someone already has an account with this email. Find them in the list (check Patient accounts) and press Edit.", fieldErrors: { email: "Already registered" } }
      : { ok: false, error: "The account couldn't be created. Please try again." };
  }
  const userId = created.user.id;

  const supabase = await createClient();
  const rollback = async (message: string): Promise<ActionResult<NewStaff>> => {
    await admin.auth.admin.deleteUser(userId); // don't leave a half-made account behind
    return { ok: false, error: message };
  };
  const { data: updated, error: roleError } = await supabase.from("profiles").update({ role, full_name: fullName }).eq("id", userId).select("id");
  if (roleError || !updated?.length) return rollback(roleError ? friendlyDbError(roleError) : "The role couldn't be saved.");
  if (role === "dentist") {
    const linkError = await linkCalendar(supabase, userId, calendar, fullName, title);
    if (linkError) return rollback(linkError);
  }

  revalidatePath("/dashboard/settings");
  refresh();
  return { ok: true, data: { email, password, name: fullName } };
}

export async function updateStaff(formData: FormData): Promise<ActionResult> {
  const owner = await requireOwner();
  const parsed = z.object({
    userId: uuid,
    fullName: personName,
    role: STAFF_ROLE,
    calendar: calendarChoice,
    title: z.string().trim().max(120).optional(),
  }).safeParse({
    userId: formData.get("userId"), fullName: formData.get("fullName"), role: formData.get("role"),
    calendar: formData.get("calendar") ?? "", title: formData.get("title") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { userId, fullName, role, calendar, title } = parsed.data;
  if (userId === owner.id && role !== "owner") return { ok: false, error: "You can't remove your own owner role." };
  if (role === "dentist" && calendar === "") {
    return { ok: false, error: "Choose the dentist's calendar, or create a new one.", fieldErrors: { calendar: "Required" } };
  }

  const supabase = await createClient();
  // .select() makes a silent "0 rows updated" (RLS) visible instead of a false "saved".
  const { data, error } = await supabase.from("profiles").update({ full_name: fullName, role }).eq("id", userId).select("id, role");
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (!data?.length || data[0].role !== role) return { ok: false, error: "Nothing was saved. Refresh the page and try again." };

  const linkError = await linkCalendar(supabase, userId, role === "dentist" ? calendar : "", fullName, title);
  if (linkError) return { ok: false, error: linkError };

  revalidatePath("/dashboard", "layout");
  refresh();
  return { ok: true, data: undefined, message: `${fullName} saved.` };
}

// ---------------------------------------------------------------- my account (any staff)

export async function updateMyName(formData: FormData): Promise<ActionResult> {
  const user = await requireStaff();
  const parsed = personName.safeParse(formData.get("fullName"));
  if (!parsed.success) return { ok: false, error: "Enter your full name.", fieldErrors: { fullName: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ full_name: parsed.data }).eq("id", user.id).select("id");
  if (error || !data?.length) return { ok: false, error: friendlyDbError(error) };
  // Keep a dentist's public calendar name in step (RLS lets only the front desk write calendars, so for a dentist the owner does this from Settings).
  await supabase.from("resources").update({ name: parsed.data }).eq("profile_id", user.id);
  revalidatePath("/dashboard", "layout");
  refresh();
  return { ok: true, data: undefined, message: "Name saved." };
}

export async function changeMyPassword(formData: FormData): Promise<ActionResult> {
  const user = await requireStaff();
  const parsed = z.object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(10, "Use at least 10 characters.").max(72),
    confirm: z.string(),
  }).refine((v) => v.next === v.confirm, { path: ["confirm"], message: "The two new passwords don't match." })
    .safeParse({ current: formData.get("current"), next: formData.get("next"), confirm: formData.get("confirm") });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  // Check the current password on a throwaway client, so a stolen open session can't silently change it.
  const check = createAnonClient();
  const { error: wrong } = await check.auth.signInWithPassword({ email: user.email, password: parsed.data.current });
  if (wrong) return { ok: false, error: "Your current password is wrong.", fieldErrors: { current: "Wrong password" } };
  await check.auth.signOut({ scope: "local" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.next });
  if (error) {
    return { ok: false, error: /different|same/i.test(error.message) ? "Choose a password you haven't used here before." : "The password couldn't be changed. Please try again." };
  }
  return { ok: true, data: undefined, message: "Password changed. Use the new one next time you sign in." };
}

// ---------------------------------------------------------------- notifications
// RLS limits every query here to the signed-in person's own notifications.

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireStaff();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).is("read_at", null);
  revalidatePath("/dashboard", "layout");
  refresh();
}

export async function markNotificationRead(id: string): Promise<void> {
  await requireStaff();
  if (!uuid.safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  revalidatePath("/dashboard", "layout");
  refresh();
}

export async function deleteNotification(id: string): Promise<ActionResult> {
  await requireStaff();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard", "layout");
  refresh();
  return { ok: true, data: undefined, message: "Notification deleted." };
}

export async function deleteAllNotifications(): Promise<ActionResult> {
  const user = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").delete().eq("recipient_id", user.id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/dashboard", "layout");
  refresh();
  return { ok: true, data: undefined, message: "All notifications deleted." };
}
