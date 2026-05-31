/**
 * GET  /api/admin/users — List all users (admin only)
 * POST /api/admin/users — Create a new user (admin only)
 *
 * Enforces admin-only RBAC via the `x-user-role` header injected by
 * middleware. Uses the Supabase Auth Admin API to list and create users.
 *
 * Validates: Requirements 2.4, 2.5
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { checkPermission, writeForbiddenAttempt } from "@/lib/rbac";
import { getSupabaseClient } from "@/lib/supabase";
import type { UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract and validate the user context headers injected by middleware. */
function getUserContext(request: NextRequest): {
  userId: string;
  userRole: UserRole;
  userEmail: string;
} | null {
  const userId = request.headers.get("x-user-id");
  const userRole = request.headers.get("x-user-role") as UserRole | null;
  const userEmail = request.headers.get("x-user-email");

  if (!userId || !userRole || !userEmail) return null;
  return { userId, userRole, userEmail };
}

/** Return the client IP from the forwarded header or fall back to "unknown". */
function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  );
}

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

/**
 * Returns the full list of users from Supabase Auth.
 *
 * Only the `admin` role may call this endpoint. Non-admin requests receive
 * a `FORBIDDEN` response and a `forbidden_attempt` audit entry is written.
 *
 * Validates: Requirements 2.4, 2.5
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Auth context ────────────────────────────────────────────────────────
  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC — admin only ───────────────────────────────────────────────────
  if (!checkPermission(ctx.userRole, "users:manage")) {
    void writeForbiddenAttempt({
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action: "users:manage",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse("FORBIDDEN", "You do not have permission to manage users."),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. List users via Supabase Auth Admin API ──────────────────────────────
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.admin.listUsers();

    if (error) {
      console.error("[GET /api/admin/users] Supabase error:", error.message);
      return NextResponse.json(
        errorResponse("INTERNAL_ERROR", "Failed to retrieve users."),
        { status: getHttpStatus("INTERNAL_ERROR") },
      );
    }

    // Map to a safe, consistent shape.
    // `banned_until` is a future ISO timestamp when the user is banned;
    // null / undefined / past date means the user is active.
    const now = new Date().toISOString();
    const users = (data.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      role: (u.user_metadata?.role as UserRole | undefined) ?? "operator",
      banned: !!u.banned_until && u.banned_until > now,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }));

    return NextResponse.json(successResponse(users), { status: 200 });
  } catch (err) {
    console.error("[GET /api/admin/users] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

// ─── POST /api/admin/users ────────────────────────────────────────────────────

/**
 * Creates a new user in Supabase Auth with the supplied email, password, and
 * role stored in `user_metadata`.
 *
 * Request body: `{ email: string; password: string; role: UserRole }`
 *
 * Only the `admin` role may call this endpoint. Non-admin requests receive
 * a `FORBIDDEN` response and a `forbidden_attempt` audit entry is written.
 *
 * Validates: Requirements 2.4, 2.5
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Auth context ────────────────────────────────────────────────────────
  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC — admin only ───────────────────────────────────────────────────
  if (!checkPermission(ctx.userRole, "users:manage")) {
    void writeForbiddenAttempt({
      userId: ctx.userId,
      userEmail: ctx.userEmail,
      action: "users:manage",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse("FORBIDDEN", "You do not have permission to manage users."),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Parse and validate request body ────────────────────────────────────
  let body: { email?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "Request body must be valid JSON."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  const { email, password, role } = body;

  const validRoles: UserRole[] = ["operator", "qc", "ppic", "admin"];
  const details: Record<string, string> = {};

  if (!email || typeof email !== "string" || !email.trim()) {
    details.email = "email is required.";
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    details.password = "password must be at least 6 characters.";
  }
  if (!role || !validRoles.includes(role as UserRole)) {
    details.role = `role must be one of: ${validRoles.join(", ")}.`;
  }

  if (Object.keys(details).length > 0) {
    return NextResponse.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body.", details),
      { status: getHttpStatus("VALIDATION_ERROR") },
    );
  }

  // ── 4. Create user via Supabase Auth Admin API ─────────────────────────────
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: (email as string).trim(),
      password: password as string,
      user_metadata: { role: role as UserRole },
      email_confirm: true, // auto-confirm so the user can log in immediately
    });

    if (error) {
      console.error("[POST /api/admin/users] Supabase error:", error.message);

      // Surface duplicate-email errors as a validation error
      if (
        error.message.toLowerCase().includes("already") ||
        error.message.toLowerCase().includes("duplicate") ||
        error.message.toLowerCase().includes("exists")
      ) {
        return NextResponse.json(
          errorResponse(
            "VALIDATION_ERROR",
            "A user with that email already exists.",
            {
              email: "Email address is already in use.",
            },
          ),
          { status: getHttpStatus("VALIDATION_ERROR") },
        );
      }

      return NextResponse.json(
        errorResponse("INTERNAL_ERROR", "Failed to create user."),
        { status: getHttpStatus("INTERNAL_ERROR") },
      );
    }

    const created = {
      id: data.user.id,
      email: data.user.email ?? "",
      role: (data.user.user_metadata?.role as UserRole) ?? (role as UserRole),
      banned: false, // newly created users are never banned
      created_at: data.user.created_at,
    };

    return NextResponse.json(successResponse(created), { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/users] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
