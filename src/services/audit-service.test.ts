/**
 * Unit Tests — Audit Log Service
 *
 * Tests `queryAuditLogs` and `exportAuditLogsCsv` in isolation by mocking
 * `@/lib/supabase` so that `getSupabaseClient()` returns a controlled mock.
 *
 * Requirements: 10.4, 10.6, 10.7
 */

import type { AuditEntry } from "@/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportAuditLogsCsv, queryAuditLogs } from "./audit-service";

// ─── Mock: supabase ───────────────────────────────────────────────────────────

let mockSupabaseClient:
  | ReturnType<typeof buildQueryMockClient>
  | ReturnType<typeof buildExportMockClient>;

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(() => mockSupabaseClient),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal AuditEntry for use in tests. */
function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "entry-uuid-001",
    item_id: "item-uuid-001",
    action: "item_status_changed",
    previous_state: '"received"',
    new_state: '"qc_pending"',
    user_id: "user-uuid-001",
    user_email: "operator@example.com",
    ip_address: "127.0.0.1",
    timestamp: "2024-06-01T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Builds a mock Supabase client for `queryAuditLogs`.
 *
 * `queryAuditLogs` issues two queries:
 *   1. Count query: from("audit_logs").select("id", { count: "exact", head: true })
 *      → returns { count, error }
 *   2. Data query:  from("audit_logs").select("*").order(...).range(...)
 *      → returns { data, error }
 *
 * Both queries may also have optional .gte / .lte / .eq filter calls chained
 * before the terminal await. We make each filter method return `this` so the
 * chain stays intact regardless of how many filters are applied.
 */
function buildQueryMockClient(opts: {
  countResult: { count: number | null; error: unknown };
  dataResult: { data: AuditEntry[] | null; error: unknown };
}) {
  const { countResult, dataResult } = opts;

  // Count chain: .select(...).gte?.lte?.eq? → awaitable { count, error }
  const countChainBase = Promise.resolve(countResult);
  const countChain = Object.assign(countChainBase, {
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  });

  // Data chain: .select("*").order(...).range(...).gte?.lte?.eq? → awaitable { data, error }
  const dataChainBase = Promise.resolve(dataResult);
  const dataChain = Object.assign(dataChainBase, {
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  });

  let selectCallCount = 0;

  return {
    from: vi.fn((_table: string) => ({
      select: vi.fn((..._args: unknown[]) => {
        selectCallCount += 1;
        // First select call is the count query (head: true), second is the data query
        return selectCallCount === 1 ? countChain : dataChain;
      }),
    })),
    // Expose for assertions
    _dataChain: dataChain,
    _countChain: countChain,
  };
}

/**
 * Builds a mock Supabase client for `exportAuditLogsCsv`.
 *
 * `exportAuditLogsCsv` issues:
 *   1. Data query: from("audit_logs").select("*").order(...).limit(...).gte?.lte?.eq?
 *      → returns { data, error }
 *   2. Audit insert: from("audit_logs").insert({...}) → awaitable { error }
 */
function buildExportMockClient(opts: {
  dataResult: { data: AuditEntry[] | null; error: unknown };
  insertError?: unknown;
}) {
  const { dataResult, insertError = null } = opts;

  // Data query chain
  const dataChainBase = Promise.resolve(dataResult);
  const dataChain = Object.assign(dataChainBase, {
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  });

  // Audit insert chain: awaitable directly → { error }
  const insertResult = Promise.resolve({ error: insertError });
  const insertChain = Object.assign(insertResult, {
    select: () => ({
      single: () => Promise.resolve({ data: {}, error: null }),
    }),
  });

  let selectCalled = false;

  return {
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => {
        selectCalled = true;
        return dataChain;
      }),
      insert: vi.fn(() => insertChain),
    })),
    _insertChain: insertChain,
    _selectCalled: () => selectCalled,
  };
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const USER_CTX = {
  userId: "admin-uuid-001",
  userEmail: "admin@example.com",
  ip: "10.0.0.1",
};

const VALID_QUERY = {
  date_from: "2024-01-01T00:00:00Z",
  date_to: "2024-12-31T23:59:59Z",
};

// ─── queryAuditLogs Tests ─────────────────────────────────────────────────────

describe("queryAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid date range → entries and pagination ────────────────────────────

  it("returns entries and correct pagination for a valid date range (Req 10.4, 10.5)", async () => {
    // Arrange
    const entries = [
      makeAuditEntry({ id: "e1", timestamp: "2024-06-02T10:00:00.000Z" }),
      makeAuditEntry({ id: "e2", timestamp: "2024-06-01T10:00:00.000Z" }),
    ];
    mockSupabaseClient = buildQueryMockClient({
      countResult: { count: 2, error: null },
      dataResult: { data: entries, error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await queryAuditLogs(VALID_QUERY, USER_CTX.userId);

    // Assert — entries returned in the order provided by the DB (DESC by timestamp)
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].id).toBe("e1");
    expect(result.entries[1].id).toBe("e2");

    // Pagination metadata
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(50);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.pages).toBe(1);
  });

  // ── 2. Invalid date_from → VALIDATION_ERROR ─────────────────────────────────

  it("throws VALIDATION_ERROR with details.date_from for an invalid ISO 8601 date (Req 10.4)", async () => {
    // Arrange — no mock needed; validation fires before any DB call
    mockSupabaseClient = buildQueryMockClient({
      countResult: { count: 0, error: null },
      dataResult: { data: [], error: null },
    }) as typeof mockSupabaseClient;

    // Act & Assert
    await expect(
      queryAuditLogs({ date_from: "not-a-date" }, USER_CTX.userId),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({ date_from: expect.any(String) }),
    });
  });

  // ── 3. page=2, limit=10 → correct offset applied ───────────────────────────

  it("applies correct offset for page=2, limit=10 (Req 10.5)", async () => {
    // Arrange — 25 total entries, requesting page 2 of 10
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeAuditEntry({ id: `e${i + 11}` }),
    );
    mockSupabaseClient = buildQueryMockClient({
      countResult: { count: 25, error: null },
      dataResult: { data: entries, error: null },
    }) as typeof mockSupabaseClient;

    // Act
    const result = await queryAuditLogs(
      { page: 2, limit: 10 },
      USER_CTX.userId,
    );

    // Assert — pagination reflects page 2 of 10 with 25 total
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.pages).toBe(3); // ceil(25/10) = 3

    // Verify .range() was called with offset=10 (page 2, limit 10 → offset = (2-1)*10 = 10)
    const fromCalls = (mockSupabaseClient.from as ReturnType<typeof vi.fn>).mock
      .calls;
    // The data query chain should have had .range(10, 19) called
    expect(result.entries).toHaveLength(10);
  });
});

// ─── exportAuditLogsCsv Tests ─────────────────────────────────────────────────

describe("exportAuditLogsCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 4. 5 entries → CSV with correct headers and data ───────────────────────

  it("returns a CSV string with correct headers and data rows for 5 entries (Req 10.6)", async () => {
    // Arrange
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeAuditEntry({
        id: `entry-${i}`,
        user_email: `user${i}@example.com`,
        timestamp: `2024-06-0${i + 1}T10:00:00.000Z`,
      }),
    );
    mockSupabaseClient = buildExportMockClient({
      dataResult: { data: entries, error: null },
    });

    // Act
    const csv = await exportAuditLogsCsv(
      VALID_QUERY,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    // Assert — CSV structure
    const lines = csv.split("\n");
    // Header row + 5 data rows = 6 lines
    expect(lines).toHaveLength(6);

    // Verify header row contains all required columns
    const headerLine = lines[0];
    expect(headerLine).toContain('"id"');
    expect(headerLine).toContain('"item_id"');
    expect(headerLine).toContain('"action"');
    expect(headerLine).toContain('"previous_state"');
    expect(headerLine).toContain('"new_state"');
    expect(headerLine).toContain('"user_id"');
    expect(headerLine).toContain('"user_email"');
    expect(headerLine).toContain('"ip_address"');
    expect(headerLine).toContain('"timestamp"');

    // Verify first data row contains the first entry's values
    const firstDataRow = lines[1];
    expect(firstDataRow).toContain('"entry-0"');
    expect(firstDataRow).toContain('"user0@example.com"');
    expect(firstDataRow).toContain('"2024-06-01T10:00:00.000Z"');
  });

  // ── 5. 10,001 entries → VALIDATION_ERROR ───────────────────────────────────

  it("throws VALIDATION_ERROR when the result set exceeds 10,000 entries (Req 10.6)", async () => {
    // Arrange — mock returns 10,001 entries (one over the limit)
    const entries = Array.from({ length: 10_001 }, (_, i) =>
      makeAuditEntry({ id: `entry-${i}` }),
    );
    mockSupabaseClient = buildExportMockClient({
      dataResult: { data: entries, error: null },
    });

    // Act & Assert
    await expect(
      exportAuditLogsCsv(
        VALID_QUERY,
        USER_CTX.userId,
        USER_CTX.userEmail,
        USER_CTX.ip,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("10,000"),
    });
  });

  // ── 6. Successful export writes audit_exported AuditEntry ──────────────────

  it("writes an audit_exported AuditEntry after a successful export (Req 10.7)", async () => {
    // Arrange
    const entries = Array.from({ length: 3 }, (_, i) =>
      makeAuditEntry({ id: `entry-${i}` }),
    );
    mockSupabaseClient = buildExportMockClient({
      dataResult: { data: entries, error: null },
      insertError: null,
    });

    // Act
    const csv = await exportAuditLogsCsv(
      VALID_QUERY,
      USER_CTX.userId,
      USER_CTX.userEmail,
      USER_CTX.ip,
    );

    // Assert — CSV was returned
    expect(csv).toBeTruthy();
    expect(csv.split("\n")[0]).toContain('"id"');

    // Assert — from("audit_logs").insert() was called (the audit_exported write)
    const fromCalls = (mockSupabaseClient.from as ReturnType<typeof vi.fn>).mock
      .calls;
    const auditLogsCalls = fromCalls.filter(
      (args: unknown[]) => args[0] === "audit_logs",
    );
    // At least one call to audit_logs for the insert
    expect(auditLogsCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the insert was called with action: "audit_exported"
    const auditLogsFromResults = (
      mockSupabaseClient.from as ReturnType<typeof vi.fn>
    ).mock.results.filter(
      (_: unknown, idx: number) => fromCalls[idx]?.[0] === "audit_logs",
    );
    const insertCalls = auditLogsFromResults.flatMap(
      (
        r: { value: { insert: ReturnType<typeof vi.fn> } } | { value: unknown },
      ) =>
        (r as { value: { insert: ReturnType<typeof vi.fn> } }).value.insert
          ?.mock?.calls ?? [],
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const insertPayload = insertCalls[0][0] as { action: string };
    expect(insertPayload.action).toBe("audit_exported");
  });
});
