/**
 * The database raises short error codes (e.g. "SLOT_UNAVAILABLE: ...").
 * This turns them into messages a patient or secretary can act on.
 * Unknown errors get a generic message; the raw error is only logged on the server.
 */
const MESSAGES: Record<string, string> = {
  SLOT_UNAVAILABLE: "That time was just taken or is no longer available. Please pick another time.",
  INVALID_NAME: "Enter your full name (at least 2 characters).",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PHONE: "Enter a valid phone number, for example 0917 123 4567.",
  NOTES_TOO_LONG: "Notes can be up to 1,000 characters.",
  SERVICE_NOT_FOUND: "That service is not available.",
  STAFF_USE_DASHBOARD: "Staff accounts create bookings from the dashboard.",
  CONFIRM_EMAIL_FIRST: "Your account isn't ready yet. Please sign out and sign in again.",
  NOT_A_PATIENT: "Sign in with a patient account to add bookings.",
  BOOKING_NOT_FOUND: "We couldn't find a booking with that booking number and email.",
  CANNOT_CANCEL_STATUS: "This booking can no longer be cancelled online.",
  CANCELLATION_WINDOW_PASSED: "It's less than 24 hours before your appointment. Please call the clinic to cancel.",
  INVALID_METHOD: "Choose GCash, Maya or bank transfer.",
  INVALID_REFERENCE_NO: "Enter the reference number from your GCash, Maya or bank receipt.",
  INVALID_AMOUNT: "The amount is more than the remaining balance.",
  INVALID_PROOF_PATH: "The uploaded file could not be attached. Please try again.",
  CANNOT_PAY_STATUS: "Payments can't be added to this booking anymore.",
  INVALID_STATUS_TRANSITION: "That status change isn't allowed from the booking's current status.",
  RESOURCE_CANNOT_PERFORM_SERVICE: "That dentist doesn't offer this service.",
  PAYMENT_FINALIZED: "This payment was already processed. Record a refund instead.",
  LAST_OWNER: "The clinic must keep at least one active owner.",
  FORBIDDEN: "You don't have permission to do that.",
  INVALID_TIMEZONE: "That time zone isn't valid.",
};

export function friendlyDbError(error: { message?: string; code?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  const key = Object.keys(MESSAGES).find((k) => msg.startsWith(k));
  if (key) return MESSAGES[key];
  if (error?.code === "23P01" || msg.includes("reservations_no_overlap")) {
    return "That dentist already has an appointment at that time.";
  }
  if (error?.code === "42501" || msg.includes("row-level security")) return MESSAGES.FORBIDDEN;
  console.error("[db]", error);
  return "Something went wrong. Please try again.";
}
