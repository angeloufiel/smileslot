import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, clinicDateKey, clinicHour, clinicLocalToIso, formatPeso, plural } from "@/lib/format";
import { safeNext } from "@/lib/redirect";
import { nextStatusesFor, TRANSITIONS } from "@/lib/status";
import { bookingSchema, lookupSchema, paymentSchema } from "@/lib/validation";
import type { ReservationStatus } from "@/lib/types";

describe("status rules", () => {
  it("UI transitions match the database trigger exactly", () => {
    // The trigger in the migration is the source of truth. Parse its rules and compare,
    // so the two can never silently drift apart.
    const sql = readFileSync("supabase/migrations/20261030000200_triggers_and_helpers.sql", "utf8");
    const fromDb: Record<string, string[]> = {};
    for (const m of sql.matchAll(/old\.status = '(\w+)'\s+and new\.status (?:in \(([^)]+)\)|= '(\w+)')/g)) {
      fromDb[m[1]] = (m[2] ?? `'${m[3]}'`).split(",").map((s) => s.trim().replace(/'/g, ""));
    }
    for (const [from, to] of Object.entries(TRANSITIONS)) {
      expect(new Set(fromDb[from] ?? []), `transitions from ${from}`).toEqual(new Set(to));
    }
  });

  it("dentists only get chair-side actions", () => {
    expect(nextStatusesFor("dentist", "confirmed")).toEqual(["checked_in", "no_show"]);
    expect(nextStatusesFor("dentist", "pending")).toEqual([]);
  });

  it("front desk can approve or reject a pending booking but never set 'expired' by hand", () => {
    expect(nextStatusesFor("secretary", "pending")).toEqual(["confirmed", "rejected", "cancelled"]);
  });

  it("patients get no status buttons and finished bookings have none", () => {
    expect(nextStatusesFor("patient", "confirmed")).toEqual([]);
    for (const s of ["completed", "cancelled", "rejected", "no_show", "expired"] as ReservationStatus[]) {
      expect(nextStatusesFor("owner", s)).toEqual([]);
    }
  });
});

describe("dates in clinic time (Asia/Manila, UTC+8)", () => {
  it("uses the Manila calendar day, not the server's", () => {
    // 2026-11-02 17:30 UTC is already 01:30 on Nov 3 in Manila
    expect(clinicDateKey(new Date("2026-11-02T17:30:00Z"))).toBe("2026-11-03");
    expect(clinicHour("2026-11-02T17:30:00Z")).toBe(1);
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("converts a local clinic time to UTC", () => {
    expect(clinicLocalToIso("2026-11-03", "09:00")).toBe("2026-11-03T01:00:00.000Z");
  });
});

describe("formatting", () => {
  it("formats pesos", () => {
    expect(formatPeso(1500)).toBe("₱1,500.00");
  });
  it("pluralises", () => {
    expect(plural(1, "payment")).toBe("1 payment");
    expect(plural(3, "payment")).toBe("3 payments");
  });
});

describe("redirect safety", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["https://evil.example", "/home"],
    ["//evil.example", "/home"],
    ["/\\evil.example", "/home"],
    ["/ok\nSet-Cookie:x", "/home"],
    [null, "/home"],
  ])("safeNext(%j)", (input, expected) => {
    expect(safeNext(input, "/home")).toBe(expected);
  });
});

describe("input validation", () => {
  const base = {
    serviceId: "20000000-0000-4000-8000-000000000001",
    startsAt: "2026-11-03T01:00:00.000Z",
    fullName: "Juan Dela Cruz",
    email: "juan@example.com",
    phone: "0917 123 4567",
  };

  it("accepts a normal booking", () => {
    expect(bookingSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a filled honeypot (bots)", () => {
    expect(bookingSchema.safeParse({ ...base, website: "http://spam" }).success).toBe(false);
  });
  it("rejects bad phone numbers", () => {
    expect(bookingSchema.safeParse({ ...base, phone: "call me" }).success).toBe(false);
  });
  it("normalises reference numbers to upper case", () => {
    const r = lookupSchema.parse({ reference: " ss-7k4mq2xp ", email: "a@b.co" });
    expect(r.reference).toBe("SS-7K4MQ2XP");
  });
  it("only accepts online payment methods from patients", () => {
    const p = { reference: "SS-7K4MQ2XP", email: "a@b.co", amount: "300", referenceNo: "12345" };
    expect(paymentSchema.safeParse({ ...p, method: "gcash" }).success).toBe(true);
    expect(paymentSchema.safeParse({ ...p, method: "cash" }).success).toBe(false);
  });
});
