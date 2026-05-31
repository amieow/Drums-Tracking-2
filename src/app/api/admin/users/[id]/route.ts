/**
 * PATCH  /api/admin/users/[id] — Update a user's role (admin only)
 * DELETE /api/admin/users/[id] — Deactivate (soft-ban) a user (admin only)
 *
 * Enforces admin-only RBAC via the `x-user-role` header injected by
 * middleware. Uses the Supabase Auth Admin API to update and deactivate users.
 *
 * Soft-ban strategy: instead of hard-deleting the user record (which would
 * break audit trail foreign keys), DELETE sets `ban_duration: "876600h"`
 * (~100 years) via `updateUserById`. This preserves the audit trail while
 * effectively preventing the user from signing in.
 *
 * Validates: Requirements 2.4
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

// ─── PATCH /api/admin/users/[id] ─────────────────────────────────────────────

/**
 * Updates the role of an existing user.
 *
 * Request body: `{ role: UserRole }`
 *
 * The new role is stored in `user_metadata.role` via the Supabase Auth Admin
 * API. Only the `admin` role may call this endpoint. Non-admin requests
 * receive a `FORBIDDEN` response and a `forbidden_attempt` audit entry is
 * written.
 *
 * Validates: Requirements 2.4
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // ── 1. Auth context ──────────────────────────────────────────────────────
  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC — admin only ─────────────────────────────────────────────────
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

  // ── 3. Parse and validate request body ───────────────────────────────────
  let body: { role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "Request body must be valid JSON."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  const { role } = body;
  const validRoles: UserRole[] = ["operator", "qc", "ppic", "admin"];

  if (!role || !validRoles.includes(role as UserRole)) {
    return NextResponse.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body.", {
        role: `role must be one of: ${validRoles.join(", ")}.`,
      }),
      { status: getHttpStatus("VALIDATION_ERROR") },
    );
  }

  // ── 4. Update user role via Supabase Auth Admin API ──────────────────────
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.admin.updateUserById(id, {
      user_metadata: { role: role as UserRole },
    });

    if (error) {
      console.error(
        "[PATCH /api/admin/users/[id]] Supabase error:",
        error.message,
      );

      if (
        error.message.toLowerCase().includes("not found") ||
        error.message.toLowerCase().includes("does not exist")
      ) {
        return NextResponse.json(
          errorResponse("NOT_FOUND", "User not found."),
          { status: getHttpStatus("NOT_FOUND") },
        );
      }

      return NextResponse.json(
        errorResponse("INTERNAL_ERROR", "Failed to update user."),
        { status: getHttpStatus("INTERNAL_ERROR") },
      );
    }

    const now = new Date().toISOString();
    const updated = {
      id: data.user.id,
      email: data.user.email ?? "",
      role:
        (data.user.user_metadata?.role as UserRole | undefined) ??
        (role as UserRole),
      banned: !!data.user.banned_until && data.user.banned_until > now,
      created_at: data.user.created_at,
      last_sign_in_at: data.user.last_sign_in_at ?? null,
    };

    return NextResponse.json(successResponse(updated), { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/admin/users/[id]] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

// ─── DELETE /api/admin/users/[id] ────────────────────────────────────────────

/**
 * Deactivates (soft-bans) a user by setting a very long ban duration.
 *
 * A hard delete is intentionally avoided to preserve the audit trail — all
 * `audit_logs` rows referencing this user remain intact. The user is banned
 * for 876600 hours (~100 years), which effectively prevents sign-in while
 * keeping the record in Supabase Auth.
 *
 * Only the `admin` role may call this endpoint. Non-admin requests receive
 * a `FORBIDDEN` response and a `forbidden_attempt` audit entry is written.
 *
 * Validates: Requirements 2.4
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // ── 1. Auth context ──────────────────────────────────────────────────────
  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC — admin only ─────────────────────────────────────────────────
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

  // ── 3. Soft-ban user via Supabase Auth Admin API ─────────────────────────
  // Using ban_duration instead of deleteUser to preserve the audit trail.
  // 876600h ≈ 100 years — effectively permanent deactivation.
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: "876600h",
    });

    if (error) {
      console.error(
        "[DELETE /api/admin/users/[id]] Supabase error:",
        error.message,
      );

      if (
        error.message.toLowerCase().includes("not found") ||
        error.message.toLowerCase().includes("does not exist")
      ) {
        return NextResponse.json(
          errorResponse("NOT_FOUND", "User not found."),
          { status: getHttpStatus("NOT_FOUND") },
        );
      }

      return NextResponse.json(
        errorResponse("INTERNAL_ERROR", "Failed to deactivate user."),
        { status: getHttpStatus("INTERNAL_ERROR") },
      );
    }

    return NextResponse.json(successResponse({ id }), { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/admin/users/[id]] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
