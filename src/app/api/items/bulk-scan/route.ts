/**
 * POST /api/items/bulk-scan — Process a batch of scan updates
 *
 * Reads user context from headers injected by middleware, enforces RBAC,
 * delegates to the item service, and returns a 207 Multi-Status response.
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 6.4–6.6, 6.8
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import {
  ACTIONS,
  checkPermission,
  isTargetStatusAllowed,
  STATUS_GROUPS_BY_PERMISSION,
} from "@/lib/rbac";
import { writeForbiddenAttempt } from "@/lib/audit";
import { processScanBatch } from "@/services/item-service";
import type {
  ItemStatus,
  ScanBatchRequest,
  ScanBatchResponse,
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

/**
 * Derive the gating action for a (disallowed) target status, consistent with
 * rbac's `STATUS_GROUPS_BY_PERMISSION` grouping:
 *   `qc_pass` → `items:qc_pass`, `qc_fail` → `items:qc_fail`,
 *   any other transition status → `items:update_status`.
 *
 * Used to record the offending action on a `forbidden_attempt` audit entry when
 * a caller submits a `target_status` not permitted for their role.
 */
function getGatingActionForStatus(status: ItemStatus): string {
  for (const group of STATUS_GROUPS_BY_PERMISSION) {
    if (group.statuses.includes(status)) {
      return group.permission;
    }
  }
  return ACTIONS.ITEMS_UPDATE_STATUS;
}

/**
 * POST /api/items/bulk-scan
 *
 * Accepts a ScanBatchRequest (1–50 items), processes each scan independently,
 * and returns a ScanBatchResponse with HTTP 207 (Multi-Status) to indicate
 * that individual items may have succeeded or failed.
 *
 * RBAC: operator, qc, and admin roles are permitted (items:bulk_scan).
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 6.4–6.6, 6.8
 */
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

  // ── 2. RBAC check — operator, qc, and admin may bulk scan ─────────────────
  if (!checkPermission(userRole, "items:bulk_scan")) {
    void writeForbiddenAttempt({
      userId,
      userEmail: userEmail ?? "",
      action: "items:bulk_scan",
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to perform bulk scans.",
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

  const batch = (body ?? {}) as ScanBatchRequest;

  // ── 3b. Enforce role/status mapping — fail-closed before per-item processing ─
  // The coarse `items:bulk_scan` check above only establishes that the caller may
  // scan at all. Each item's `target_status` must additionally be permitted for
  // the caller's role; otherwise the request is forged/stale relative to the UI.
  // If ANY item carries a disallowed status, reject the whole batch with FORBIDDEN
  // and do NOT apply any transition.
  const items = Array.isArray(batch.items) ? batch.items : [];
  const disallowedItem = items.find(
    (item) => !isTargetStatusAllowed(userRole, item.target_status),
  );
  if (disallowedItem) {
    void writeForbiddenAttempt({
      userId,
      userEmail: userEmail ?? "",
      action: getGatingActionForStatus(disallowedItem.target_status),
      ip: getClientIp(request),
    });
    return NextResponse.json(
      errorResponse(
        "FORBIDDEN",
        "You do not have permission to apply one or more of the requested target statuses.",
      ),
      { status: getHttpStatus("FORBIDDEN") },
    );
  }

  // ── 4. Get client IP ───────────────────────────────────────────────────────
  const ip = getClientIp(request);

  // ── 5. Call item service ───────────────────────────────────────────────────
  let data: ScanBatchResponse;
  try {
    data = await processScanBatch(batch, userId, userEmail, ip);
  } catch (err) {
    const serviceError = err as { code: string; message: string };

    if (serviceError.code === "BATCH_TOO_LARGE") {
      return NextResponse.json(
        errorResponse("BATCH_TOO_LARGE", serviceError.message),
        { status: getHttpStatus("BATCH_TOO_LARGE") },
      );
    }

    // INTERNAL_ERROR or any unexpected error
    console.error(
      "[POST /api/items/bulk-scan] Internal error:",
      serviceError.message ?? err,
    );
    return NextResponse.json(
      errorResponse("INTERNAL_ERROR", "An unexpected error occurred."),
      { status: getHttpStatus("INTERNAL_ERROR") },
    );
  }

  // ── 6. Return 207 Multi-Status ─────────────────────────────────────────────
  return NextResponse.json(successResponse(data), { status: 207 });
}
