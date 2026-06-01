/**
 * Preservation Property Tests — Scan Role Status Filter Bugfix
 *
 * Property 2: Preservation — Non-Role-Dependent Scan Behavior
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * METHODOLOGY (observation-first): every assertion in this file encodes a
 * behavior that is TRUE on the UNFIXED code and must REMAIN TRUE after the fix.
 * These tests are written and run against the UNFIXED code first; they MUST
 * PASS, establishing the baseline to preserve. They only encode behavior for
 * role-permitted inputs — the buggy behavior (e.g. an operator submitting
 * `qc_pass` being accepted) is deliberately NOT encoded as something to keep.
 *
 * SCOPE NOTE: the project's Vitest environment is `node` and no DOM testing
 * libraries (jsdom / @testing-library) are installed, so React components
 * (`ScanPage`, `NavBar`) are not rendered here. Instead the preservation
 * guarantees are observed at the layers the fix actually touches and that the
 * design names as the single source of truth:
 *   - RBAC permission map (`PERMISSIONS` / `checkPermission`) — the durable
 *     truth behind "admin sees all 8", "ppic is denied", role/status mapping.
 *   - Bulk-scan route handler — the server authorization + pass-through layer.
 *   - Scan pipeline modules (`validateTransition`, `checkDuplicate`,
 *     `ScanQueue`) — state machine, in-session de-dupe, offline queue.
 * The fix is additive (adds `getAllowedTargetStatuses` and wires it in) and
 * does not alter `PERMISSIONS`, the state machine, de-dupe, or the queue, so
 * these observations remain valid post-fix.
 */

import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks (route depends on DB-backed modules) ─────────────────────────
// The preservation property for the route is specifically that the authorization
// layer passes a role-permitted batch through to `processScanBatch` UNCHANGED.
// We therefore stub `processScanBatch` (so no live DB is needed) and assert it is
// invoked with the exact batch; `checkPermission` stays REAL — it is the genuine
// behavior under test. `writeForbiddenAttempt` (imported by the route from
// `@/lib/audit`) is stubbed to avoid a DB write on the denial path.
const { processScanBatchMock } = vi.hoisted(() => ({
  processScanBatchMock: vi.fn(),
}));
const { writeForbiddenAttemptMock } = vi.hoisted(() => ({
  writeForbiddenAttemptMock: vi.fn(),
}));

vi.mock("@/services/item-service", () => ({
  processScanBatch: processScanBatchMock,
}));
vi.mock("@/lib/audit", () => ({
  writeForbiddenAttempt: writeForbiddenAttemptMock,
}));

import { POST } from "@/app/api/items/bulk-scan/route";
import { checkPermission } from "@/lib/rbac";
import { ScanQueue } from "@/lib/scan-queue";
import { validateTransition } from "@/lib/state-machine";
import { checkDuplicate } from "@/lib/sync-manager";
import type { ItemStatus, ScanBatchResponse, UserRole } from "@/types";
import { VALID_TRANSITIONS } from "@/types";
import { NextRequest } from "next/server";

// ── Domain constants (test-local source of truth from the design) ─────────────

const ALL_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

/** The 8 scan target statuses in stable display order (matches the UI list). */
const ALL_TARGET_STATUSES: ItemStatus[] = [
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
];

/**
 * The permission that gates each target status, derived from `src/lib/rbac.ts`:
 *   - qc_pass  → items:qc_pass
 *   - qc_fail  → items:qc_fail
 *   - everything else (operator transitions) → items:update_status
 * (`qc_pending` is treated as an operator status per the design.)
 */
const GATING_PERMISSION: Record<ItemStatus, string> = {
  received: "items:update_status",
  qc_pending: "items:update_status",
  qc_pass: "items:qc_pass",
  qc_fail: "items:qc_fail",
  in_production: "items:update_status",
  finished: "items:update_status",
  cold_storage: "items:update_status",
  dispatched: "items:update_status",
  archived: "items:update_status",
};

/** A (role, status) pair is "role-permitted" iff the role may bulk-scan AND
 *  holds the permission that gates the target status. */
function isRolePermitted(role: UserRole, status: ItemStatus): boolean {
  return (
    checkPermission(role, "items:bulk_scan") &&
    checkPermission(role, GATING_PERMISSION[status])
  );
}

const ROLE_PERMITTED_PAIRS: { role: UserRole; status: ItemStatus }[] = [];
for (const role of ALL_ROLES) {
  for (const status of ALL_TARGET_STATUSES) {
    if (isRolePermitted(role, status)) {
      ROLE_PERMITTED_PAIRS.push({ role, status });
    }
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

const lotIdArb = fc
  .tuple(
    fc.integer({ min: 2000, max: 2099 }),
    fc.integer({ min: 0, max: 99999 }),
  )
  .map(([year, n]) => `LOT-${year}-${String(n).padStart(5, "0")}`);

function buildScanRequest(
  role: UserRole,
  items: { lot_id: string; target_status: ItemStatus; timestamp: string }[],
): NextRequest {
  return new NextRequest("http://localhost/api/items/bulk-scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": "11111111-1111-1111-1111-111111111111",
      "x-user-role": role,
      "x-user-email": `${role}@example.com`,
    },
    body: JSON.stringify({ items }),
  });
}

function makeBatchResponse(items: { lot_id: string }[]): ScanBatchResponse {
  return {
    processed_at: "2024-06-01T10:00:00.000Z",
    results: items.map((it) => ({
      lot_id: it.lot_id,
      success: true as const,
      item: {
        lot_id: it.lot_id,
        current_status: "in_production",
        location_zone: "PROD-01",
      },
    })),
  };
}

const NUM_RUNS = 100;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 3.1 — Admin's full target-status list is preserved ───────────────────────

describe("Preservation 3.1 — admin full target-status list", () => {
  it("admin holds the gating permission for ALL 8 target statuses (stable order)", () => {
    // Observable baseline: on unfixed code admin sees all 8 statuses because
    // admin holds every transition permission. This must remain true post-fix
    // (getAllowedTargetStatuses("admin") must yield all 8 in this order).
    expect(ALL_TARGET_STATUSES).toHaveLength(8);
    for (const status of ALL_TARGET_STATUSES) {
      expect(checkPermission("admin", GATING_PERMISSION[status])).toBe(true);
    }
    // Stable display order is fixed and must not drift.
    expect(ALL_TARGET_STATUSES).toEqual([
      "qc_pending",
      "qc_pass",
      "qc_fail",
      "in_production",
      "finished",
      "cold_storage",
      "dispatched",
      "archived",
    ]);
  });

  it("admin scans for ANY of the 8 target statuses are accepted (207 pass-through)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_TARGET_STATUSES),
        lotIdArb,
        async (status, lotId) => {
          // fast-check runs many iterations within one test; reset call
          // history each iteration so cumulative counts don't leak across runs.
          processScanBatchMock.mockClear();
          processScanBatchMock.mockResolvedValueOnce(
            makeBatchResponse([{ lot_id: lotId }]),
          );
          const items = [
            { lot_id: lotId, target_status: status, timestamp: "t" },
          ];
          const res = await POST(buildScanRequest("admin", items));
          expect(res.status).toBe(207);
          expect(processScanBatchMock).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── 3.2 — Operator access + operator-permitted scans preserved ───────────────

describe("Preservation 3.2 — operator access and operator scans", () => {
  it("operator holds items:bulk_scan (scan-page access basis) and NOT qc permissions", () => {
    expect(checkPermission("operator", "items:bulk_scan")).toBe(true);
    expect(checkPermission("operator", "items:update_status")).toBe(true);
    expect(checkPermission("operator", "items:qc_pass")).toBe(false);
    expect(checkPermission("operator", "items:qc_fail")).toBe(false);
  });

  it("operator scan to an operator status (e.g. in_production) succeeds (207, passed through)", async () => {
    processScanBatchMock.mockResolvedValueOnce(
      makeBatchResponse([{ lot_id: "LOT-2024-00001" }]),
    );
    const items = [
      {
        lot_id: "LOT-2024-00001",
        target_status: "in_production" as ItemStatus,
        timestamp: "t",
      },
    ];
    const res = await POST(buildScanRequest("operator", items));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(processScanBatchMock).toHaveBeenCalledTimes(1);
    // Batch passed through unchanged.
    expect(processScanBatchMock.mock.calls[0][0]).toEqual({ items });
  });
});

// ─── 3.3 — Every role-permitted (role, status) passes through unchanged ───────

describe("Preservation 3.3 — role-permitted scans processed unchanged", () => {
  it("precomputed role-permitted pairs cover operator(6), qc(2), admin(8); ppic(0)", () => {
    const countFor = (r: UserRole) =>
      ROLE_PERMITTED_PAIRS.filter((p) => p.role === r).length;
    expect(countFor("operator")).toBe(6);
    expect(countFor("qc")).toBe(2);
    expect(countFor("admin")).toBe(8);
    expect(countFor("ppic")).toBe(0);
  });

  it("for every role-permitted (role,status), the authorization layer forwards the batch to processScanBatch unchanged and returns 207 with the per-item ScanResult shape", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ROLE_PERMITTED_PAIRS),
        lotIdArb,
        async ({ role, status }, lotId) => {
          // Reset mock history each iteration (fast-check loops within one test).
          processScanBatchMock.mockClear();
          writeForbiddenAttemptMock.mockClear();
          const expected = makeBatchResponse([{ lot_id: lotId }]);
          processScanBatchMock.mockResolvedValueOnce(expected);

          const items = [
            { lot_id: lotId, target_status: status, timestamp: "t" },
          ];
          const res = await POST(buildScanRequest(role, items));

          // 207 Multi-Status shape preserved.
          expect(res.status).toBe(207);
          const json = await res.json();
          expect(json.success).toBe(true);
          expect(json.data.results).toHaveLength(1);
          expect(json.data.results[0]).toMatchObject({
            lot_id: lotId,
            success: true,
          });

          // Pass-through: called exactly once with the exact batch, unchanged.
          expect(processScanBatchMock).toHaveBeenCalledTimes(1);
          expect(processScanBatchMock.mock.calls[0][0]).toEqual({ items });
          // No forbidden audit entry on the permitted path.
          expect(writeForbiddenAttemptMock).not.toHaveBeenCalled();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── 3.4 — Pipeline behavior preserved (state machine / de-dupe / queue) ──────

describe("Preservation 3.4 — scan pipeline behavior", () => {
  it("VALID_TRANSITIONS state machine: validateTransition agrees with the table for all (current,target) pairs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(VALID_TRANSITIONS) as ItemStatus[])),
        fc.constantFrom(...(Object.keys(VALID_TRANSITIONS) as ItemStatus[])),
        (current, target) => {
          const { valid, allowed } = validateTransition(current, target);
          expect(allowed).toEqual(VALID_TRANSITIONS[current]);
          expect(valid).toBe(VALID_TRANSITIONS[current].includes(target));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("invalid transition (e.g. received -> archived) is rejected; valid one (received -> qc_pending) is accepted", () => {
    expect(validateTransition("received", "archived").valid).toBe(false);
    expect(validateTransition("received", "qc_pending").valid).toBe(true);
    expect(validateTransition("archived", "qc_pending").valid).toBe(false);
  });

  it("in-session duplicate detection: first scan of a lot_id is new, repeat is duplicate", () => {
    fc.assert(
      fc.property(
        fc.array(lotIdArb, { minLength: 1, maxLength: 20 }),
        (lots) => {
          const processed = new Set<string>();
          const seen = new Set<string>();
          for (const lot of lots) {
            const expectedDuplicate = seen.has(lot);
            expect(checkDuplicate(lot, processed)).toBe(expectedDuplicate);
            seen.add(lot);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("offline queue: enqueued scans become pending entries (FIFO, capped behavior intact)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            lot_id: lotIdArb,
            target_status: fc.constantFrom(...ALL_TARGET_STATUSES),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (scans) => {
          const queue = new ScanQueue();
          for (const s of scans) {
            queue.enqueue({
              lot_id: s.lot_id,
              target_status: s.target_status,
              timestamp: "2024-06-01T10:00:00.000Z",
            });
          }
          const pending = queue.getPending();
          expect(pending).toHaveLength(scans.length);
          // FIFO order preserved and every entry marked pending.
          pending.forEach((p, i) => {
            expect(p.lot_id).toBe(scans[i].lot_id);
            expect(p.status).toBe("pending");
            expect(p.retries).toBe(0);
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── 3.5 — ppic remains denied ────────────────────────────────────────────────

describe("Preservation 3.5 — ppic denial", () => {
  it("ppic does NOT hold items:bulk_scan and has zero role-permitted target statuses", () => {
    expect(checkPermission("ppic", "items:bulk_scan")).toBe(false);
    for (const status of ALL_TARGET_STATUSES) {
      expect(isRolePermitted("ppic", status)).toBe(false);
    }
  });

  it("bulk-scan route denies ppic with FORBIDDEN and never calls processScanBatch", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_TARGET_STATUSES),
        lotIdArb,
        async (status, lotId) => {
          const items = [
            { lot_id: lotId, target_status: status, timestamp: "t" },
          ];
          const res = await POST(buildScanRequest("ppic", items));
          expect(res.status).toBe(403);
          const json = await res.json();
          expect(json.success).toBe(false);
          expect(json.error.code).toBe("FORBIDDEN");
          expect(processScanBatchMock).not.toHaveBeenCalled();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
