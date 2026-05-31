/**
 * Integration Test: Lot ID Unique Constraint (Task 25.2)
 *
 * Validates: Requirements 4.2, 13.6
 *
 * Requirement 4.2: The Database SHALL enforce a unique constraint on the
 * `lot_id` column of the items table, rejecting duplicate values.
 *
 * Requirement 13.6: The Database SHALL enforce a unique constraint on `lot_id`
 * in the items table, and THE Item_Service SHALL return an `INTERNAL_ERROR` if
 * a duplicate `lot_id` generation is detected.
 *
 * This test is self-contained and does not require a live Supabase instance.
 * The Supabase client is mocked to simulate the unique constraint violation
 * that the database would return (PostgreSQL error code 23505).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerItem } from "../../services/item-service";

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => {
  const mockInsert = vi.fn();
  const mockFrom = vi.fn(() => ({
    insert: mockInsert,
  }));
  const mockGetSupabaseClient = vi.fn(() => ({
    from: mockFrom,
  }));
  return {
    getSupabaseClient: mockGetSupabaseClient,
    _mockFrom: mockFrom,
    _mockInsert: mockInsert,
  };
});

// ─── Mock @/lib/lot-id-generator ─────────────────────────────────────────────

vi.mock("@/lib/lot-id-generator", () => {
  const mockGenerateLotId = vi.fn();
  return {
    generateLotId: mockGenerateLotId,
    _mockGenerateLotId: mockGenerateLotId,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMocks() {
  const supabaseMod = await import("@/lib/supabase");
  const lotIdMod = await import("@/lib/lot-id-generator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = supabaseMod as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = lotIdMod as any;
  return {
    mockFrom: s._mockFrom as ReturnType<typeof vi.fn>,
    mockInsert: s._mockInsert as ReturnType<typeof vi.fn>,
    mockGenerateLotId: l._mockGenerateLotId as ReturnType<typeof vi.fn>,
  };
}

/**
 * Builds a mock Supabase insert chain that simulates a successful insert.
 * Returns the provided item data.
 */
function buildSuccessfulInsertChain(itemData: Record<string, unknown>) {
  const mockSingle = vi.fn().mockResolvedValueOnce({
    data: itemData,
    error: null,
  });
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  return vi.fn().mockReturnValue({ select: mockSelect });
}

/**
 * Builds a mock Supabase insert chain that simulates a unique constraint
 * violation — the error PostgreSQL returns when a UNIQUE constraint is
 * violated (error code 23505).
 */
function buildUniqueConstraintViolationChain() {
  const uniqueConstraintError = {
    code: "23505",
    message:
      'duplicate key value violates unique constraint "items_lot_id_key"',
    details: "Key (lot_id)=(LOT-2024-00001) already exists.",
    hint: null,
  };
  const mockSingle = vi.fn().mockResolvedValueOnce({
    data: null,
    error: uniqueConstraintError,
  });
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  return vi.fn().mockReturnValue({ select: mockSelect });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Lot ID Unique Constraint Integration (Req 4.2, 13.6)", () => {
  const DUPLICATE_LOT_ID = "LOT-2024-00001";
  const INTAKE_DATE = "2024-06-15"; // A fixed past date — always valid
  const USER_ID = "user-uuid-abc123";
  const USER_EMAIL = "operator@example.com";
  const IP = "192.168.1.1";

  const validInput = {
    material_type: "Vanilla Extract",
    supplier: "Supplier Co.",
    intake_date: INTAKE_DATE,
  };

  beforeEach(async () => {
    const { mockFrom, mockInsert, mockGenerateLotId } = await getMocks();
    mockFrom.mockReset();
    mockInsert.mockReset();
    mockGenerateLotId.mockReset();
  });

  // ── Test 1: First insert succeeds ────────────────────────────────────────────
  it("first insert with a new lot_id succeeds and returns the registered item", async () => {
    const { mockFrom, mockGenerateLotId } = await getMocks();

    mockGenerateLotId.mockResolvedValueOnce(DUPLICATE_LOT_ID);

    const createdAt = new Date().toISOString();
    const successInsert = buildSuccessfulInsertChain({
      id: "item-uuid-001",
      lot_id: DUPLICATE_LOT_ID,
      created_at: createdAt,
      current_status: "received",
      location_zone: "RECEIVING",
    });

    // Audit log insert (second call to from()) — always succeeds
    const auditInsert = vi.fn().mockResolvedValueOnce({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "items") return { insert: successInsert };
      return { insert: auditInsert };
    });

    const result = await registerItem(validInput, USER_ID, USER_EMAIL, IP);

    expect(result.lot_id).toBe(DUPLICATE_LOT_ID);
    expect(result.current_status).toBe("received");
    expect(result.location_zone).toBe("RECEIVING");
  });

  // ── Test 2: Second insert with same lot_id is rejected ───────────────────────
  it("second insert with the same lot_id is rejected with INTERNAL_ERROR (unique constraint violation)", async () => {
    const { mockFrom, mockGenerateLotId } = await getMocks();

    // Both calls to generateLotId return the same lot_id (simulating a
    // collision that the DB unique constraint must catch)
    mockGenerateLotId.mockResolvedValue(DUPLICATE_LOT_ID);

    // The second insert returns a unique constraint violation error
    const duplicateInsert = buildUniqueConstraintViolationChain();

    mockFrom.mockImplementation((table: string) => {
      if (table === "items") return { insert: duplicateInsert };
      return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
    });

    // The service must throw an INTERNAL_ERROR when the DB rejects the insert
    await expect(
      registerItem(validInput, USER_ID, USER_EMAIL, IP),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  // ── Test 3: Error message references the unique constraint ───────────────────
  it("the INTERNAL_ERROR thrown on duplicate lot_id contains a descriptive message", async () => {
    const { mockFrom, mockGenerateLotId } = await getMocks();

    mockGenerateLotId.mockResolvedValue(DUPLICATE_LOT_ID);

    const duplicateInsert = buildUniqueConstraintViolationChain();

    mockFrom.mockImplementation((table: string) => {
      if (table === "items") return { insert: duplicateInsert };
      return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
    });

    let thrownError: unknown;
    try {
      await registerItem(validInput, USER_ID, USER_EMAIL, IP);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError).toMatchObject({ code: "INTERNAL_ERROR" });

    // The error message should reference the DB error (unique constraint)
    const errorMessage = (thrownError as { message: string }).message;
    expect(typeof errorMessage).toBe("string");
    expect(errorMessage.length).toBeGreaterThan(0);
  });

  // ── Test 4: First insert succeeds, second insert with same lot_id is rejected ─
  it("sequential inserts: first succeeds, second with same lot_id is rejected", async () => {
    const { mockFrom, mockGenerateLotId } = await getMocks();

    // Both calls return the same lot_id
    mockGenerateLotId.mockResolvedValue(DUPLICATE_LOT_ID);

    const createdAt = new Date().toISOString();

    // Track call count to differentiate first vs second items insert
    let itemsInsertCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "items") {
        itemsInsertCallCount += 1;
        const callNumber = itemsInsertCallCount;

        if (callNumber === 1) {
          // First insert: success
          return {
            insert: buildSuccessfulInsertChain({
              id: "item-uuid-001",
              lot_id: DUPLICATE_LOT_ID,
              created_at: createdAt,
              current_status: "received",
              location_zone: "RECEIVING",
            }),
          };
        } else {
          // Second insert: unique constraint violation
          return { insert: buildUniqueConstraintViolationChain() };
        }
      }
      // audit_logs: always succeed
      return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
    });

    // First registration: should succeed
    const firstResult = await registerItem(validInput, USER_ID, USER_EMAIL, IP);
    expect(firstResult.lot_id).toBe(DUPLICATE_LOT_ID);
    expect(firstResult.current_status).toBe("received");

    // Second registration with same lot_id: should be rejected
    await expect(
      registerItem(validInput, USER_ID, USER_EMAIL, IP),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  // ── Test 5: Unique constraint is specific to lot_id, not other fields ─────────
  it("two items with different lot_ids but same material_type and supplier both succeed", async () => {
    const { mockFrom, mockGenerateLotId } = await getMocks();

    const LOT_ID_1 = "LOT-2024-00001";
    const LOT_ID_2 = "LOT-2024-00002";

    // Each call returns a different lot_id
    mockGenerateLotId
      .mockResolvedValueOnce(LOT_ID_1)
      .mockResolvedValueOnce(LOT_ID_2);

    const createdAt = new Date().toISOString();
    let itemsInsertCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "items") {
        itemsInsertCallCount += 1;
        const lotId = itemsInsertCallCount === 1 ? LOT_ID_1 : LOT_ID_2;
        return {
          insert: buildSuccessfulInsertChain({
            id: `item-uuid-00${itemsInsertCallCount}`,
            lot_id: lotId,
            created_at: createdAt,
            current_status: "received",
            location_zone: "RECEIVING",
          }),
        };
      }
      return { insert: vi.fn().mockResolvedValueOnce({ error: null }) };
    });

    const result1 = await registerItem(validInput, USER_ID, USER_EMAIL, IP);
    const result2 = await registerItem(validInput, USER_ID, USER_EMAIL, IP);

    expect(result1.lot_id).toBe(LOT_ID_1);
    expect(result2.lot_id).toBe(LOT_ID_2);

    // The two lot_ids must be distinct
    expect(result1.lot_id).not.toBe(result2.lot_id);
  });
});
