import { clinicDateKey, formatDate as formatFullDate, formatDateTime } from "@/lib/format";

export { formatDateTime };
export const todayIsoDate = () => clinicDateKey(new Date());
/** closed_on is a plain date; anchor it at noon Manila so it never shifts a day. */
export const formatDate = (date: string) => formatFullDate(`${date}T12:00:00+08:00`);

/** Postgres tstzrange text, e.g. ["2026-11-05 01:00:00+00","2026-11-05 09:00:00+00") → two ISO strings. */
export function parseRange(range: unknown): [string, string] {
  const parts = String(range).replace(/[[\]()"]/g, "").split(",");
  const iso = (s: string) => {
    const t = s.trim().replace(" ", "T");
    return new Date(/[+-]\d{2}$/.test(t) ? `${t}:00` : t).toISOString();
  };
  return [iso(parts[0]), iso(parts[1])];
}
