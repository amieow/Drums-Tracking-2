/**
 * UI/Server Agreement + Mapping-Consistency Property Tests
 *
 * Scan Role Status Filter Bugfix — Checkpoint (Task 4) cross-layer invariants.
 *
 * Validates: Requirements 2.1, 2.3, 2.4, 3.1, 3.3, 3.5
 *
 * These properties pin down the two cross-layer invariants named in the design's
 * "Property-Based Tests" section:
 *
 *   1. UI/SERVER AGREEMENT — for every (role, status) pair, the UI option list
 *      contains `status` IF AND ONLY IF the server accepts a single-item batch
 *      with that `target_status` for that role (207) rather than rejecting it
 *      (403 FORBIDDEN). The UI list is `getAllowedTargetStatuses(role)` and the
 *      server guard is `isTargetStatusAllowed` inside the bulk-scan route, so
 *      this asserts the single source of truth cannot drift between layers.
 *
 *   2. MAPPING CONSISTENCY — for every role, `getAllowedTargetStatuses(role)` is
 *      a subset of the statuses gated by permissions the role actually holds in
 *      `PERMISSIONS` (via `checkPermission`). The mapping never grants a status
 *      the role's RBAC permissions do not.
 *
 * Test environment is `node`. The bulk-scan route is invoked by calling its
 * exported `POST` handler directly; `processScanBatch` is mocked so an allowed
 * batch returns 207 without a live DB, and `writeForbiddenAttempt` (imported by
 * the route from `@/lib/audit`) is stubbed so the denial path needs no
 * DATABASE_URL. `checkPermission` / `getAllowedTargetStatuses` /
 * `isTargetStatusAllowed` stay REAL — they are the single source of truth under
 * test.
 */

import type { ItemStatus, UserRole } from "@/types";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

// ─── Mocks (mirror bug-condition.pbt.test.ts) ──────────────────────────────────

// item-service: stub processScanBatch so an allowed batch returns 207 without a
// live DB. We assert the authorization OUTCOME (207 vs 403), not DB behavior.
vi.mock("@/services/item-service", () => ({
  processScanBatch: vi.fn(async () => ({
    processed_at: new Date().toISOString(),
    results: [{ lot_id: "LOT-2024-00001", success: true }],
  })),
}));

// audit: stub the DB-backed write so the denial path needs no DATABASE_URL
// (the route imports `writeForbiddenAttempt` from `@/lib/audit`).
vi.mock("@/lib/audit", () => ({
  writeForbiddenAttempt: vi.fn(async () => {}),
}));

import {
  checkPermission,
  getAllowedTargetStatuses,
  STATUS_GROUPS_BY_PERMISSION,
} from "@/lib/rbac";

// ─── Domain constants ───────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

/** The 8 scan target statuses (the UI's full candidate list). */
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

/** Map each target status to the permission that gates it (from rbac groups). */
const STATUS_GATING_PERMISSION: Record<ItemStatus, string> = (() => {
  const map = {} as Record<ItemStatus, string>;
  for (const group of STATUS_GROUPS_BY_PERMISSION) {
    for (const status of group.statuses) {
      map[status] = group.permission;
    }
  }
  return map;
})();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Call the bulk-scan POST handler as `role` submitting a single-item batch. */
async function serverAcceptsSingleItem(
  role: UserRole,
  targetStatus: ItemStatus,
): Promise<{ status: number; accepted: boolean }> {
  const { POST } = await import("@/app/api/items/bulk-scan/route");
  const { NextRequest } = await import("next/server");

  const req = new NextRequest("http://localhost/api/items/bulk-scan", {
    method: "POST",
    headers: {
      "x-user-id": "11111111-1111-1111-1111-111111111111",
      "x-user-role": role,
      "x-user-email": `${role}@example.com`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          lot_id: "LOT-2024-00001",
          target_status: targetStatus,
          timestamp: "2024-01-01T00:00:00Z",
        },
      ],
    }),
  });

  const res = await POST(req);
  // The route returns 207 (Multi-Status) for an accepted batch and 403 for a
  // FORBIDDEN rejection. "accepted" == the server applied (delegated) the scan.
  return { status: res.status, accepted: res.status === 207 };
}

const ROLE_STATUS_PAIRS: { role: UserRole; status: ItemStatus }[] = [];
for (const role of ALL_ROLES) {
  for (const status of ALL_TARGET_STATUSES) {
    ROLE_STATUS_PAIRS.push({ role, status });
  }
}

// ─── Property: UI/Server Agreement ────────────────────────────────────────────

describe("UI/Server agreement — option list contains status IFF server accepts it", () => {
  it("for every (role, status), getAllowedTargetStatuses(role).includes(status) === server accepts single-item batch (207 vs 403)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ROLE_STATUS_PAIRS),
        async ({ role, status }) => {
          const uiContains = getAllowedTargetStatuses(role).includes(status);
          const { accepted } = await serverAcceptsSingleItem(role, status);
          // The biconditional: UI shows it IFF the server accepts it.
          expect(accepted).toBe(uiContains);
        },
      ),
      {
        numRuns: 100,
        examples: ROLE_STATUS_PAIRS.map((p) => [p] as [typeof p]),
      },
    );
  });

  it("concrete agreement spot-checks across all roles", async () => {
    // operator: operator statuses accepted, qc statuses rejected
    expect(
      (await serverAcceptsSingleItem("operator", "in_production")).status,
    ).toBe(207);
    expect((await serverAcceptsSingleItem("operator", "qc_pass")).status).toBe(
      403,
    );
    // qc: qc statuses accepted, operator statuses rejected
    expect((await serverAcceptsSingleItem("qc", "qc_pass")).status).toBe(207);
    expect((await serverAcceptsSingleItem("qc", "in_production")).status).toBe(
      403,
    );
    // admin: everything accepted
    expect((await serverAcceptsSingleItem("admin", "qc_fail")).status).toBe(
      207,
    );
    expect((await serverAcceptsSingleItem("admin", "dispatched")).status).toBe(
      207,
    );
    // ppic: nothing accepted (no items:bulk_scan)
    expect((await serverAcceptsSingleItem("ppic", "qc_pending")).status).toBe(
      403,
    );
  });
});

// ─── Property: Mapping Consistency ─────────────────────────────────────────────

describe("Mapping consistency — getAllowedTargetStatuses(role) ⊆ statuses gated by held permissions", () => {
  it("for every role, every allowed status is gated by a permission the role actually holds in PERMISSIONS", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_ROLES), (role) => {
        const allowed = getAllowedTargetStatuses(role);
        for (const status of allowed) {
          const gating = STATUS_GATING_PERMISSION[status];
          // Subset condition: the role must hold the gating permission.
          expect(checkPermission(role, gating)).toBe(true);
        }
      }),
      { numRuns: 100, examples: ALL_ROLES.map((r) => [r] as [UserRole]) },
    );
  });

  it("per-role allowed counts match the RBAC-derived expectation (operator 6, qc 2, admin 8, ppic 0)", () => {
    expect(getAllowedTargetStatuses("operator")).toHaveLength(6);
    expect(getAllowedTargetStatuses("qc")).toHaveLength(2);
    expect(getAllowedTargetStatuses("admin")).toHaveLength(8);
    expect(getAllowedTargetStatuses("ppic")).toHaveLength(0);
  });
});
