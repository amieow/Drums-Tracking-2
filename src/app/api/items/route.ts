/**
 * GET /api/items  — List items (all authenticated roles)
 * POST /api/items — Register a new drum item
 *
 * Reads user context from headers injected by middleware, enforces RBAC,
 * delegates to the item service, and returns the appropriate response.
 *
 * Validates: Requirements 2.1–2.4, 3.1–3.7, 9.1
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { checkPermission, writeForbiddenAttempt } from "@/lib/rbac";
import { registerItem } from "@/services/item-service";
import type {
  Item,
  PaginationMeta,
  RegisterItemRequest,
  RegisterItemResponse,
  UserRole,
} from "@/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * Extract the client IP from the request.
 * Prefers `x-forwarded-for` (set by proxies/load balancers), falls back to "unknown".
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return "unknown";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read user context from injected headers ─────────────────────────────
  const userId = request.headers.get("x-user-id");
  const userRole = request.headers.get("x-user-role") as UserRole | null;
  const userEmail = request.headers.get("x-user-email");

  if (!userId || !userRole || !userEmail) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC check — only operator and admin may register items ─────────────
  if (!checkPermission(userRole, "items:register")) {
    void writeForbiddenAttempt({
      userId,
      userEmail,
      action: "items:register",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to register items.",
      ),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Parse request body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "Request body must be valid JSON."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  const input = (body ?? {}) as RegisterItemRequest;

  // ── 4. Get client IP ───────────────────────────────────────────────────────
  const ip = getClientIp(request);

  // ── 5. Call item service ───────────────────────────────────────────────────
  let data: RegisterItemResponse;
  try {
    data = await registerItem(input, userId, userEmail, ip);
  } catch (err) {
    const serviceError = err as {
      code: string;
      message: string;
      details?: Record<string, string>;
    };

    if (serviceError.code === "VALIDATION_ERROR") {
      return NextResponse.json(
        errorResponse(
          "VALIDATION_ERROR",
          serviceError.message,
          serviceError.details,
        ),
        { status: getHttpStatus("VALIDATION_ERROR") },
      );
    }

    // INTERNAL_ERROR or any unexpected error
    console.error(
      "[POST /api/items] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  // ── 6. Return 201 Created ──────────────────────────────────────────────────
  return NextResponse.json(successResponse(data), { status: 201 });
}

/**
 * GET /api/items
 *
 * Returns a paginated list of items. All authenticated roles may read items.
 * Supports optional query params:
 *   - status:   filter by current_status
 *   - location: filter by location_zone
 *   - page:     page number (default: 1)
 *   - limit:    page size (default: 50)
 *
 * Validates: Requirements 2.1–2.4, 9.1
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read user context from injected headers ─────────────────────────────
  const userId = request.headers.get("x-user-id");
  const userRole = request.headers.get("x-user-role") as UserRole | null;

  if (!userId || !userRole) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC check — all authenticated roles may read items ─────────────────
  if (!checkPermission(userRole, "items:read")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: request.headers.get("x-user-email") ?? "",
      action: "items:read",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse("FORBIDDEN", "You do not have permission to read items."),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Parse query params ──────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") ?? undefined;
  const locationFilter = searchParams.get("location") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50),
  );
  const offset = (page - 1) * limit;

  // ── 4. Query items table ───────────────────────────────────────────────────
  try {
    const sql = getDb();

    // Build WHERE conditions
    const conditions: string[] = [];
    if (statusFilter) conditions.push(`current_status = '${statusFilter}'`);
    if (locationFilter) conditions.push(`location_zone = '${locationFilter}'`);
    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRows = await sql.unsafe<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM items ${where}`,
    );
    const total = parseInt(countRows[0]?.count ?? "0", 10);

    const items = await sql.unsafe<Item[]>(
      `SELECT * FROM items ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    );

    const pagination: PaginationMeta = {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    };

    return NextResponse.json(successResponse(items, pagination), {
      status: 200,
    });
  } catch (err) {
    console.error("[GET /api/items] Unexpected error:", err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
