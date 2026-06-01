/**
 * GET /api/audit-logs/export
 *
 * Exports the audit log as a CSV file. Admin-only endpoint.
 *
 * Reads user context from headers injected by middleware, enforces RBAC,
 * delegates to the audit service, and returns the CSV with appropriate headers.
 *
 * Validates: Requirements 2.4, 10.5, 10.6, 10.7
 */

import { errorResponse, getHttpStatus } from "@/lib/api-response";
import { checkPermission } from "@/lib/rbac";
import { writeForbiddenAttempt } from "@/lib/audit";
import { exportAuditLogsCsv } from "@/services/audit-service";
import type { AuditLogQuery, UserRole } from "@/types";
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

/**
 * GET /api/audit-logs/export
 *
 * Query params:
 *   - date_from: ISO 8601 datetime (optional)
 *   - date_to:   ISO 8601 datetime (optional)
 *   - user_id:   UUID filter (optional)
 *
 * Returns a CSV file with Content-Disposition: attachment; filename="audit-log.csv"
 */
export async function GET(request: NextRequest): Promise<Response> {
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

  // ── 2. RBAC check — only admin may export audit logs (Req 2.4) ─────────────
  if (!checkPermission(userRole, "audit:export")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: userEmail ?? "",
      action: "audit:export",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to export audit logs.",
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
  };

  // ── 4. Get client IP ───────────────────────────────────────────────────────
  const ip = getClientIp(request);

  // ── 5. Call audit service to generate CSV ─────────────────────────────────
  let csv: string;
  try {
    csv = await exportAuditLogsCsv(query, userId, userEmail, ip);
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
      "[GET /api/audit-logs/export] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  // ── 6. Return CSV with appropriate headers ─────────────────────────────────
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
    },
  });
}
