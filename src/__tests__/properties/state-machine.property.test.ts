/**
 * Property-Based Tests for State Machine Transitions (Property 7)
 *
 * **Validates: Requirements 5.1–5.6**
 *
 * Property 7: State Machine Enforces Valid Transitions
 * For any item in any ItemStatus state and any requested target_status, the
 * Item_Service SHALL permit the transition if and only if target_status is in
 * the valid transitions map for current_status (and target_status ≠
 * current_status). Valid transitions SHALL atomically update current_status and
 * updated_at in the database and write an item_status_changed AuditEntry.
 * Invalid transitions SHALL return INVALID_TRANSITION with current_status,
 * target_status, and the list of allowed transitions.
 */

import { updateItemStatus } from "@/services/item-service";
import type { Item, ItemStatus } from "@/types";
import { VALID_TRANSITIONS } from "@/types";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statuses = Object.keys(VALID_TRANSITIONS) as ItemStatus[];

/** Build a minimal Item fixture with the given status. */
function makeItem(status: ItemStatus): Item {
  return {
    id: "item-uuid-1234",
    lot_id: "LOT-2024-00001",
    material_type: "Raw Extract",
    supplier: "Supplier A",
    intake_date: "2024-01-15",
    current_status: status,
    location_zone: "RECEIVING",
    created_by: "user-uuid-5678",
    created_at: "2024-01-15T10:00:00.000Z",
    updated_at: "2024-01-15T10:00:00.000Z",
  };
}

/** Build an updated Item fixture reflecting the target status. */
function makeUpdatedItem(original: Item, targetStatus: ItemStatus): Item {
  return {
    ...original,
    current_status: targetStatus,
    updated_at: new Date().toISOString(),
  };
}

// ─── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock that:
 * - Returns `item` for the fetch query (.from("items").select().eq().single())
 * - Returns `updatedItem` for the update query (.from("items").update().eq().select().single())
 * - Returns `{ error: null }` for audit log inserts (.from("audit_logs").insert())
 */
function makeSupabaseMock(item: Item | null, updatedItem: Item | null) {
  const auditInsertChain = { error: null };

  // Update chain: .update().eq().select().single()
  const updateSingleFn = vi.fn().mockResolvedValue({
    data: updatedItem,
    error: updatedItem ? null : { message: "update failed" },
  });
  const updateSelectFn = vi.fn().mockReturnValue({ single: updateSingleFn });
  const updateEqFn = vi.fn().mockReturnValue({ select: updateSelectFn });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn });

  // Fetch chain: .select().eq().single()
  const fetchSingleFn = vi.fn().mockResolvedValue({
    data: item,
    error: item ? null : { message: "not found" },
  });
  const fetchEqFn = vi.fn().mockReturnValue({ single: fetchSingleFn });
  const fetchSelectFn = vi.fn().mockReturnValue({ eq: fetchEqFn });

  // Audit insert chain: .insert()
  const auditInsertFn = vi.fn().mockResolvedValue(auditInsertChain);

  // .from() dispatcher
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "items") {
      return {
        select: fetchSelectFn,
        update: updateFn,
      };
    }
    if (table === "audit_logs") {
      return { insert: auditInsertFn };
    }
    return {};
  });

  return { from: fromFn };
}

// ─── Module mock setup ────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

// Import after mock declaration so vi.mock hoisting works
import { getSupabaseClient } from "@/lib/supabase";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 7: State Machine Enforces Valid Transitions", () => {
  const userId = "user-uuid-0001";
  const userEmail = "operator@example.com";
  const ip = "127.0.0.1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Property 7a: Valid transitions succeed ──────────────────────────────────

  it("valid transitions: updateItemStatus succeeds and returns item with target status", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses)),
        async ([current, target]) => {
          // Only test valid (non-self) transitions
          const allowed = VALID_TRANSITIONS[current];
          if (!allowed.includes(target)) return; // skip invalid pairs

          const item = makeItem(current);
          const updatedItem = makeUpdatedItem(item, target);
          const mockClient = makeSupabaseMock(item, updatedItem);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const result = await updateItemStatus(
            item.lot_id,
            target,
            userId,
            userEmail,
            ip,
          );

          // The returned item must have the target status
          expect(result.current_status).toBe(target);
          // The lot_id must be unchanged
          expect(result.lot_id).toBe(item.lot_id);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 7b: Invalid transitions throw INVALID_TRANSITION ──────────────

  it("invalid transitions: updateItemStatus throws INVALID_TRANSITION with correct fields", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses)),
        async ([current, target]) => {
          const allowed = VALID_TRANSITIONS[current];
          // Only test invalid (non-self) transitions
          if (allowed.includes(target)) return; // skip valid pairs

          const item = makeItem(current);
          // updatedItem is null — update should never be called for invalid transitions
          const mockClient = makeSupabaseMock(item, null);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await updateItemStatus(item.lot_id, target, userId, userEmail, ip);
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeDefined();
          const error = thrown as {
            code: string;
            current_status: ItemStatus;
            target_status: ItemStatus;
            allowed: ItemStatus[];
          };

          // Must be INVALID_TRANSITION
          expect(error.code).toBe("INVALID_TRANSITION");
          // Must report the correct current status
          expect(error.current_status).toBe(current);
          // Must report the correct target status
          expect(error.target_status).toBe(target);
          // Must report the correct allowed list
          expect(error.allowed).toEqual(VALID_TRANSITIONS[current]);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 7c: Self-transitions are always invalid ───────────────────────

  it("self-transitions: transitioning to the same status always throws INVALID_TRANSITION", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...statuses), async (status) => {
        const item = makeItem(status);
        const mockClient = makeSupabaseMock(item, null);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        let thrown: unknown;
        try {
          await updateItemStatus(item.lot_id, status, userId, userEmail, ip);
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeDefined();
        const error = thrown as {
          code: string;
          current_status: ItemStatus;
          target_status: ItemStatus;
          allowed: ItemStatus[];
        };

        expect(error.code).toBe("INVALID_TRANSITION");
        expect(error.current_status).toBe(status);
        expect(error.target_status).toBe(status);
        // allowed must match the VALID_TRANSITIONS map (self is never in it)
        expect(error.allowed).toEqual(VALID_TRANSITIONS[status]);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 7d: Archived status has no valid outgoing transitions ──────────

  it("archived transitions: transitioning from archived always throws INVALID_TRANSITION with allowed: []", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...statuses), async (target) => {
        const item = makeItem("archived");
        const mockClient = makeSupabaseMock(item, null);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        let thrown: unknown;
        try {
          await updateItemStatus(item.lot_id, target, userId, userEmail, ip);
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeDefined();
        const error = thrown as {
          code: string;
          current_status: ItemStatus;
          target_status: ItemStatus;
          allowed: ItemStatus[];
        };

        expect(error.code).toBe("INVALID_TRANSITION");
        expect(error.current_status).toBe("archived");
        expect(error.target_status).toBe(target);
        // archived has no valid outgoing transitions
        expect(error.allowed).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 7e: Valid transitions write an audit entry ────────────────────

  it("valid transitions: updateItemStatus writes an item_status_changed audit entry", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses)),
        async ([current, target]) => {
          const allowed = VALID_TRANSITIONS[current];
          if (!allowed.includes(target)) return; // skip invalid pairs

          const item = makeItem(current);
          const updatedItem = makeUpdatedItem(item, target);
          const mockClient = makeSupabaseMock(item, updatedItem);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          await updateItemStatus(item.lot_id, target, userId, userEmail, ip);

          // Verify that audit_logs.insert was called (audit entry written)
          const auditInsertCalls = vi
            .mocked(mockClient.from)
            .mock.calls.filter(([table]) => table === "audit_logs");

          expect(auditInsertCalls.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 7f: Invalid transitions do NOT write an audit entry ────────────

  it("invalid transitions: updateItemStatus does NOT write an audit entry", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses)),
        async ([current, target]) => {
          const allowed = VALID_TRANSITIONS[current];
          if (allowed.includes(target)) return; // skip valid pairs

          const item = makeItem(current);
          const mockClient = makeSupabaseMock(item, null);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          try {
            await updateItemStatus(item.lot_id, target, userId, userEmail, ip);
          } catch {
            // expected to throw
          }

          // Verify that audit_logs.insert was NOT called
          const auditInsertCalls = vi
            .mocked(mockClient.from)
            .mock.calls.filter(([table]) => table === "audit_logs");

          expect(auditInsertCalls.length).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});
