/**
 * Property-Based Tests for Item Registration–Search Round-Trip (Property 15)
 *
 * **Validates: Requirements 9.1, 9.6**
 *
 * Property 15: Item Registration–Search Round-Trip
 * Generate valid registration inputs; register item, then search by returned
 * `lot_id`; assert returned record matches `material_type`, `supplier`,
 * `intake_date`, `current_status = "received"`, `location_zone = "RECEIVING"`,
 * and `history` contains `item_created` entry.
 */

import { registerItem, searchItem } from "@/services/item-service";
import type { Item, ItemHistoryEntry } from "@/types";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/lot-id-generator", () => ({
  generateLotId: vi.fn(),
}));

// Import after mock declarations so vi.mock hoisting works
import { generateLotId } from "@/lib/lot-id-generator";
import { getSupabaseClient } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a deterministic lot_id from an intake_date year (for mock). */
function makeLotId(intakeDate: string, seq = 1): string {
  const year = intakeDate.substring(0, 4);
  return `LOT-${year}-${seq.toString().padStart(5, "0")}`;
}

/** Build a full Item record from registration inputs and a lot_id. */
function makeItemRecord(
  lotId: string,
  materialType: string,
  supplier: string,
  intakeDate: string,
  userId: string,
): Item {
  return {
    id: "item-uuid-roundtrip",
    lot_id: lotId,
    material_type: materialType,
    supplier: supplier,
    intake_date: intakeDate,
    current_status: "received",
    location_zone: "RECEIVING",
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Build an item_created history entry. */
function makeItemCreatedHistory(
  lotId: string,
  userId: string,
  userEmail: string,
): ItemHistoryEntry {
  return {
    action: "item_created",
    previous_state: null,
    new_state: JSON.stringify({
      lot_id: lotId,
      current_status: "received",
      location_zone: "RECEIVING",
    }),
    user_id: userId,
    user_email: userEmail,
    timestamp: new Date().toISOString(),
  };
}

// ─── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock that handles:
 * - registerItem: items.insert().select().single() + audit_logs.insert()
 * - searchItem: items.select().eq().maybeSingle() + audit_logs.select().eq().order()
 */
function makeSupabaseMock(
  insertedItem: Item,
  searchedItem: Item,
  auditHistory: ItemHistoryEntry[],
) {
  // ── registerItem chains ──────────────────────────────────────────────────

  // items.insert().select().single()
  const insertSingleFn = vi.fn().mockResolvedValue({
    data: {
      id: insertedItem.id,
      lot_id: insertedItem.lot_id,
      created_at: insertedItem.created_at,
      current_status: insertedItem.current_status,
      location_zone: insertedItem.location_zone,
    },
    error: null,
  });
  const insertSelectFn = vi.fn().mockReturnValue({ single: insertSingleFn });
  const insertFn = vi.fn().mockReturnValue({ select: insertSelectFn });

  // audit_logs.insert()
  const auditInsertFn = vi.fn().mockResolvedValue({ error: null });

  // ── searchItem chains ────────────────────────────────────────────────────

  // items.select("*").eq("lot_id", ...).maybeSingle()
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: searchedItem,
    error: null,
  });
  const searchEqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const searchSelectFn = vi.fn().mockReturnValue({ eq: searchEqFn });

  // audit_logs.select(...).eq(...).order(...)
  const auditOrderFn = vi.fn().mockResolvedValue({
    data: auditHistory.map((h) => ({
      action: h.action,
      previous_state: h.previous_state,
      new_state: h.new_state,
      user_id: h.user_id,
      user_email: h.user_email,
      timestamp: h.timestamp,
    })),
    error: null,
  });
  const auditEqFn = vi.fn().mockReturnValue({ order: auditOrderFn });
  const auditSelectFn = vi.fn().mockReturnValue({ eq: auditEqFn });

  // ── .from() dispatcher ───────────────────────────────────────────────────

  // Track call count to distinguish registerItem vs searchItem calls to "items"
  let itemsCallCount = 0;

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "items") {
      itemsCallCount++;
      if (itemsCallCount === 1) {
        // First call: registerItem → insert
        return { insert: insertFn };
      } else {
        // Second call: searchItem → select
        return { select: searchSelectFn };
      }
    }
    if (table === "audit_logs") {
      // Could be insert (registerItem) or select (searchItem)
      return {
        insert: auditInsertFn,
        select: auditSelectFn,
      };
    }
    return {};
  });

  return { from: fromFn };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 15: Item Registration–Search Round-Trip", () => {
  const userId = "user-uuid-roundtrip";
  const userEmail = "operator@example.com";
  const ip = "127.0.0.1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registration–search round-trip: searched item matches all registered fields and history contains item_created", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          material_type: fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0),
          supplier: fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0),
          intake_date: fc
            .date({ min: new Date("2000-01-01"), max: new Date() })
            .map((d) => d.toISOString().split("T")[0]),
        }),
        async (input) => {
          vi.clearAllMocks();

          const lotId = makeLotId(input.intake_date);

          // Mock generateLotId to return a deterministic lot_id
          vi.mocked(generateLotId).mockResolvedValue(lotId);

          // Build the item record that the DB would return
          const itemRecord = makeItemRecord(
            lotId,
            input.material_type,
            input.supplier,
            input.intake_date,
            userId,
          );

          // Build the audit history that searchItem would return
          const auditHistory = [
            makeItemCreatedHistory(lotId, userId, userEmail),
          ];

          // Set up the Supabase mock
          const mockClient = makeSupabaseMock(
            itemRecord,
            itemRecord,
            auditHistory,
          );
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          // Step 1: Register the item
          const registration = await registerItem(input, userId, userEmail, ip);

          // Step 2: Search by the returned lot_id
          const result = await searchItem(registration.lot_id, userId);

          // Assert: material_type matches
          expect(result.material_type).toBe(input.material_type);

          // Assert: supplier matches
          expect(result.supplier).toBe(input.supplier);

          // Assert: intake_date matches
          expect(result.intake_date).toBe(input.intake_date);

          // Assert: current_status is "received"
          expect(result.current_status).toBe("received");

          // Assert: location_zone is "RECEIVING"
          expect(result.location_zone).toBe("RECEIVING");

          // Assert: history contains an item_created entry
          expect(result.history).toBeDefined();
          const hasItemCreated = result.history!.some(
            (entry) => entry.action === "item_created",
          );
          expect(hasItemCreated).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });
});
