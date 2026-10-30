import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * It acts AS THE LOGGED-IN USER (their cookie session), so every query is
 * filtered by Row Level Security exactly as that user is allowed to see it.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // Session reads must happen at request time. Supabase checks token expiry against the
  // clock, and Partial Prefetching does not allow clock reads in its cookie-aware prerender.
  await connection();

  return createServerClient<Database>(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. Safe to ignore: proxy.ts
          // refreshes the session cookie on every request.
        }
      },
    },
  });
}

/**
 * Anonymous client with no cookies — used for public guest actions
 * (booking, tracking) so they run with the most limited "anon" role
 * even if the visitor happens to be logged in as staff.
 */
export function createAnonClient() {
  return createPlainClient<Database>(publicEnv.supabaseUrl(), publicEnv.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
