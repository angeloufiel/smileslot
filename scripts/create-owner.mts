/**
 * Creates the clinic owner's login (the first admin), or makes an existing login the owner.
 *
 *   npm run create:owner -- owner@clinic.com "Dr. Maria Santos"
 *
 * Prints a temporary password ONCE. The owner should change it in Dashboard → My account.
 */
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}
const [rawEmail, fullName] = process.argv.slice(2);
const email = (rawEmail ?? "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName || fullName.trim().length < 2) {
  console.error('Usage: npm run create:owner -- owner@clinic.com "Dr. Full Name"');
  process.exit(1);
}

// Same readable format as the dashboard: no 0/O or 1/I/L.
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const chars = Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join("");
const password = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;

const db = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
  }
  return null;
}

let id = await findUserId();
if (id) {
  const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
  if (error) throw error;
  console.log("That email already had a login: it now has a new password and is the owner.");
} else {
  const { data, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName.trim() },
  });
  if (error) throw error;
  id = data.user.id;
}

const { error: roleError } = await db.from("profiles").update({ role: "owner", full_name: fullName.trim(), is_active: true }).eq("id", id);
if (roleError) throw roleError;

console.log(`
Owner account ready. Give these to the clinic owner (shown only once):

  Sign in at: ${process.env.NEXT_PUBLIC_SITE_URL ?? "your site"}/login
  Email:      ${email}
  Password:   ${password}

They should change the password in Dashboard → My account.`);
