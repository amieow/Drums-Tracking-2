/**
 * POST /api/auth/login
 *
 * Authenticates a user with email and password via Supabase Auth.
 * Applies IP-based rate limiting after repeated failures.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.6, 1.7
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import {
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
} from "@/lib/rate-limiter";
import type { LoginResponse, UserRole } from "@/types";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/** Valid roles accepted by the system. */
const VALID_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

/**
 * Extract the client IP from the request.
 * Prefers `x-forwarded-for` (set by proxies/load balancers), then falls back
 * to `request.ip` (Next.js edge runtime), then "unknown".
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for may contain a comma-separated list; take the first entry
    return forwarded.split(",")[0].trim();
  }
  // `ip` is available on NextRequest in the Next.js edge/middleware runtime
  const reqWithIp = request as NextRequest & { ip?: string };
  if (reqWithIp.ip) {
    return reqWithIp.ip;
  }
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

  // ── 3. Supabase Auth — signInWithPassword (ANON key) ──────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "POST /api/auth/login: Missing Supabase environment variables.",
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "Server configuration error."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  // ── 4. Handle auth failure ─────────────────────────────────────────────────
  if (error || !data.user || !data.session) {
    recordFailedAttempt(ip);
    return NextResponse.json(
      errorResponse("AUTH_FAILED", "Invalid email or password."),
      { status: getHttpStatus("AUTH_FAILED") },
    );
  }

  // ── 5. Validate role ───────────────────────────────────────────────────────
  const { user, session } = data;

  const rawRole: unknown =
    user.user_metadata?.role ?? user.app_metadata?.role ?? null;

  if (!rawRole || !VALID_ROLES.includes(rawRole as UserRole)) {
    // Authenticated but no valid system role — treat as auth failure
    recordFailedAttempt(ip);
    return NextResponse.json(
      errorResponse("AUTH_FAILED", "User does not have a valid system role."),
      { status: getHttpStatus("AUTH_FAILED") },
    );
  }

  // ── 6. Success ─────────────────────────────────────────────────────────────
  resetAttempts(ip);

  const responseBody: LoginResponse = {
    token: session.access_token,
    user: {
      id: user.id,
      email: user.email ?? email.trim(),
      role: rawRole as UserRole,
    },
  };

  return NextResponse.json(successResponse(responseBody), { status: 200 });
}
