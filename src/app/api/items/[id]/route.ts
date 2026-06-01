/**
 * GET /api/items/[id]    — Fetch a single item by UUID with full audit history.
 * PATCH /api/items/[id]  — Update the location zone of an item (operator/admin only).
 *
 * Reads user context from headers injected by middleware, enforces RBAC,
 * delegates to the item service, and returns the appropriate response.
 *
 * Validates: Requirements 2.1, 2.4, 9.1, 13.3, 14.3, 14.5
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { getDb } from "@/lib/db";
import { checkPermission } from "@/lib/rbac";
import { writeForbiddenAttempt } from "@/lib/audit";
import { updateItemLocation } from "@/services/item-service";
import type { AuditEntry, Item, ItemHistoryEntry, UserRole } from "@/types";
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  // ── 3. Resolve route param ─────────────────────────────────────────────────
  const { id } = await params;

  // ── 4. Fetch item by UUID ──────────────────────────────────────────────────
  try {
    const sql = getDb();

    const itemRows = await sql<
      Item[]
    >`SELECT * FROM items WHERE id = ${id}::uuid LIMIT 1`;

    if (itemRows.length === 0) {
      return NextResponse.json(
        errorResponse("NOT_FOUND", `Item with id "${id}" was not found.`),
        { status: getHttpStatus("NOT_FOUND") },
      );
    }

    const item = itemRows[0];

    // ── 5. Fetch audit history for this item ───────────────────────────────
    const auditRows = await sql<
      {
        action: string;
        previous_state: string | null;
        new_state: string;
        user_id: string;
        user_email: string;
        timestamp: string;
      }[]
    >`
      SELECT action, previous_state, new_state, user_id, user_email, timestamp
      FROM audit_logs WHERE item_id = ${id}::uuid ORDER BY timestamp DESC
    `;

    // ── 6. Map audit_logs rows to ItemHistoryEntry[] ───────────────────────
    const history: ItemHistoryEntry[] = auditRows.map((log) => ({
      action: log.action as AuditEntry["action"],
      previous_state: log.previous_state ?? null,
      new_state: log.new_state ?? "",
      user_id: log.user_id,
      user_email: log.user_email,
      timestamp: log.timestamp,
    }));

    // ── 7. Return item with history ────────────────────────────────────────
    const itemWithHistory: Item = { ...item, history };
    return NextResponse.json(successResponse(itemWithHistory), { status: 200 });
  } catch (err) {
    console.error(`[GET /api/items/${id}] Unexpected error:`, err);
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }
}

/**
 * PATCH /api/items/[id]
 *
 * Updates the location zone of an existing item.
 * Only `operator` and `admin` roles may update item locations.
 *
 * Request body: `{ location_zone: string }`
 *
 * Validates: Requirements 2.1, 2.4, 13.3, 14.3, 14.5
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  // ── 2. RBAC check — only operator and admin may update item location ────────
  if (!checkPermission(userRole, "items:update_location")) {
    void writeForbiddenAttempt({
      userId,
      userEmail,
      action: "items:update_location",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to update item location.",
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

  const input = (body ?? {}) as Record<string, unknown>;

  // ── 4. Validate request body: location_zone must be a non-empty string ──────
  if (
    typeof input.location_zone !== "string" ||
    input.location_zone.trim() === ""
  ) {
    return NextResponse.json(
      errorResponse(
        "VALIDATION_ERROR",
        "location_zone is required and must be a non-empty string.",
        {
          location_zone:
            "location_zone is required and must be a non-empty string",
        },
      ),
      { status: getHttpStatus("VALIDATION_ERROR") },
    );
  }

  const locationZone = input.location_zone.trim();

  const { id } = await params;

  const sql = getDb();
  const itemRows = await sql<
    { lot_id: string }[]
  >`SELECT lot_id FROM items WHERE id = ${id}::uuid LIMIT 1`;

  if (itemRows.length === 0) {
    return NextResponse.json(
      errorResponse("NOT_FOUND", `Item with id "${id}" was not found.`),
      { status: getHttpStatus("NOT_FOUND") },
    );
  }

  const lotId = itemRows[0].lot_id;
  const ip = getClientIp(request);

  // ── 6. Call item service to update location ────────────────────────────────
  let updatedItem: Item;
  try {
    updatedItem = await updateItemLocation(
      lotId,
      locationZone,
      userId,
      userEmail,
      ip,
    );
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
      `[PATCH /api/items/${id}] Internal error:`,
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  // ── 7. Return 200 OK with updated item ─────────────────────────────────────
  return NextResponse.json(successResponse(updatedItem), { status: 200 });
}
