/**
 * GET  /api/locations — List all warehouse locations (all authenticated roles)
 * POST /api/locations — Create a new warehouse location (admin only)
 *
 * Reads user context from headers injected by middleware, enforces RBAC,
 * delegates to the location service, and returns the appropriate response.
 *
 * Validates: Requirements 2.3, 2.4, 14.1–14.6
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { checkPermission } from "@/lib/rbac";
import { writeForbiddenAttempt } from "@/lib/audit";
import {
  createLocation,
  listLocations,
  type CreateLocationInput,
} from "@/services/location-service";
import type { UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/locations
 *
 * Returns all warehouse zones with their computed current drum count.
 * All authenticated roles (operator, qc, ppic, admin) may access this endpoint.
 *
 * Validates: Requirements 2.3, 2.4, 14.1, 14.2
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

  // ── 2. RBAC check — all authenticated roles may read locations ─────────────
  if (!checkPermission(userRole, "locations:read")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: request.headers.get("x-user-email") ?? "",
      action: "locations:read",
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "unknown",
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to read locations.",
      ),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Call location service ───────────────────────────────────────────────
  try {
    const locations = await listLocations();
    return NextResponse.json(successResponse(locations), { status: 200 });
  } catch (err) {
    const serviceError = err as { code: string; message: string };
    console.error(
      "[GET /api/locations] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

/**
 * POST /api/locations
 *
 * Creates a new warehouse zone. Admin only.
 *
 * Request body: CreateLocationInput
 *   - zone_id:             string (required)
 *   - name:                string (required)
 *   - type:                LocationType (required)
 *   - temperature_target?: number (required when type === "cold")
 *   - capacity:            number (required, 0 = unlimited)
 *
 * Validates: Requirements 2.4, 14.1, 14.3, 14.4
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read user context from injected headers ─────────────────────────────
  const userId = request.headers.get("x-user-id");
  const userRole = request.headers.get("x-user-role") as UserRole | null;

  if (!userId || !userRole) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required."),
      { status: getHttpStatus("UNAUTHORIZED") },
    );
  }

  // ── 2. RBAC check — only admin may manage locations (Req 2.4) ──────────────
  if (!checkPermission(userRole, "locations:manage")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: request.headers.get("x-user-email") ?? "",
      action: "locations:manage",
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "unknown",
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to manage locations.",
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

  const input = (body ?? {}) as CreateLocationInput;

  // ── 4. Call location service ───────────────────────────────────────────────
  try {
    const location = await createLocation(input, userId);
    return NextResponse.json(successResponse(location), { status: 201 });
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
      "[POST /api/locations] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
