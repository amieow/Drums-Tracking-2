/**
 * GET /api/search — Search for an item by Lot ID or UUID
 *
 * Reads user context from headers injected by middleware, validates the `?q=`
 * query param, delegates to the item service, and returns the item with its
 * full audit history.
 *
 * Validates: Requirements 9.1–9.7
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import { checkPermission, writeForbiddenAttempt } from "@/lib/rbac";
import { searchItem } from "@/services/item-service";
import type { Item, UserRole } from "@/types";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/search?q=<lot_id_or_uuid>
 *
 * All authenticated roles may search. No additional RBAC restriction beyond
 * authentication is required (Req 9.1).
 *
 * Returns the matching item with its full `history` array populated (Req 9.1).
 *
 * Error responses:
 *   401 UNAUTHORIZED    — missing x-user-id or x-user-role headers
 *   400 INVALID_INPUT   — `q` query param is absent or empty
 *   422 VALIDATION_ERROR — `q` does not match Lot ID or UUID format (Req 9.3, 9.7)
 *   404 NOT_FOUND       — no item matches the query (Req 9.2)
 *   500 INTERNAL_ERROR  — unexpected server error
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

  // ── 2. RBAC check — all authenticated roles may search items ───────────────
  if (!checkPermission(userRole, "items:read")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: request.headers.get("x-user-email") ?? "",
      action: "items:read",
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        "unknown",
    });
    return NextResponse.json(
      errorResponse("FORBIDDEN", "You do not have permission to search items."),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 3. Read and validate the `q` query param ───────────────────────────────
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim() === "") {
    return NextResponse.json(
      errorResponse(
        "INVALID_INPUT",
        "Query parameter `q` is required. Provide a Lot ID (LOT-YYYY-NNNNN) or item UUID.",
      ),
      { status: getHttpStatus("INVALID_INPUT") },
    );
  }

  // ── 4. Call item service ───────────────────────────────────────────────────
  let item: Item;
  try {
    item = await searchItem(q.trim(), userId);
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

    if (serviceError.code === "NOT_FOUND") {
      return NextResponse.json(
        errorResponse("NOT_FOUND", serviceError.message),
        { status: getHttpStatus("NOT_FOUND") },
      );
    }

    // INTERNAL_ERROR or any unexpected error
    console.error(
      "[GET /api/search] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  // ── 5. Return 200 with the item (including history) ────────────────────────
  return NextResponse.json(successResponse(item), { status: 200 });
}
