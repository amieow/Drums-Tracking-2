/**
 * PATCH  /api/admin/users/[id] — Update a user's role (admin only)
 * DELETE /api/admin/users/[id] — Deactivate (soft-ban) a user (admin only)
 *
 * Uses direct PostgreSQL queries against the `users` table.
 * Soft-ban sets `banned_until` to 100 years in the future to preserve audit trail.
 *
 * Validates: Requirements 2.4
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { checkPermission } from "@/lib/rbac";
import { writeForbiddenAttempt } from "@/lib/audit";
import type { UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

function getUserContext(
  request: NextRequest,
): { userId: string; userRole: UserRole; userEmail: string } | null {
  const userId = request.headers.get("x-user-id");
  const userRole = request.headers.get("x-user-role") as UserRole | null;
  const userEmail = request.headers.get("x-user-email");
  if (!userId || !userRole || !userEmail) return null;
  return { userId, userRole, userEmail };
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

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

  try {
    const sql = getDb();
    const rows = await sql<
      {
        id: string;
        email: string;
        role: string;
        banned_until: string | null;
        created_at: string;
        last_sign_in_at: string | null;
      }[]
    >`
      UPDATE users SET role = ${role as string}, updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, email, role, banned_until, created_at, last_sign_in_at
    `;

    if (rows.length === 0) {
      return NextResponse.json(errorResponse("NOT_FOUND", "User not found."), {
        status: getHttpStatus("NOT_FOUND"),
      });
    }

    const now = new Date().toISOString();
    const u = rows[0];
    return NextResponse.json(
      successResponse({
        id: u.id,
        email: u.email,
        role: u.role as UserRole,
        banned: !!u.banned_until && u.banned_until > now,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[PATCH /api/admin/users/[id]] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const ctx = getUserContext(request);
  if (!ctx) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

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

  try {
    const sql = getDb();
    // Soft-ban: set banned_until ~100 years in the future to preserve audit trail
    const bannedUntil = new Date(
      Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const rows = await sql<{ id: string }[]>`
      UPDATE users SET banned_until = ${bannedUntil}, updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id
    `;

    if (rows.length === 0) {
      return NextResponse.json(errorResponse("NOT_FOUND", "User not found."), {
        status: getHttpStatus("NOT_FOUND"),
      });
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
