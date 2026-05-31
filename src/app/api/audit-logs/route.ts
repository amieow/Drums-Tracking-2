/**
 * GET /api/audit-logs — Query paginated audit log entries (admin only)
 *
 * Reads user context from headers injected by middleware, enforces admin-only
 * RBAC, validates date/user filters, delegates to the audit service, and
 * returns a paginated response.
 *
 * Validates: Requirements 2.4, 10.4, 10.5
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { checkPermission, writeForbiddenAttempt } from "@/lib/rbac";
import { queryAuditLogs } from "@/services/audit-service";
import type { AuditLogQuery, UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/audit-logs
 *
 * Returns a paginated list of audit log entries. Only the `admin` role may
 * access this endpoint.
 *
 * Supported query params:
 *   - date_from: ISO 8601 datetime — filter entries at or after this time
 *   - date_to:   ISO 8601 datetime — filter entries at or before this time
 *   - user_id:   UUID — filter entries by the acting user
 *   - page:      page number (default: 1)
 *   - limit:     page size (default: 50, max: 50)
 *
 * Validates: Requirements 2.4, 10.4, 10.5
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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

  // ── 2. RBAC check — only admin may read audit logs (Req 2.4) ───────────────
  if (!checkPermission(userRole, "audit:read")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: userEmail ?? "",
      action: "audit:read",
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "unknown",
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to access audit logs.",
      ),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Parse query params ──────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const query: AuditLogQuery = {
    date_from: searchParams.get("date_from") ?? undefined,
    date_to: searchParams.get("date_to") ?? undefined,
    user_id: searchParams.get("user_id") ?? undefined,
    page: searchParams.has("page")
      ? parseInt(searchParams.get("page")!, 10)
      : undefined,
    limit: searchParams.has("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined,
  };

  // ── 4. Call audit service ──────────────────────────────────────────────────
  try {
    const { entries, pagination } = await queryAuditLogs(query, userId);

    return NextResponse.json(successResponse(entries, pagination), {
      status: 200,
    });
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
      "[GET /api/audit-logs] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
