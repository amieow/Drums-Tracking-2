/**
 * POST /api/auth/login
 *
 * Authenticates a user with email and password via a direct database lookup.
 * Applies IP-based rate limiting after repeated failures.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.6, 1.7
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { signJwt } from "@/lib/jwt";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
} from "@/lib/rate-limiter";
import type { LoginResponse, UserRole } from "@/types";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

/** Valid roles accepted by the system. */
const VALID_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const reqWithIp = request as NextRequest & { ip?: string };
  if (reqWithIp.ip) return reqWithIp.ip;
  return "unknown";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse & validate request body ──────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "Request body must be valid JSON."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;

  if (!email || typeof email !== "string" || email.trim() === "") {
    return NextResponse.json(
      errorResponse(
        "INVALID_INPUT",
        "email is required and must be a non-empty string.",
      ),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  if (!password || typeof password !== "string" || password.trim() === "") {
    return NextResponse.json(
      errorResponse(
        "INVALID_INPUT",
        "password is required and must be a non-empty string.",
      ),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  // ── 2. Rate limit check ────────────────────────────────────────────────────
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      errorResponse(
        "RATE_LIMITED",
        "Too many failed login attempts. Please try again later.",
        { retryAfter: String(rateLimit.retryAfter) },
      ),
      { status: getHttpStatus("RATE_LIMITED") },
    );
  }

  // ── 3. Look up user in database ────────────────────────────────────────────
  try {
    const sql = getDb();
    const rows = await sql<
      { id: string; email: string; password_hash: string; role: string }[]
    >`
      SELECT id, email, password_hash, role
      FROM users
      WHERE email = ${email.trim().toLowerCase()}
        AND banned_until IS NULL OR banned_until < NOW()
      LIMIT 1
    `;

    if (rows.length === 0) {
      recordFailedAttempt(ip);
      return NextResponse.json(
        errorResponse("AUTH_FAILED", "Invalid email or password."),
        { status: getHttpStatus("AUTH_FAILED") },
      );
    }

    const user = rows[0];

    // ── 4. Verify password ─────────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      recordFailedAttempt(ip);
      return NextResponse.json(
        errorResponse("AUTH_FAILED", "Invalid email or password."),
        { status: getHttpStatus("AUTH_FAILED") },
      );
    }

    // ── 5. Validate role ───────────────────────────────────────────────────
    if (!user.role || !VALID_ROLES.includes(user.role as UserRole)) {
      recordFailedAttempt(ip);
      return NextResponse.json(
        errorResponse("AUTH_FAILED", "User does not have a valid system role."),
        { status: getHttpStatus("AUTH_FAILED") },
      );
    }

    // ── 6. Sign JWT and return ─────────────────────────────────────────────
    resetAttempts(ip);

    const token = await signJwt({
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
    });

    const responseBody: LoginResponse = {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role as UserRole,
      },
    };

    return NextResponse.json(successResponse(responseBody), { status: 200 });
  } catch (err) {
    console.error("POST /api/auth/login: Database error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "Server configuration error."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
