// Display helpers. All times are stored in UTC and shown in clinic time.
export const CLINIC_TZ = "Asia/Manila";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export const formatPeso = (n: number | string | null | undefined) => peso.format(Number(n ?? 0));

export function formatDateTime(iso: string, tz = CLINIC_TZ) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDate(iso: string, tz = CLINIC_TZ) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

export function formatTime(iso: string, tz = CLINIC_TZ) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "YYYY-MM-DD" for a Date as seen in the clinic's time zone. */
export function clinicDateKey(d: Date, tz = CLINIC_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Adds whole days to a "YYYY-MM-DD" key without time-zone drift. */
export function addDays(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Converts a clinic-local date + "HH:MM" into a UTC ISO string (Manila has no DST: fixed +08:00). */
export function clinicLocalToIso(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00+08:00`).toISOString();
}

export function humanize(value: string) {
  const s = value.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hour of day (0–23) in clinic time. */
export function clinicHour(iso: string, tz = CLINIC_TZ) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", gcash: "GCash", maya: "Maya", bank_transfer: "Bank transfer", card: "Card", online_gateway: "Online payment",
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? humanize(m);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Booking numbers are stored as 8 digits and shown as 4827-3159 (easy to read aloud). */
export function formatRef(code: string | null | undefined) {
  const c = code ?? "";
  return /^\d{8}$/.test(c) ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Whatever a patient typed ("4827 3159", "4827-3159") → "48273159". */
export const normalizeRef = (input: string) => input.replace(/\D/g, "");
