/**
 * GET /api/health
 *
 * Liveness probe — returns HTTP 200 with `{ status: "ok" }` whenever the
 * process is running and able to serve requests.
 *
 * This endpoint is intentionally unauthenticated and excluded from JWT
 * middleware (see src/middleware.ts) so that load balancers and uptime
 * monitors can reach it without a token.
 *
 * Validates: Requirements 12.3, 12.4
 */

import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
