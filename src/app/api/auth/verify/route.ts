/**
 * POST /api/auth/verify
 *
 * Verifies a Bearer token from the Authorization header and returns the
 * decoded JWTPayload on success, or 401 UNAUTHORIZED on failure.
 *
 * Validates: Requirements 1.4, 1.5
 */

import { errorResponse, successResponse } from "@/lib/api-response";
import { extractBearerToken, verifyJwt } from "@/lib/jwt";
import type { JWTPayload } from "@/types";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("Authorization");
  const token = extractBearerToken(authHeader);

  if (!token) {
    return NextResponse.json(
      errorResponse(
        "UNAUTHORIZED",
        "Missing or malformed Authorization header",
      ),
      { status: 401 },
    );
  }

  const payload: JWTPayload | null = await verifyJwt(token);

  if (!payload) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Invalid or expired token"),
      { status: 401 },
    );
  }

  return NextResponse.json(successResponse(payload), { status: 200 });
}
