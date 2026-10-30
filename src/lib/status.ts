import type { AppRole, PaymentStatus, ReservationStatus } from "@/lib/types";

/**
 * Mirrors the transition rules enforced by the database trigger
 * (private.reservation_before_write). The UI uses this only to decide which
 * buttons to SHOW; the database is still the one that decides what is ALLOWED.
 */
export const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ["confirmed", "rejected", "cancelled", "expired"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "completed"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
  rejected: [],
  no_show: [],
  expired: [],
};

const DENTIST_ALLOWED: ReservationStatus[] = ["checked_in", "in_progress", "completed", "no_show"];

/** Status buttons a given role should see for a reservation. */
export function nextStatusesFor(role: AppRole, current: ReservationStatus): ReservationStatus[] {
  const next = TRANSITIONS[current].filter((s) => s !== "expired"); // expiry is automatic
  if (role === "owner" || role === "secretary") return next;
  if (role === "dentist") return next.filter((s) => DENTIST_ALLOWED.includes(s));
  return [];
}

export const ACTION_LABEL: Record<ReservationStatus, string> = {
  pending: "Mark pending",
  confirmed: "Confirm",
  checked_in: "Check in",
  in_progress: "Start treatment",
  completed: "Complete",
  cancelled: "Cancel",
  rejected: "Reject",
  no_show: "Mark no-show",
  expired: "Expire",
};

/** Statuses that need a reason typed by staff. */
export const NEEDS_REASON: ReservationStatus[] = ["cancelled", "rejected"];

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const STATUS_TONE: Record<ReservationStatus, Tone> = {
  pending: "warning",
  confirmed: "info",
  checked_in: "info",
  in_progress: "info",
  completed: "success",
  cancelled: "neutral",
  rejected: "danger",
  no_show: "danger",
  expired: "neutral",
};

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  unpaid: "neutral",
  awaiting_verification: "warning",
  partially_paid: "info",
  paid: "success",
  refunded: "neutral",
  failed: "danger",
};

export const ACTIVE_STATUSES: ReservationStatus[] = ["pending", "confirmed", "checked_in", "in_progress"];
