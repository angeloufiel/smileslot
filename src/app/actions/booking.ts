"use server";

import { randomUUID } from "node:crypto";
import { refresh, revalidatePath } from "next/cache";
import { createAnonClient, createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { bookingReceivedEmail, sendEmail } from "@/lib/email";
import {
  bookingSchema, fieldErrors, lookupSchema, MAX_PROOF_BYTES, paymentSchema, PROOF_TYPES,
} from "@/lib/validation";
import type { ActionResult, PaymentStatus, ReservationStatus } from "@/lib/types";

/* Every action re-validates its input on the server. The browser is never trusted. */

export type Slot = { resourceId: string; resourceName: string; startsAt: string };

export async function getSlotsAction(serviceId: string, date: string, resourceId?: string): Promise<Slot[]> {
  if (!/^[0-9a-f-]{36}$/i.test(serviceId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (resourceId && !/^[0-9a-f-]{36}$/i.test(resourceId)) return [];
  const { data, error } = await createAnonClient().rpc("get_available_slots", {
    p_service_id: serviceId,
    p_date: date,
    ...(resourceId ? { p_resource_id: resourceId } : {}),
  });
  if (error) {
    console.error("[slots]", error);
    return [];
  }
  return (data ?? []).map((s) => ({ resourceId: s.resource_id, resourceName: s.resource_name, startsAt: s.slot_start }));
}

export type BookingConfirmation = {
  reference: string;
  status: ReservationStatus;
  startsAt: string;
  dentist: string;
  price: number;
  deposit: number;
  expiresAt: string | null;
};

export async function createBookingAction(input: Record<string, string>): Promise<ActionResult<BookingConfirmation>> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const b = parsed.data;

  // Logged-in patients book as themselves (RLS + the function use their verified email).
  // Everyone else books as an anonymous guest.
  const user = await getCurrentUser();
  if (user && user.role !== "patient") {
    return { ok: false, error: "You're signed in as staff. Use Dashboard → New booking instead." };
  }
  const supabase = user ? await createClient() : createAnonClient();

  const { data, error } = await supabase
    .rpc("book_appointment", {
      p_service_id: b.serviceId,
      p_starts_at: b.startsAt,
      p_full_name: b.fullName,
      p_email: b.email,
      p_phone: b.phone,
      ...(b.resourceId ? { p_resource_id: b.resourceId } : {}),
      ...(b.notes ? { p_notes: b.notes } : {}),
    })
    .single();
  if (error || !data) return { ok: false, error: friendlyDbError(error) };

  const { data: service } = await createAnonClient().from("services").select("name").eq("id", b.serviceId).single();
  await sendEmail(
    bookingReceivedEmail({
      to: user?.email || b.email,
      name: b.fullName,
      reference: data.reference_code,
      service: service?.name ?? "Dental appointment",
      dentist: data.resource_name,
      startsAt: data.starts_at,
      status: data.status,
      deposit: Number(data.deposit_required),
      expiresAt: data.expires_at,
    }),
  );
  revalidatePath("/my/bookings");

  return {
    ok: true,
    data: {
      reference: data.reference_code,
      status: data.status,
      startsAt: data.starts_at,
      dentist: data.resource_name,
      price: Number(data.price),
      deposit: Number(data.deposit_required),
      expiresAt: data.expires_at,
    },
  };
}

export type TrackedBooking = {
  reference: string;
  email: string;
  status: ReservationStatus;
  service: string;
  dentist: string;
  startsAt: string;
  endsAt: string;
  price: number;
  deposit: number;
  amountPaid: number;
  paymentStatus: PaymentStatus;
  expiresAt: string | null;
  canCancel: boolean;
};

async function lookup(reference: string, email: string): Promise<TrackedBooking | null> {
  const { data } = await createAnonClient().rpc("get_booking", { p_reference: reference, p_email: email }).maybeSingle();
  if (!data) return null;
  return {
    reference: data.reference_code,
    email,
    status: data.status,
    service: data.service_name,
    dentist: data.dentist_name,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    price: Number(data.price),
    deposit: Number(data.deposit_required),
    amountPaid: Number(data.amount_paid),
    paymentStatus: data.payment_status,
    expiresAt: data.expires_at,
    canCancel: data.can_cancel,
  };
}

export async function lookupBookingAction(input: { reference: string; email: string }): Promise<ActionResult<TrackedBooking>> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const booking = await lookup(parsed.data.reference, parsed.data.email);
  // Same message whether the reference or the email was wrong: don't reveal which.
  if (!booking) return { ok: false, error: "We couldn't find a booking with that booking number and email." };
  return { ok: true, data: booking };
}

export async function cancelBookingAction(input: { reference: string; email: string; reason?: string }): Promise<ActionResult<TrackedBooking>> {
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid booking details." };
  const { error } = await createAnonClient().rpc("cancel_booking", {
    p_reference: parsed.data.reference,
    p_email: parsed.data.email,
    p_reason: (input.reason ?? "").slice(0, 500),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  const booking = await lookup(parsed.data.reference, parsed.data.email);
  revalidatePath("/my/bookings");
  return booking ? { ok: true, data: booking, message: "Your booking was cancelled." } : { ok: false, error: "Booking not found." };
}

/**
 * Guest or patient submits a GCash / Maya / bank transfer receipt.
 *  1. Verify reference + email (get_booking) BEFORE touching storage.
 *  2. Upload the file with the service role into payment-proofs/<REFERENCE>/<random name>.
 *  3. submit_payment() records it as "awaiting_verification". Staff must verify it.
 */
export async function submitPaymentAction(formData: FormData): Promise<ActionResult<TrackedBooking>> {
  const parsed = paymentSchema.safeParse({
    reference: formData.get("reference"),
    email: formData.get("email"),
    method: formData.get("method"),
    amount: formData.get("amount"),
    referenceNo: formData.get("referenceNo"),
  });
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const p = parsed.data;

  const booking = await lookup(p.reference, p.email);
  if (!booking) return { ok: false, error: "We couldn't find a booking with that booking number and email." };

  const file = formData.get("proof");
  let proofPath: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PROOF_BYTES) return { ok: false, error: "The file is larger than 4 MB. Send a screenshot instead of a photo of the screen.", fieldErrors: { proof: "Max 4 MB." } };
    if (!(PROOF_TYPES as readonly string[]).includes(file.type)) {
      return { ok: false, error: "Upload a JPG, PNG, WebP or PDF.", fieldErrors: { proof: "JPG, PNG, WebP or PDF only." } };
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[file.type];
    proofPath = `${booking.reference}/${randomUUID()}.${ext}`; // random name: never trust the uploaded file name
    const { error: uploadError } = await createAdminClient()
      .storage.from("payment-proofs")
      .upload(proofPath, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error("[proof upload]", uploadError);
      return { ok: false, error: "The receipt couldn't be uploaded. Please try again." };
    }
  } else {
    return { ok: false, error: "Attach a screenshot or PDF of your receipt.", fieldErrors: { proof: "Attach your receipt." } };
  }

  const { error } = await createAnonClient().rpc("submit_payment", {
    p_reference: booking.reference,
    p_email: p.email,
    p_method: p.method,
    p_amount: p.amount,
    p_reference_no: p.referenceNo,
    p_proof_path: proofPath,
  });
  if (error) {
    await createAdminClient().storage.from("payment-proofs").remove([proofPath]); // don't leave orphan files
    return { ok: false, error: friendlyDbError(error) };
  }

  const updated = await lookup(p.reference, p.email);
  return updated
    ? { ok: true, data: updated, message: "Receipt sent. The clinic will verify it and email you." }
    : { ok: false, error: "Booking not found." };
}

/** A signed-in patient adds a booking they made as a guest (needs its booking number). */
export async function claimBookingAction(formData: FormData): Promise<ActionResult> {
  await requireUser();
  const digits = String(formData.get("reference") ?? "").replace(/\D/g, "");
  if (!/^[1-9]\d{7}$/.test(digits)) {
    return { ok: false, error: "Booking numbers have 8 digits, like 4827-3159.", fieldErrors: { reference: "8 digits" } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_booking", { p_reference: digits });
  if (error) {
    return { ok: false, error: error.message.includes("BOOKING_NOT_FOUND")
      ? "No booking with that number was made with your email. Check the number in your booking email."
      : friendlyDbError(error) };
  }
  revalidatePath("/my/bookings");
  refresh();
  return { ok: true, data: undefined, message: "Added to your bookings." };
}
