/**
 * GET   /api/locations/[zone_id] — Get a single warehouse location (all authenticated roles)
 * PATCH /api/locations/[zone_id] — Update a warehouse location (admin only)
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
import { getDb } from "@/lib/db";
import { checkPermission, writeForbiddenAttempt } from "@/lib/rbac";
import {
  updateLocation,
  type UpdateLocationInput,
} from "@/services/location-service";
import type { Location, LocationType, UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/locations/[zone_id]
 *
 * Returns a single warehouse zone by its zone_id, including the computed
 * current drum count from the `location_counts` view.
 * All authenticated roles may access this endpoint.
 *
 * Validates: Requirements 2.3, 2.4, 14.1, 14.2
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ zone_id: string }> },
): Promise<NextResponse> {
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

  // ── 3. Resolve zone_id from route params ───────────────────────────────────
  const { zone_id: zoneId } = await params;

  if (!zoneId) {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "zone_id is required."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  // ── 4. Query location_counts view directly for the specific zone ───────────
  try {
    const sql = getDb();

    const rows = await sql<
      {
        zone_id: string;
        name: string;
        type: string;
        temperature_target: number | null;
        capacity: number;
        current_count: number;
      }[]
    >`
      SELECT zone_id, name, type, temperature_target, capacity, current_count
      FROM location_counts WHERE zone_id = ${zoneId} LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        errorResponse("NOT_FOUND", "Location not found."),
        { status: getHttpStatus("NOT_FOUND") },
      );
    }

    const row = rows[0];
    const location: Location = {
      zone_id: row.zone_id,
      name: row.name,
      type: row.type as LocationType,
      temperature_target:
        row.temperature_target != null
          ? Number(row.temperature_target)
          : undefined,
      capacity: Number(row.capacity),
      current_count: Number(row.current_count),
    };

    return NextResponse.json(successResponse(location), { status: 200 });
  } catch (err) {
    console.error(
      "[GET /api/locations/[zone_id]] Internal error:",
      (err as Error).message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

/**
 * PATCH /api/locations/[zone_id]
 *
 * Partially updates an existing warehouse zone. Admin only.
 *
 * Request body: UpdateLocationInput (all fields optional)
 *   - name?:                string
 *   - type?:                LocationType
 *   - temperature_target?:  number
 *   - capacity?:            number
 *
 * Validates: Requirements 2.4, 14.1, 14.3, 14.4, 14.5
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ zone_id: string }> },
): Promise<NextResponse> {
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

  // ── 3. Resolve zone_id from route params ───────────────────────────────────
  const { zone_id: zoneId } = await params;

  if (!zoneId) {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "zone_id is required."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  // ── 4. Parse request body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      errorResponse("INVALID_INPUT", "Request body must be valid JSON."),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  const input = (body ?? {}) as UpdateLocationInput;

  // ── 5. Call location service ───────────────────────────────────────────────
  try {
    const location = await updateLocation(zoneId, input, userId);
    return NextResponse.json(successResponse(location), { status: 200 });
  } catch (err) {
    const serviceError = err as {
      code: string;
      message: string;
      details?: Record<string, string>;
    };

    if (serviceError.code === "NOT_FOUND") {
      return NextResponse.json(
        errorResponse("NOT_FOUND", serviceError.message),
        { status: getHttpStatus("NOT_FOUND") },
      );
    }

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
      "[PATCH /api/locations/[zone_id]] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}
