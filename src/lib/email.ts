import "server-only";
import { formatDateTime, formatPeso } from "@/lib/format";
import { publicEnv } from "@/lib/env";

/**
 * Transactional email through Resend's HTTP API.
 * If RESEND_API_KEY is not set (local development, demo), emails are logged
 * instead of sent, and the app keeps working. Email failures never block a
 * booking: the in-app notification and the database record are the source of truth.
 */
type Email = { to: string; subject: string; text: string };

export async function sendEmail({ to, subject, text }: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "SmileSlot <onboarding@resend.dev>";
  if (!key) {
    console.info(`[email skipped: RESEND_API_KEY not set] to=${to} subject="${subject}"`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) console.error("[email] Resend error", res.status, await res.text());
  } catch (err) {
    console.error("[email] failed", err);
  }
}

const trackUrl = () => `${publicEnv.siteUrl()}/track`;

export function bookingReceivedEmail(b: {
  to: string; name: string; reference: string; service: string; dentist: string;
  startsAt: string; status: string; deposit: number; expiresAt: string | null;
}): Email {
  const lines = [
    `Hi ${b.name},`,
    "",
    b.status === "confirmed"
      ? "Your appointment is confirmed."
      : "We received your booking request.",
    "",
    `Reference: ${b.reference}`,
    `Service:   ${b.service}`,
    `Dentist:   ${b.dentist}`,
    `When:      ${formatDateTime(b.startsAt)}`,
    "",
  ];
  if (b.deposit > 0) {
    lines.push(
      `A deposit of ${formatPeso(b.deposit)} holds your slot` +
        (b.expiresAt ? ` until ${formatDateTime(b.expiresAt)}.` : "."),
      "Pay by GCash, Maya or bank transfer, then submit the receipt on the tracking page.",
      "",
    );
  } else if (b.status === "pending") {
    lines.push("The clinic will review your request and email you once it's confirmed.", "");
  }
  lines.push(`Track or cancel your booking: ${trackUrl()}`, "Use your reference number and this email address.");
  return { to: b.to, subject: `Booking ${b.reference}: ${b.status === "confirmed" ? "confirmed" : "received"}`, text: lines.join("\n") };
}

export function statusChangedEmail(b: {
  to: string; name: string; reference: string; status: string; startsAt: string; reason?: string | null;
}): Email {
  const label = b.status.replaceAll("_", " ");
  return {
    to: b.to,
    subject: `Booking ${b.reference} is now ${label}`,
    text: [
      `Hi ${b.name},`,
      "",
      `Your appointment on ${formatDateTime(b.startsAt)} (reference ${b.reference}) is now ${label}.`,
      b.reason ? `Note from the clinic: ${b.reason}` : "",
      "",
      `Details: ${trackUrl()}`,
    ].filter((l) => l !== null).join("\n"),
  };
}

export function paymentReviewedEmail(b: {
  to: string; name: string; reference: string; amount: number; approved: boolean; reason?: string | null;
}): Email {
  return {
    to: b.to,
    subject: b.approved ? `Payment received for ${b.reference}` : `Payment for ${b.reference} needs attention`,
    text: [
      `Hi ${b.name},`,
      "",
      b.approved
        ? `We verified your payment of ${formatPeso(b.amount)} for booking ${b.reference}. Thank you!`
        : `We couldn't verify your payment of ${formatPeso(b.amount)} for booking ${b.reference}.`,
      !b.approved && b.reason ? `Reason: ${b.reason}` : "",
      "",
      `Details: ${trackUrl()}`,
    ].join("\n"),
  };
}
