/**
 * GET  /api/admin/users — List all users (admin only)
 * POST /api/admin/users — Create a new user (admin only)
 *
 * Enforces admin-only RBAC via the `x-user-role` header injected by middleware.
 * Uses direct PostgreSQL queries against the `users` table.
 *
 * Validates: Requirements 2.4, 2.5
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
import bcrypt from "bcryptjs";
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

export async function GET(request: NextRequest): Promise<NextResponse> {
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
      SELECT id, email, role, banned_until, created_at, last_sign_in_at FROM users ORDER BY created_at DESC
    `;

    const now = new Date().toISOString();
    const users = rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role as UserRole,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  if (!email || typeof email !== "string" || !email.trim())
    details.email = "email is required.";
  if (!password || typeof password !== "string" || password.length < 6)
    details.password = "password must be at least 6 characters.";
  if (!role || !validRoles.includes(role as UserRole))
    details.role = `role must be one of: ${validRoles.join(", ")}.`;

  if (Object.keys(details).length > 0) {
    return NextResponse.json(
      errorResponse("VALIDATION_ERROR", "Invalid request body.", details),
      { status: getHttpStatus("VALIDATION_ERROR") },
    );
  }

  try {
    const sql = getDb();
    const passwordHash = await bcrypt.hash(password as string, 12);

    const rows = await sql<
      { id: string; email: string; role: string; created_at: string }[]
    >`
      INSERT INTO users (email, password_hash, role)
      VALUES (${(email as string).trim().toLowerCase()}, ${passwordHash}, ${role as string})
      RETURNING id, email, role, created_at
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        errorResponse("INTERNAL_ERROR", "Failed to create user."),
        { status: getHttpStatus("INTERNAL_ERROR") },
      );
    }

    const created = {
      id: rows[0].id,
      email: rows[0].email,
      role: rows[0].role as UserRole,
      banned: false,
      created_at: rows[0].created_at,
    };
    return NextResponse.json(successResponse(created), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (
      message.toLowerCase().includes("unique") ||
      message.toLowerCase().includes("duplicate")
    ) {
      return NextResponse.json(
        errorResponse(
          "VALIDATION_ERROR",
          "A user with that email already exists.",
          { email: "Email address is already in use." },
        ),
        { status: getHttpStatus("VALIDATION_ERROR") },
      );
    }
    console.error("[POST /api/admin/users] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
