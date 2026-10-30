import { z } from "zod";

// First line of defence: friendly errors before a round-trip.
// The database functions re-validate everything, so these are for UX, not security.

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number, for example 0917 123 4567.");

export const bookingSchema = z.object({
  serviceId: z.uuid("Choose a service."),
  resourceId: z.uuid().optional().or(z.literal("")).transform((v) => v || undefined),
  startsAt: z.iso.datetime({ offset: true, message: "Choose a time." }),
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.email("Enter a valid email address.").max(254),
  phone: phoneSchema,
  notes: z.string().trim().max(1000, "Notes can be up to 1,000 characters.").optional(),
  // Honeypot: real people never see or fill this field.
  website: z.string().max(0, "Spam check failed.").optional(),
});

export const lookupSchema = z.object({
  // Accept "4827-3159", "4827 3159" or "48273159"; keep digits only.
  reference: z.string().transform((v) => v.replace(/\D/g, "")).pipe(
    z.string().regex(/^[1-9]\d{7}$/, "Booking numbers have 8 digits, like 4827-3159."),
  ),
  email: z.email("Enter the email you booked with."),
});

export const MAX_PROOF_BYTES = 4 * 1024 * 1024; // Vercel accepts at most 4.5 MB per request
export const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export const paymentSchema = lookupSchema.extend({
  method: z.enum(["gcash", "maya", "bank_transfer"], "Choose a payment method."),
  amount: z.coerce.number().positive("Enter the amount you paid.").max(1_000_000),
  referenceNo: z.string().trim().min(4, "Enter the receipt reference number.").max(100),
});

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  phone: phoneSchema,
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters.").max(72),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** Flattens zod issues into { field: message } for inline form errors. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
