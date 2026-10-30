/**
 * FACTORY RESET: prepares this Supabase project for a new clinic.
 *
 *   npm run reset:clinic -- --confirm <project-ref>
 *
 * DELETES, permanently:
 *   - every login (owner, secretaries, dentists, patients)
 *   - every patient record, appointment, note, payment and receipt file
 *   - every notification and the audit log
 *   - dentist calendars with their weekly hours and closed times
 *   - the clinic logo
 * KEEPS (all editable from the dashboard): the service list and prices,
 * service categories, and the holiday closures.
 * Then resets the clinic name, contact details and logo to blank defaults.
 *
 * After this, create the clinic's first owner with:  npm run create:owner -- <email> "<full name>"
 * There is no undo. Take a backup first (Supabase → Database → Backups) if the data matters.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}

// Safety catch: you must type the project's ref (the part before .supabase.co), so a
// copied command can't wipe the wrong clinic. For the local test stack, the ref is "local".
const host = new URL(url).hostname;
const ref = host.endsWith(".supabase.co") ? host.split(".")[0] : "local";
const args = process.argv.slice(2);
const confirm = args[args.indexOf("--confirm") + 1];
if (!args.includes("--confirm") || confirm !== ref) {
  console.error(`This deletes ALL accounts, patients and appointments in project "${ref}".`);
  console.error(`To continue, run:  npm run reset:clinic -- --confirm ${ref}`);
  process.exit(1);
}

const db = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function wipe(table: keyof Database["public"]["Tables"], column = "id") {
  // supabase-js refuses a DELETE without a filter; "column is not null" matches every row.
  const { error, count } = await db.from(table).delete({ count: "exact" }).not(column, "is", null);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`deleted ${String(count ?? 0).padStart(5)}  ${table}`);
}

async function emptyBucket(bucket: string) {
  let removed = 0;
  const walk = async (prefix: string): Promise<string[]> => {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error || !Array.isArray(data)) return [];
    const files: string[] = [];
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) files.push(path);           // a file
      else files.push(...(await walk(path)));  // a folder
    }
    return files;
  };
  const files = await walk("");
  for (let i = 0; i < files.length; i += 100) {
    const { error } = await db.storage.from(bucket).remove(files.slice(i, i + 100));
    if (!error) removed += Math.min(100, files.length - i);
  }
  console.log(`deleted ${String(removed).padStart(5)}  files in storage/${bucket}`);
}

console.log(`Resetting project "${ref}"…\n`);

// Children before parents (payments and reservations block deleting what they point at).
await wipe("payments");
await wipe("reservations");               // notes and status history go with them
await wipe("customers");
await wipe("notifications");
await wipe("resource_time_off");
await wipe("working_hours");
await wipe("service_resources", "resource_id");
await wipe("resources");
await emptyBucket("payment-proofs");
await emptyBucket("branding");

// Every login. Deleting a login also deletes its profile.
let users = 0;
for (;;) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (error) throw error;
  if (data.users.length === 0) break;
  for (const u of data.users) {
    const { error: delError } = await db.auth.admin.deleteUser(u.id);
    if (delError) throw new Error(`login ${u.email}: ${delError.message}`);
    users++;
  }
}
console.log(`deleted ${String(users).padStart(5)}  logins`);

const { error: settingsError } = await db.from("clinic_settings").update({
  name: "Your Dental Clinic", tagline: null, email: null, phone: null, address: null, logo_url: null,
}).eq("id", 1);
if (settingsError) throw settingsError;
console.log("reset         clinic name, contact details and logo");

await wipe("audit_logs");                  // last: the deletes above wrote audit rows too

console.log(`
Done. The clinic is empty. Next:
  1. npm run create:owner -- owner@theirclinic.com "Dr. Full Name"
  2. Sign in with the email and password it prints.
  3. In Settings: clinic name, logo, contact details, booking rules.
  4. Add staff (doctors get a calendar), set hours in Schedule, review Services.`);
