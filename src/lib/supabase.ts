/**
 * Supabase Server Client — Singleton
 *
 * Provides a server-side Supabase client that uses the service role key,
 * bypassing Row Level Security (RLS) for trusted server-side operations.
 *
 * This module is SERVER-SIDE ONLY. Never import it in client components or
 * expose the service role key to the browser.
 *
 * Environment variables required:
 *   - NEXT_PUBLIC_SUPABASE_URL  — The Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY — The service role key (bypasses RLS)
 *
 * Validates: Requirements 3.1, 4.2
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** Cached singleton instance. */
let _client: SupabaseClient | null = null;

/**
 * Creates a new Supabase client configured with the service role key.
 *
 * The service role key bypasses Row Level Security, making this client
 * suitable for trusted server-side operations (item registration, audit
 * writes, lot ID generation, etc.).
 *
 * @returns A new `SupabaseClient` instance.
 * @throws  An error if `NEXT_PUBLIC_SUPABASE_URL` or
 *          `SUPABASE_SERVICE_ROLE_KEY` environment variables are missing.
 *
 * @example
 * const supabase = createServerClient();
 * const { data } = await supabase.from("items").select("*");
 */
export function createServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_URL is required for the server-side Supabase client.",
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY is required for the server-side Supabase client.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      // Disable automatic session persistence — this is a server-side client
      // and should not store session data.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Returns the cached singleton Supabase server client, creating it on first
 * call.
 *
 * Use this function in API routes and server-side services to avoid creating
 * a new client on every request.
 *
 * @returns The shared `SupabaseClient` singleton instance.
 * @throws  An error if the required environment variables are missing (on
 *          first call only).
 *
 * @example
 * const supabase = getSupabaseClient();
 * const { data } = await supabase.from("items").select("*");
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createServerClient();
  }
  return _client;
}
