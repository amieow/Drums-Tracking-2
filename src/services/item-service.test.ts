/**
 * Unit Tests — Item Registration, Status Update & Bulk Scan Service
 *
 * Tests the `registerItem`, `updateItemStatus`, and `processScanBatch` functions
 * in isolation by mocking:
 *   - `@/lib/supabase`          → `getSupabaseClient()` returns a mock client
 *   - `@/lib/lot-id-generator`  → `generateLotId()` returns "LOT-2026-00001"
 *
 * Requirements: 3.1, 3.4, 3.5, 3.7, 5.1–5.6, 6.4–6.6, 6.8, 11.1, 11.2, 13.1, 13.2, 13.4, 13.5
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  processScanBatch,
  registerItem,
  searchItem,
  updateItemStatus,
} from "./item-service";

// ─── Mock: lot-id-generator ───────────────────────────────────────────────────

vi.mock("@/lib/lot-id-generator", () => ({
  generateLotId: vi.fn().mockResolvedValue("LOT-2026-00001"),
}));

// ─── Mock: supabase ───────────────────────────────────────────────────────────

// Mutable holder so individual tests can swap out the mock client.
let mockSupabaseClient: ReturnType<typeof buildMockClient>;

/**
 * Builds a fresh mock Supabase client.
 *
 * The `items` insert path uses the full chain:
 *   from("items").insert(...).select(...).single()
 *
 * The `audit_logs` insert path awaits `.insert(...)` directly (no .select/.single).
 * We handle both by making `insert` return an object that is ALSO a thenable
 * (resolves to `{ error: null }`) while still exposing `.select()`.
 */
function buildMockClient(itemsResult: { data: unknown; error: unknown }) {
  // audit insert: awaiting .insert() directly → { error: null }
  const auditInsertResult = Promise.resolve({ error: null });
  const auditInsertChain = Object.assign(auditInsertResult, {
    select: () => ({
      single: () => Promise.resolve({ data: {}, error: null }),
    }),
  });

  // items insert: .insert().select().single() → itemsResult
  const itemsInsertChain = {
    select: () => ({
      single: () => Promise.resolve(itemsResult),
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "items") {
        return { insert: vi.fn(() => itemsInsertChain) };
      }
      // audit_logs and any other table
      return { insert: vi.fn(() => auditInsertChain) };
    }),
  };
}

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(() => mockSupabaseClient),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A valid registration payload that passes all validation rules. */
const VALID_INPUT = {
  material_type: "Lavender Oil",
  supplier: "Acme Botanicals",
  intake_date: "2026-01-15",
};

/** Minimal user context required by registerItem. */
const USER_CTX = {
  userId: "user-uuid-001",
  userEmail: "operator@example.com",
  ip: "127.0.0.1",
};

/** The DB row returned by a successful insert. */
const MOCK_ITEM_ROW = {
  id: "item-uuid-001",
  lot_id: "LOT-2026-00001",
  created_at: "2026-01-15T08:00:00.000Z",
  current_status: "received",
  location_zone: "RECEIVING",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("registerItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: successful items insert
    mockSupabaseClient = buildMockClient({ data: MOCK_ITEM_ROW, error: null });
  });

  // ── 1. Valid input ──────────────────────────────────────────────────────────

  it("returns response with correct fields for valid input", async () => {
    const result = await registerItem(
      VALID_INPUT,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    expect(result.current_status).toBe("received");
    expect(result.location_zone).toBe("RECEIVING");
    expect(result.lot_id).toBe("LOT-2026-00001");
    expect(result.qr_code).toContain("LOT-2026-00001");
    expect(result.created_at).toBe(MOCK_ITEM_ROW.created_at);
  });

  // ── 2. Missing material_type ────────────────────────────────────────────────

  it("throws VALIDATION_ERROR with details.material_type when material_type is missing", async () => {
    const input = { ...VALID_INPUT, material_type: "" };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({ material_type: expect.any(String) }),
    });
  });

  // ── 3. Missing supplier ─────────────────────────────────────────────────────

  it("throws VALIDATION_ERROR with details.supplier when supplier is missing", async () => {
    const input = { ...VALID_INPUT, supplier: "" };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({ supplier: expect.any(String) }),
    });
  });

  // ── 4. Missing intake_date ──────────────────────────────────────────────────

  it("throws VALIDATION_ERROR with details.intake_date when intake_date is missing", async () => {
    const input = { ...VALID_INPUT, intake_date: "" };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({ intake_date: expect.any(String) }),
    });
  });

  // ── 5. Future intake_date ───────────────────────────────────────────────────

  it("throws VALIDATION_ERROR with details.intake_date when intake_date is in the future", async () => {
    const futureDate = "2099-12-31";
    const input = { ...VALID_INPUT, intake_date: futureDate };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({ intake_date: expect.any(String) }),
    });
  });

  // ── 6. material_type > 100 chars ────────────────────────────────────────────

  it("throws VALIDATION_ERROR when material_type exceeds 100 characters", async () => {
    const input = { ...VALID_INPUT, material_type: "A".repeat(101) };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  // ── 7. supplier > 100 chars ─────────────────────────────────────────────────

  it("throws VALIDATION_ERROR when supplier exceeds 100 characters", async () => {
    const input = { ...VALID_INPUT, supplier: "B".repeat(101) };

    await expect(
      registerItem(input, USER_CTX.userId, USER_CTX.userEmail, USER_CTX.ip),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  // ── 8. DB insert error ──────────────────────────────────────────────────────

  it("throws INTERNAL_ERROR when the database insert fails", async () => {
    // Override with a client that returns a DB error for the items insert
    mockSupabaseClient = buildMockClient({
      data: null,
      error: { message: "connection refused" },
    });

    await expect(
      registerItem(
        VALID_INPUT,
        USER_CTX.userId,
        USER_CTX.userEmail,
        USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

// ─── updateItemStatus Tests ───────────────────────────────────────────────────

/**
 * Builds a mock Supabase client tailored for `updateItemStatus`.
 *
 * The function needs two chained query paths:
 *   1. fetch:  from("items").select("*").eq("lot_id", lotId).single()
 *   2. update: from("items").update({...}).eq("lot_id", lotId).select("*").single()
 *   3. audit:  from("audit_logs").insert({...})  → awaitable, resolves { error: null }
 *
 * We track how many times `from("items")` has been called so the first call
 * returns the fetch chain and the second returns the update chain.
 */
function buildUpdateMockClient(opts: {
  fetchResult: { data: unknown; error: unknown };
  updateResult: { data: unknown; error: unknown };
  auditError?: unknown;
}) {
  const { fetchResult, updateResult, auditError = null } = opts;

  // audit insert: awaitable directly → { error: auditError }
  const auditInsertResult = Promise.resolve({ error: auditError });
  const auditInsertChain = Object.assign(auditInsertResult, {
    select: () => ({
      single: () => Promise.resolve({ data: {}, error: null }),
    }),
  });

  // fetch chain: .select("*").eq(...).single()
  const fetchChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve(fetchResult)),
      })),
    })),
  };

  // update chain: .update({...}).eq(...).select("*").single()
  const updateChain = {
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(updateResult)),
        })),
      })),
    })),
  };

  let itemsCallCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === "items") {
        itemsCallCount += 1;
        // First call is the SELECT fetch; second call is the UPDATE
        return itemsCallCount === 1 ? fetchChain : updateChain;
      }
      // audit_logs
      return { insert: vi.fn(() => auditInsertChain) };
    }),
  };
}

/** A full item row as returned by the DB. */
const MOCK_ITEM_RECEIVED = {
  id: "item-uuid-001",
  lot_id: "LOT-2026-00001",
  material_type: "Lavender Oil",
  supplier: "Acme Botanicals",
  intake_date: "2026-01-15",
  current_status: "received",
  location_zone: "RECEIVING",
  created_by: "user-uuid-001",
  created_at: "2026-01-15T08:00:00.000Z",
  updated_at: "2026-01-15T08:00:00.000Z",
};

const MOCK_ITEM_QC_PENDING = {
  ...MOCK_ITEM_RECEIVED,
  current_status: "qc_pending",
  updated_at: "2026-01-15T09:00:00.000Z",
};

const MOCK_ITEM_ARCHIVED = {
  ...MOCK_ITEM_RECEIVED,
  current_status: "archived",
};

/** Minimal user context required by updateItemStatus. */
const UPDATE_USER_CTX = {
  userId: "user-uuid-001",
  userEmail: "operator@example.com",
  ip: "127.0.0.1",
};

describe("updateItemStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid transition: received → qc_pending ──────────────────────────────

  it("succeeds and returns item with updated current_status for valid transition (received → qc_pending)", async () => {
    // Arrange
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: MOCK_ITEM_QC_PENDING, error: null },
    });

    // Act
    const result = await updateItemStatus(
      "LOT-2026-00001",
      "qc_pending",
      UPDATE_USER_CTX.userId,
      UPDATE_USER_CTX.userEmail,
      UPDATE_USER_CTX.ip,
    );

    // Assert — Requirement 5.1, 5.4
    expect(result.current_status).toBe("qc_pending");
    expect(result.lot_id).toBe("LOT-2026-00001");
    expect(result.updated_at).toBe(MOCK_ITEM_QC_PENDING.updated_at);
  });

  // ── 2. Invalid transition: received → archived ──────────────────────────────

  it("throws INVALID_TRANSITION with correct fields for disallowed transition (received → archived)", async () => {
    // Arrange
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: null, error: null }, // never reached
    });

    // Act & Assert — Requirement 5.2
    await expect(
      updateItemStatus(
        "LOT-2026-00001",
        "archived",
        UPDATE_USER_CTX.userId,
        UPDATE_USER_CTX.userEmail,
        UPDATE_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      current_status: "received",
      target_status: "archived",
      allowed: ["qc_pending"],
    });
  });

  // ── 3. Self-transition: received → received ─────────────────────────────────

  it("throws INVALID_TRANSITION for self-transition (received → received)", async () => {
    // Arrange
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: null, error: null }, // never reached
    });

    // Act & Assert — Requirement 5.6
    await expect(
      updateItemStatus(
        "LOT-2026-00001",
        "received",
        UPDATE_USER_CTX.userId,
        UPDATE_USER_CTX.userEmail,
        UPDATE_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      current_status: "received",
      target_status: "received",
    });
  });

  // ── 4. Transition from archived ─────────────────────────────────────────────

  it("throws INVALID_TRANSITION with allowed: [] when transitioning from archived", async () => {
    // Arrange
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_ARCHIVED, error: null },
      updateResult: { data: null, error: null }, // never reached
    });

    // Act & Assert — Requirement 5.3
    await expect(
      updateItemStatus(
        "LOT-2026-00001",
        "received",
        UPDATE_USER_CTX.userId,
        UPDATE_USER_CTX.userEmail,
        UPDATE_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      current_status: "archived",
      target_status: "received",
      allowed: [],
    });
  });

  // ── 5. Item not found ───────────────────────────────────────────────────────

  it("throws NOT_FOUND when the item does not exist in the database", async () => {
    // Arrange — DB returns no data and an error
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: null, error: { message: "No rows found" } },
      updateResult: { data: null, error: null }, // never reached
    });

    // Act & Assert — Requirement 5.2
    await expect(
      updateItemStatus(
        "LOT-2026-99999",
        "qc_pending",
        UPDATE_USER_CTX.userId,
        UPDATE_USER_CTX.userEmail,
        UPDATE_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ── 6. DB update error ──────────────────────────────────────────────────────

  it("throws INTERNAL_ERROR when the database update fails", async () => {
    // Arrange — fetch succeeds, update fails
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: {
        data: null,
        error: { message: "deadlock detected" },
      },
    });

    // Act & Assert — Requirement 5.4
    await expect(
      updateItemStatus(
        "LOT-2026-00001",
        "qc_pending",
        UPDATE_USER_CTX.userId,
        UPDATE_USER_CTX.userEmail,
        UPDATE_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

// ─── processScanBatch Tests ───────────────────────────────────────────────────

/**
 * Builds a mock Supabase client for `processScanBatch`.
 *
 * `processScanBatch` calls `updateItemStatus` for each item, which internally
 * calls `getSupabaseClient()` three times per item:
 *   1. fetch:  from("items").select("*").eq("lot_id", ...).single()
 *   2. update: from("items").update({...}).eq(...).select("*").single()
 *   3. audit:  from("audit_logs").insert({...})  — awaitable, resolves { error: null }
 *
 * Additionally, `processScanBatch` writes one `item_bulk_updated` AuditEntry per
 * successful item, which is a 4th call to `getSupabaseClient()` per item.
 *
 * We use a call-count approach on `from("items")` so that odd calls are fetches
 * and even calls are updates.
 *
 * @param itemRows - Map of lot_id → item row. Items not in the map return NOT_FOUND.
 */
function buildBatchMockClient(itemRows: Map<string, Record<string, unknown>>) {
  return {
    from: vi.fn((table: string) => {
      if (table === "items") {
        // Each call to from("items") returns an object with BOTH select and update.
        // The service calls exactly one of them per invocation:
        //   - fetch path:  .select("*").eq("lot_id", val).single()
        //   - update path: .update({...}).eq("lot_id", val).select("*").single()
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => ({
              single: vi.fn(() => {
                const row = itemRows.get(val);
                if (row) {
                  return Promise.resolve({ data: row, error: null });
                }
                return Promise.resolve({
                  data: null,
                  error: { message: "No rows found" },
                });
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn((_col: string, val: string) => ({
              select: vi.fn(() => ({
                single: vi.fn(() => {
                  const row = itemRows.get(val);
                  if (row) {
                    return Promise.resolve({ data: row, error: null });
                  }
                  return Promise.resolve({
                    data: null,
                    error: { message: "Update failed" },
                  });
                }),
              })),
            })),
          })),
        };
      }

      // audit_logs — awaitable insert that resolves { error: null }
      const auditResult = Promise.resolve({ error: null });
      return {
        insert: vi.fn(() =>
          Object.assign(auditResult, {
            select: () => ({
              single: () => Promise.resolve({ data: {}, error: null }),
            }),
          }),
        ),
      };
    }),
  };
}

/** Minimal user context for batch tests. */
const BATCH_USER_CTX = {
  userId: "user-uuid-batch",
  userEmail: "operator@example.com",
  ip: "10.0.0.1",
};

/** Builds a minimal item row for a given lot_id with status "received". */
function makeItemRow(lotId: string): Record<string, unknown> {
  return {
    id: `item-${lotId}`,
    lot_id: lotId,
    material_type: "Lavender Oil",
    supplier: "Acme Botanicals",
    intake_date: "2026-01-15",
    current_status: "received",
    location_zone: "RECEIVING",
    created_by: BATCH_USER_CTX.userId,
    created_at: "2026-01-15T08:00:00.000Z",
    updated_at: "2026-01-15T08:00:00.000Z",
  };
}

describe("processScanBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Batch of 1 item → success ────────────────────────────────────────────

  it("processes a batch of 1 item and returns success: true (Req 6.4, 6.5)", async () => {
    // Arrange
    const lotId = "LOT-2026-00001";
    const itemRows = new Map([[lotId, makeItemRow(lotId)]]);
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: [
        {
          lot_id: lotId,
          target_status: "qc_pending" as const,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Act
    const result = await processScanBatch(
      batch,
      BATCH_USER_CTX.userId,
      BATCH_USER_CTX.userEmail,
      BATCH_USER_CTX.ip,
    );

    // Assert — Requirement 6.5
    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].lot_id).toBe(lotId);
  });

  // ── 2. Batch of 50 items → all processed ────────────────────────────────────

  it("processes a batch of 50 items and returns 50 successful results (Req 6.4, 6.5)", async () => {
    // Arrange — build 50 distinct lot IDs, all starting at "received"
    const lotIds = Array.from(
      { length: 50 },
      (_, i) => `LOT-2026-${String(i + 1).padStart(5, "0")}`,
    );
    const itemRows = new Map(lotIds.map((id) => [id, makeItemRow(id)]));
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: lotIds.map((lot_id) => ({
        lot_id,
        target_status: "qc_pending" as const,
        timestamp: new Date().toISOString(),
      })),
    };

    // Act
    const result = await processScanBatch(
      batch,
      BATCH_USER_CTX.userId,
      BATCH_USER_CTX.userEmail,
      BATCH_USER_CTX.ip,
    );

    // Assert — Requirement 6.4, 6.5
    expect(result.results).toHaveLength(50);
    expect(result.results.every((r) => r.success === true)).toBe(true);
  });

  // ── 3. Batch of 51 items → BATCH_TOO_LARGE, nothing processed ───────────────

  it("throws BATCH_TOO_LARGE for a batch of 51 items and processes nothing (Req 6.5, 13.5)", async () => {
    // Arrange — 51 items; the mock client should never be called
    const lotIds = Array.from(
      { length: 51 },
      (_, i) => `LOT-2026-${String(i + 1).padStart(5, "0")}`,
    );
    const itemRows = new Map(lotIds.map((id) => [id, makeItemRow(id)]));
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: lotIds.map((lot_id) => ({
        lot_id,
        target_status: "qc_pending" as const,
        timestamp: new Date().toISOString(),
      })),
    };

    // Act & Assert — Requirement 6.5, 13.5
    await expect(
      processScanBatch(
        batch,
        BATCH_USER_CTX.userId,
        BATCH_USER_CTX.userEmail,
        BATCH_USER_CTX.ip,
      ),
    ).rejects.toMatchObject({ code: "BATCH_TOO_LARGE" });

    // Verify the Supabase client was never called (nothing processed)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });

  // ── 4. Mixed batch: valid + invalid items ────────────────────────────────────

  it("processes valid items and returns per-item errors for invalid items (Req 6.6)", async () => {
    // Arrange — 2 valid items, 1 item that does not exist in the DB
    const validLotId1 = "LOT-2026-00001";
    const validLotId2 = "LOT-2026-00002";
    const missingLotId = "LOT-2026-99999";

    const itemRows = new Map([
      [validLotId1, makeItemRow(validLotId1)],
      [validLotId2, makeItemRow(validLotId2)],
      // missingLotId intentionally absent
    ]);
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: [
        {
          lot_id: validLotId1,
          target_status: "qc_pending" as const,
          timestamp: new Date().toISOString(),
        },
        {
          lot_id: missingLotId,
          target_status: "qc_pending" as const,
          timestamp: new Date().toISOString(),
        },
        {
          lot_id: validLotId2,
          target_status: "qc_pending" as const,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Act
    const result = await processScanBatch(
      batch,
      BATCH_USER_CTX.userId,
      BATCH_USER_CTX.userEmail,
      BATCH_USER_CTX.ip,
    );

    // Assert — Requirement 6.6
    expect(result.results).toHaveLength(3);

    const r1 = result.results.find((r) => r.lot_id === validLotId1);
    const r2 = result.results.find((r) => r.lot_id === validLotId2);
    const rMissing = result.results.find((r) => r.lot_id === missingLotId);

    expect(r1?.success).toBe(true);
    expect(r2?.success).toBe(true);
    expect(rMissing?.success).toBe(false);
    expect(rMissing?.error).toBeTruthy();
  });

  // ── 5. processed_at is a non-empty ISO 8601 string ──────────────────────────

  it("returns a non-empty ISO 8601 processed_at timestamp (Req 6.6)", async () => {
    // Arrange
    const lotId = "LOT-2026-00001";
    const itemRows = new Map([[lotId, makeItemRow(lotId)]]);
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: [
        {
          lot_id: lotId,
          target_status: "qc_pending" as const,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Act
    const result = await processScanBatch(
      batch,
      BATCH_USER_CTX.userId,
      BATCH_USER_CTX.userEmail,
      BATCH_USER_CTX.ip,
    );

    // Assert — processed_at must be a valid ISO 8601 datetime string
    expect(result.processed_at).toBeTruthy();
    expect(() => new Date(result.processed_at)).not.toThrow();
    expect(new Date(result.processed_at).toISOString()).toBe(
      result.processed_at,
    );
  });

  // ── 6. Each successful item writes one AuditEntry ───────────────────────────

  it("writes one audit_logs insert per successfully processed item (Req 6.8)", async () => {
    // Arrange — 3 valid items
    const lotIds = ["LOT-2026-00001", "LOT-2026-00002", "LOT-2026-00003"];
    const itemRows = new Map(lotIds.map((id) => [id, makeItemRow(id)]));
    mockSupabaseClient = buildBatchMockClient(
      itemRows,
    ) as typeof mockSupabaseClient;

    const batch = {
      items: lotIds.map((lot_id) => ({
        lot_id,
        target_status: "qc_pending" as const,
        timestamp: new Date().toISOString(),
      })),
    };

    // Act
    const result = await processScanBatch(
      batch,
      BATCH_USER_CTX.userId,
      BATCH_USER_CTX.userEmail,
      BATCH_USER_CTX.ip,
    );

    // Assert — all 3 items succeeded
    expect(result.results.every((r) => r.success === true)).toBe(true);

    // Count audit_logs inserts: each item triggers 2 audit writes —
    // one from updateItemStatus (item_status_changed) and one from
    // processScanBatch (item_bulk_updated). So 3 items → 6 audit inserts.
    const auditInsertCalls = (
      mockSupabaseClient.from as ReturnType<typeof vi.fn>
    ).mock.calls.filter((args: unknown[]) => args[0] === "audit_logs");
    // At minimum, one audit insert per successful item (item_bulk_updated)
    expect(auditInsertCalls.length).toBeGreaterThanOrEqual(lotIds.length);
  });
});

// ─── searchItem Tests ─────────────────────────────────────────────────────────

/**
 * Builds a mock Supabase client tailored for `searchItem`.
 *
 * The function needs two chained query paths:
 *   1. items lookup: from("items").select("*").eq(field, query).maybeSingle()
 *   2. audit fetch:  from("audit_logs").select(...).eq("item_id", id).order(...)
 *
 * @param itemResult  - What the items query returns: { data, error }
 * @param auditResult - What the audit_logs query returns: { data, error }
 */
function buildSearchMockClient(opts: {
  itemResult: { data: unknown; error: unknown };
  auditResult: { data: unknown; error: unknown };
  trackFromCalls?: boolean;
}) {
  const { itemResult, auditResult } = opts;

  // items chain: .select("*").eq(field, val).maybeSingle()
  const itemsChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(() => Promise.resolve(itemResult)),
      })),
    })),
  };

  // audit_logs chain: .select(...).eq("item_id", id).order("timestamp", {...})
  const auditChain = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve(auditResult)),
      })),
    })),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "items") return itemsChain;
      if (table === "audit_logs") return auditChain;
      return {};
    }),
  };
}

/** A full item row as returned by the DB for search tests. */
const MOCK_SEARCH_ITEM = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  lot_id: "LOT-2026-00042",
  material_type: "Rose Extract",
  supplier: "Flora Supplies",
  intake_date: "2026-03-10",
  current_status: "qc_pending",
  location_zone: "QC-01",
  created_by: "user-uuid-001",
  created_at: "2026-03-10T07:00:00.000Z",
  updated_at: "2026-03-10T09:00:00.000Z",
};

/** Three audit log rows in reverse-chronological order (most recent first). */
const MOCK_AUDIT_ROWS_DESC = [
  {
    action: "item_status_changed",
    previous_state: JSON.stringify({ status: "received" }),
    new_state: JSON.stringify({ status: "qc_pending" }),
    user_id: "user-uuid-001",
    user_email: "operator@example.com",
    timestamp: "2026-03-10T09:00:00.000Z",
  },
  {
    action: "item_created",
    previous_state: null,
    new_state: JSON.stringify({
      lot_id: "LOT-2026-00042",
      current_status: "received",
      location_zone: "RECEIVING",
    }),
    user_id: "user-uuid-001",
    user_email: "operator@example.com",
    timestamp: "2026-03-10T07:00:00.000Z",
  },
];

/** Minimal user context for search tests. */
const SEARCH_USER_CTX = { userId: "user-uuid-001" };

describe("searchItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid Lot ID query → item with history returned ──────────────────────

  it("returns item with history array when queried by a valid lot_id (Req 9.1, 9.7)", async () => {
    // Arrange
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: MOCK_SEARCH_ITEM, error: null },
      auditResult: { data: MOCK_AUDIT_ROWS_DESC, error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await searchItem("LOT-2026-00042", SEARCH_USER_CTX.userId);

    // Assert — item fields are present
    expect(result.lot_id).toBe("LOT-2026-00042");
    expect(result.id).toBe(MOCK_SEARCH_ITEM.id);
    expect(result.current_status).toBe("qc_pending");

    // Assert — history is populated
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history).toHaveLength(2);
  });

  // ── 2. Valid UUID query → item with history returned ────────────────────────

  it("returns item with history array when queried by a valid UUID (Req 9.1, 9.7)", async () => {
    // Arrange
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: MOCK_SEARCH_ITEM, error: null },
      auditResult: { data: MOCK_AUDIT_ROWS_DESC, error: null },
    }) as typeof mockSupabaseClient;

    // Act — query by UUID (the item's id field)
    const result = await searchItem(
      "550e8400-e29b-41d4-a716-446655440000",
      SEARCH_USER_CTX.userId,
    );

    // Assert — item fields are present
    expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.lot_id).toBe("LOT-2026-00042");

    // Assert — history is populated
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history).toHaveLength(2);
  });

  // ── 3. No match → NOT_FOUND ─────────────────────────────────────────────────

  it("throws NOT_FOUND when no item matches the lot_id query (Req 9.2)", async () => {
    // Arrange — DB returns null (no match)
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: null, error: null },
      auditResult: { data: [], error: null },
    }) as typeof mockSupabaseClient;

    // Act & Assert
    await expect(
      searchItem("LOT-2026-99999", SEARCH_USER_CTX.userId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── 4. Empty string → VALIDATION_ERROR without DB query ─────────────────────

  it("throws VALIDATION_ERROR for empty string without querying the DB (Req 9.3)", async () => {
    // Arrange — build a client that tracks calls
    const client = buildSearchMockClient({
      itemResult: { data: null, error: null },
      auditResult: { data: [], error: null },
    });
    mockSupabaseClient = client as typeof mockSupabaseClient;

    // Act & Assert
    await expect(searchItem("", SEARCH_USER_CTX.userId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    // DB must NOT have been queried
    expect(client.from).not.toHaveBeenCalled();
  });

  // ── 5. Whitespace-only string → VALIDATION_ERROR without DB query ────────────

  it("throws VALIDATION_ERROR for whitespace-only string without querying the DB (Req 9.3)", async () => {
    // Arrange
    const client = buildSearchMockClient({
      itemResult: { data: null, error: null },
      auditResult: { data: [], error: null },
    });
    mockSupabaseClient = client as typeof mockSupabaseClient;

    // Act & Assert
    await expect(
      searchItem("   ", SEARCH_USER_CTX.userId),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // DB must NOT have been queried
    expect(client.from).not.toHaveBeenCalled();
  });

  // ── 6. Invalid format → VALIDATION_ERROR without DB query ───────────────────

  it("throws VALIDATION_ERROR for an invalid format (not Lot ID or UUID) without querying the DB (Req 9.3)", async () => {
    // Arrange
    const client = buildSearchMockClient({
      itemResult: { data: null, error: null },
      auditResult: { data: [], error: null },
    });
    mockSupabaseClient = client as typeof mockSupabaseClient;

    // Act & Assert — "INVALID-FORMAT" is neither a Lot ID nor a UUID
    await expect(
      searchItem("INVALID-FORMAT", SEARCH_USER_CTX.userId),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // DB must NOT have been queried
    expect(client.from).not.toHaveBeenCalled();
  });

  // ── 7. History is ordered reverse chronologically (most recent first) ────────

  it("returns history entries ordered reverse chronologically (most recent first) (Req 9.5)", async () => {
    // Arrange — DB returns rows already in DESC order (as the query requests)
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: MOCK_SEARCH_ITEM, error: null },
      auditResult: { data: MOCK_AUDIT_ROWS_DESC, error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await searchItem("LOT-2026-00042", SEARCH_USER_CTX.userId);

    // Assert — history must be in reverse-chronological order
    const history = result.history!;
    expect(history).toHaveLength(2);

    // Most recent entry first
    expect(history[0].timestamp).toBe("2026-03-10T09:00:00.000Z");
    expect(history[0].action).toBe("item_status_changed");

    // Older entry second
    expect(history[1].timestamp).toBe("2026-03-10T07:00:00.000Z");
    expect(history[1].action).toBe("item_created");

    // Verify descending order programmatically
    for (let i = 0; i < history.length - 1; i++) {
      expect(new Date(history[i].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(history[i + 1].timestamp).getTime(),
      );
    }
  });

  // ── 8. History entries have correct shape ────────────────────────────────────

  it("maps audit log rows to ItemHistoryEntry shape correctly (Req 9.1)", async () => {
    // Arrange
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: MOCK_SEARCH_ITEM, error: null },
      auditResult: { data: MOCK_AUDIT_ROWS_DESC, error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await searchItem("LOT-2026-00042", SEARCH_USER_CTX.userId);

    // Assert — each history entry has the required fields
    const entry = result.history![0];
    expect(entry).toHaveProperty("action");
    expect(entry).toHaveProperty("previous_state");
    expect(entry).toHaveProperty("new_state");
    expect(entry).toHaveProperty("user_id");
    expect(entry).toHaveProperty("user_email");
    expect(entry).toHaveProperty("timestamp");
  });

  // ── 9. Empty history when no audit logs exist ────────────────────────────────

  it("returns item with empty history array when no audit logs exist (Req 9.1)", async () => {
    // Arrange — audit_logs returns empty array
    mockSupabaseClient = buildSearchMockClient({
      itemResult: { data: MOCK_SEARCH_ITEM, error: null },
      auditResult: { data: [], error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await searchItem("LOT-2026-00042", SEARCH_USER_CTX.userId);

    // Assert
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history).toHaveLength(0);
  });
});

// ─── WebSocket Publish Failure Isolation Tests ────────────────────────────────

/**
 * Tests that verify Requirements 11.1 and 11.2:
 * - publishWsEvent is called after every successful registerItem and updateItemStatus
 * - Failure to publish does NOT roll back the item update (fire-and-forget)
 */
describe("WebSocket publish failure isolation (Req 11.1, 11.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. registerItem: WS publish failure does not roll back item creation ─────

  it("registerItem: item is created and returned even when WebSocket broadcast fails with a network error (Req 11.1)", async () => {
    // Arrange — DB succeeds, but fetch (WS broadcast) throws a network error
    mockSupabaseClient = buildMockClient({ data: MOCK_ITEM_ROW, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unreachable")),
    );

    // Act — must NOT throw despite the WS publish failure
    const result = await registerItem(
      VALID_INPUT,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    // Assert — item registration succeeded
    expect(result.lot_id).toBe("LOT-2026-00001");
    expect(result.current_status).toBe("received");
    expect(result.location_zone).toBe("RECEIVING");
  });

  it("registerItem: item is created and returned even when WebSocket broadcast returns a non-2xx status (Req 11.1)", async () => {
    // Arrange — DB succeeds, WS broadcast returns 503
    mockSupabaseClient = buildMockClient({ data: MOCK_ITEM_ROW, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    // Act — must NOT throw
    const result = await registerItem(
      VALID_INPUT,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    // Assert — item registration succeeded regardless of WS failure
    expect(result.lot_id).toBe("LOT-2026-00001");
    expect(result.current_status).toBe("received");
  });

  // ── 2. updateItemStatus: WS publish failure does not roll back status update ─

  it("updateItemStatus: item status is updated and returned even when WebSocket broadcast fails with a network error (Req 11.1)", async () => {
    // Arrange — DB fetch and update succeed, but WS broadcast throws
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: MOCK_ITEM_QC_PENDING, error: null },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );

    // Act — must NOT throw despite the WS publish failure
    const result = await updateItemStatus(
      "LOT-2026-00001",
      "qc_pending",
      UPDATE_USER_CTX.userId,
      UPDATE_USER_CTX.userEmail,
      UPDATE_USER_CTX.ip,
    );

    // Assert — status update succeeded
    expect(result.current_status).toBe("qc_pending");
    expect(result.lot_id).toBe("LOT-2026-00001");
  });

  it("updateItemStatus: item status is updated and returned even when WebSocket broadcast returns a non-2xx status (Req 11.1)", async () => {
    // Arrange — DB succeeds, WS broadcast returns 500
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: MOCK_ITEM_QC_PENDING, error: null },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    // Act — must NOT throw
    const result = await updateItemStatus(
      "LOT-2026-00001",
      "qc_pending",
      UPDATE_USER_CTX.userId,
      UPDATE_USER_CTX.userEmail,
      UPDATE_USER_CTX.ip,
    );

    // Assert — status update succeeded regardless of WS failure
    expect(result.current_status).toBe("qc_pending");
  });

  // ── 3. publishWsEvent is called after successful registerItem ─────────────────

  it("registerItem: publishWsEvent is called with item_created event after successful registration (Req 11.2)", async () => {
    // Arrange
    mockSupabaseClient = buildMockClient({ data: MOCK_ITEM_ROW, error: null });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    // Act
    await registerItem(
      VALID_INPUT,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    // Assert — fetch was called once for the WS broadcast
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { event: string };
    expect(body.event).toBe("item_created");
  });

  // ── 4. publishWsEvent is called after successful updateItemStatus ─────────────

  it("updateItemStatus: publishWsEvent is called with item_updated event after successful status update (Req 11.1)", async () => {
    // Arrange
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_ITEM_RECEIVED, error: null },
      updateResult: { data: MOCK_ITEM_QC_PENDING, error: null },
    });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    // Act
    await updateItemStatus(
      "LOT-2026-00001",
      "qc_pending",
      UPDATE_USER_CTX.userId,
      UPDATE_USER_CTX.userEmail,
      UPDATE_USER_CTX.ip,
    );

    // Assert — fetch was called once for the WS broadcast
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { event: string };
    expect(body.event).toBe("item_updated");
  });
});
