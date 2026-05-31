/**
 * GET /api/readiness
 *
 * Readiness probe — verifies that the Supabase database connection is active
 * and accepting queries before reporting the service as ready.
 *
 * Returns:
 *   200  { ready: true }                          — DB reachable
 *   503  { ready: false, error: "INTERNAL_ERROR" } — DB unavailable
 *
 * This endpoint is intentionally unauthenticated and excluded from JWT
 * middleware (see src/middleware.ts) so that orchestrators and health checks
 * can reach it without a token.
 *
 * Validates: Requirements 12.5, 12.6
 */

import { getSupabaseClient } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = getSupabaseClient();

    // Lightweight ping: fetch at most one row from the locations table.
    // A successful response (even an empty result set) confirms the DB is up.
    const { error } = await supabase
      .from("locations")
      .select("zone_id")
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ready: false, error: "INTERNAL_ERROR" },
        { status: 503 },
      );
    }

    return NextResponse.json({ ready: true }, { status: 200 });
  } catch {
    // Catches thrown errors such as missing env vars or network failures.
    return NextResponse.json(
      { ready: false, error: "INTERNAL_ERROR" },
      { status: 503 },
    );
  }
}
