/**
 * Creates the demo login accounts (one per role), links the dentists to their calendars,
 * and (only on an empty clinic) adds sample appointments so the live demo isn't blank.
 *
 *   npm run seed:users
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_PASSWORD in .env.local.
 * Uses the Admin API so Supabase hashes the passwords. Safe to run more than once.
 * Never run this against a real clinic's production project.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !secret || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_PASSWORD first.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("DEMO_PASSWORD must be at least 10 characters.");
  process.exit(1);
}

const admin = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

const DEMO = [
  { email: "owner@demo.smileslot.app", fullName: "Olivia Ramos", role: "owner" as const },
  { email: "secretary@demo.smileslot.app", fullName: "Rhea Santos", role: "secretary" as const },
  { email: "dr.ana@demo.smileslot.app", fullName: "Dr. Ana Villanueva", role: "dentist" as const, resourceId: "30000000-0000-4000-8000-000000000001" },
  { email: "dr.marco@demo.smileslot.app", fullName: "Dr. Marco Dela Peña", role: "dentist" as const, resourceId: "30000000-0000-4000-8000-000000000002" },
  { email: "patient@demo.smileslot.app", fullName: "Paolo Cruz", role: "patient" as const },
];

async function findUserId(email: string) {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

for (const person of DEMO) {
  let id = await findUserId(person.email);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email: person.email,
      password: password!,
      email_confirm: true,
      user_metadata: { full_name: person.fullName, phone: "0917 000 0000" },
    });
    if (error) throw error;
    id = data.user.id;
    console.log(`created ${person.email}`);
  } else {
    await admin.auth.admin.updateUserById(id, { password: password! });
    console.log(`exists  ${person.email} (password reset to DEMO_PASSWORD)`);
  }

  const { error: roleError } = await admin.from("profiles").update({ role: person.role, full_name: person.fullName }).eq("id", id);
  if (roleError) throw roleError;

  if ("resourceId" in person && person.resourceId) {
    const { error } = await admin.from("resources").update({ profile_id: id }).eq("id", person.resourceId);
    if (error) throw error;
  }
}

// ---------------------------------------------------------------- sample appointments
// Only when the clinic has no appointments yet, so the live demo never looks empty.
const { count } = await admin.from("reservations").select("id", { count: "exact", head: true });
if ((count ?? 0) === 0) {
  const ANA = "30000000-0000-4000-8000-000000000001";
  const MARCO = "30000000-0000-4000-8000-000000000002";
  const SVC = {
    consultation: "20000000-0000-4000-8000-000000000001",
    cleaning: "20000000-0000-4000-8000-000000000002",
    extraction: "20000000-0000-4000-8000-000000000003",
    filling: "20000000-0000-4000-8000-000000000004",
    whitening: "20000000-0000-4000-8000-000000000005",
    braces: "20000000-0000-4000-8000-000000000006",
  };
  const PRICE: Record<string, number> = { consultation: 500, cleaning: 1000, extraction: 1500, filling: 1500, whitening: 8000, braces: 800 };

  // Clinic-local working days (Tue–Sat, when both dentists are in), relative to today.
  const manilaToday = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const day = (offset: number) => {
    const d = new Date(`${manilaToday}T12:00:00Z`);
    let moved = 0;
    const step = offset >= 0 ? 1 : -1;
    while (moved < Math.abs(offset)) {
      d.setUTCDate(d.getUTCDate() + step);
      if (d.getUTCDay() >= 2 && d.getUTCDay() <= 6) moved++;
    }
    return d.toISOString().slice(0, 10);
  };
  const at = (dayKey: string, hhmm: string) => new Date(`${dayKey}T${hhmm}:00+08:00`).toISOString();

  const { data: paolo } = await admin.from("customers").select("id").eq("email", "patient@demo.smileslot.app").single();
  const guests = [
    { full_name: "Maria Santos", email: "maria.santos@example.com", phone: "0917 111 2201", is_vip: true },
    { full_name: "Jose Rivera", email: "jose.rivera@example.com", phone: "0917 111 2202" },
    { full_name: "Carmela Reyes", email: "carmela.reyes@example.com", phone: "0917 111 2203" },
    { full_name: "Ramon Bautista", email: "ramon.bautista@example.com", phone: "0917 111 2204" },
    { full_name: "Liza Fernandez", email: "liza.fernandez@example.com", phone: "0917 111 2205" },
  ];
  const { data: created, error: guestError } = await admin.from("customers").insert(guests, { defaultToNull: false }).select("id, full_name, email, phone");
  if (guestError) throw guestError;
  const who = (name: string) => {
    const c = created!.find((g) => g.full_name === name)!;
    return { customer_id: c.id, contact_name: c.full_name, contact_email: c.email, contact_phone: c.phone! };
  };
  const paoloContact = { customer_id: paolo!.id, contact_name: "Paolo Cruz", contact_email: "patient@demo.smileslot.app", contact_phone: "0917 000 0000" };

  type Row = { svc: keyof typeof SVC; dentist: string; start: string; status: string; person: ReturnType<typeof who>; source?: string; notes?: string; deposit?: number; expires?: string };
  const rows: Row[] = [
    { svc: "cleaning", dentist: ANA, start: at(day(-3), "09:00"), status: "completed", person: who("Maria Santos") },
    { svc: "consultation", dentist: MARCO, start: at(day(-3), "10:00"), status: "no_show", person: who("Ramon Bautista") },
    { svc: "consultation", dentist: ANA, start: at(day(-1), "14:00"), status: "completed", person: paoloContact },
    { svc: "filling", dentist: ANA, start: at(day(1), "09:00"), status: "confirmed", person: who("Jose Rivera"), notes: "Upper right molar feels sensitive to cold." },
    { svc: "braces", dentist: MARCO, start: at(day(1), "10:30"), status: "pending", person: who("Carmela Reyes") },
    { svc: "cleaning", dentist: MARCO, start: at(day(1), "14:00"), status: "confirmed", person: paoloContact },
    { svc: "whitening", dentist: ANA, start: at(day(2), "13:00"), status: "pending", person: who("Liza Fernandez"), deposit: 2000, expires: new Date(Date.now() + 3600_000).toISOString() },
    { svc: "extraction", dentist: ANA, start: at(day(3), "10:00"), status: "confirmed", person: who("Maria Santos"), source: "phone" },
    { svc: "consultation", dentist: MARCO, start: at(day(3), "15:00"), status: "confirmed", person: who("Ramon Bautista"), source: "walk_in" },
  ];
  for (const r of rows) {
    const { data: res, error } = await admin.from("reservations").insert({
      ...r.person,
      service_id: SVC[r.svc],
      resource_id: r.dentist,
      starts_at: r.start,
      ends_at: r.start,        // the database trigger calculates the real end time
      blocked_until: r.start,
      status: r.status as never,
      source: (r.source ?? "online") as never,
      patient_notes: r.notes ?? null,
      price: PRICE[r.svc],
      deposit_required: r.deposit ?? 0,
      expires_at: r.expires ?? null,
    }).select("id").single();
    if (error) throw error;
    if (r.svc === "whitening") {
      // A GCash deposit waiting for the front desk to verify
      await admin.from("payments").insert({ reservation_id: res.id, method: "gcash", amount: 2000, reference_no: "1009 876 5432", status: "awaiting_verification" });
    }
    if (r.status === "completed") {
      await admin.from("payments").insert({ reservation_id: res.id, method: "cash", amount: PRICE[r.svc], status: "verified" });
    }
  }
  console.log(`created ${rows.length} sample appointments`);
}

console.log("\nDemo accounts ready. Password: the DEMO_PASSWORD you set.");
