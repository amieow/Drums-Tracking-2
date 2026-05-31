/**
 * Property-Based Tests for Audit Log Date Range Query (Property 18)
 *
 * **Validates: Requirements 10.4**
 *
 * Property 18: Audit Log Query Returns Entries Within Date Range
 * For any audit log query with `date_from` and `date_to` filters, all returned
 * AuditEntry records SHALL have `timestamp` within the specified range
 * (inclusive), be ordered by `timestamp` descending, and be paginated at up to
 * 50 entries per page.
 */

import { queryAuditLogs } from "@/services/audit-service";
import type { AuditEntry, AuditLogQuery } from "@/types";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a random UUID-like string for test fixtures. */
function makeUuid(seed: number): string {
  return `00000000-0000-0000-0000-${String(seed).padStart(12, "0")}`;
}

/**
 * Generates N mock AuditEntry records with timestamps uniformly distributed
 * within [dateFrom, dateTo] (inclusive).
 */
function makeAuditEntries(
  n: number,
  dateFrom: Date,
  dateTo: Date,
): AuditEntry[] {
  const fromMs = dateFrom.getTime();
  const toMs = dateTo.getTime();
  const rangeMs = toMs - fromMs;

  return Array.from({ length: n }, (_, i) => {
    // Spread timestamps evenly across the range
    const offsetMs =
      rangeMs === 0 ? 0 : Math.floor((i / Math.max(n - 1, 1)) * rangeMs);
    const ts = new Date(fromMs + offsetMs).toISOString();

    return {
      id: makeUuid(i + 1),
      item_id: i % 3 === 0 ? null : makeUuid(1000 + i),
      action: "item_status_changed" as const,
      previous_state: JSON.stringify({ status: "received" }),
      new_state: JSON.stringify({ status: "qc_pending" }),
      user_id: makeUuid(9999),
      user_email: "operator@example.com",
      ip_address: "127.0.0.1",
      timestamp: ts,
    };
  });
}

/**
 * Sorts AuditEntry records by timestamp DESC (most recent first).
 * This mirrors what the real Supabase query does with `.order("timestamp", { ascending: false })`.
 */
function sortByTimestampDesc(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ─── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock that:
 * - Returns `entries` for the data query
 * - Returns `entries.length` for the count query
 *
 * The mock supports the full Supabase query builder chain used by
 * `queryAuditLogs`:
 *   .from("audit_logs")
 *     .select("id", { count: "exact", head: true })  → count query
 *     .select("*").order(...).range(...)              → data query
 *   Both chains support optional .gte(), .lte(), .eq() filter calls.
 */
function makeSupabaseMock(entries: AuditEntry[]) {
  const sortedEntries = sortByTimestampDesc(entries);
  const total = entries.length;

  // ── Count query chain ──────────────────────────────────────────────────────
  // .select("id", { count: "exact", head: true }).gte().lte().eq()
  // The chain terminates when awaited (no .single() needed).
  const countChainBase = {
    gte: vi.fn(),
    lte: vi.fn(),
    eq: vi.fn(),
  };
  // Make each filter method return the same chainable object
  countChainBase.gte.mockReturnValue(countChainBase);
  countChainBase.lte.mockReturnValue(countChainBase);
  countChainBase.eq.mockReturnValue(countChainBase);
  // When awaited, resolve with count
  const countPromise = Promise.resolve({ count: total, error: null });
  Object.assign(countChainBase, {
    then: countPromise.then.bind(countPromise),
    catch: countPromise.catch.bind(countPromise),
    finally: countPromise.finally.bind(countPromise),
  });

  // ── Data query chain ───────────────────────────────────────────────────────
  // .select("*").order(...).range(...).gte().lte().eq()
  const dataChainBase = {
    gte: vi.fn(),
    lte: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  dataChainBase.gte.mockReturnValue(dataChainBase);
  dataChainBase.lte.mockReturnValue(dataChainBase);
  dataChainBase.eq.mockReturnValue(dataChainBase);
  dataChainBase.order.mockReturnValue(dataChainBase);
  dataChainBase.range.mockImplementation((from: number, to: number) => {
    // Slice the sorted entries to simulate pagination
    const sliced = sortedEntries.slice(from, to + 1);
    const dataPromise = Promise.resolve({ data: sliced, error: null });
    const rangeChain = {
      gte: vi.fn(),
      lte: vi.fn(),
      eq: vi.fn(),
      then: dataPromise.then.bind(dataPromise),
      catch: dataPromise.catch.bind(dataPromise),
      finally: dataPromise.finally.bind(dataPromise),
    };
    rangeChain.gte.mockReturnValue(rangeChain);
    rangeChain.lte.mockReturnValue(rangeChain);
    rangeChain.eq.mockReturnValue(rangeChain);
    return rangeChain;
  });

  // ── .from() dispatcher ─────────────────────────────────────────────────────
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "audit_logs") {
      return {
        select: vi.fn().mockImplementation((fields: string, opts?: unknown) => {
          // Count query: select("id", { count: "exact", head: true })
          if (
            opts &&
            typeof opts === "object" &&
            (opts as Record<string, unknown>).count === "exact"
          ) {
            return countChainBase;
          }
          // Data query: select("*")
          return dataChainBase;
        }),
      };
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

describe("Property 18: Audit Log Query Returns Entries Within Date Range", () => {
  const userId = "admin-uuid-0001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Property 18a: All returned entries have timestamp within range ──────────

  it("all returned entries have timestamp >= date_from and <= date_to", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a date range within 2020–2024
        fc.tuple(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        ),
        // Generate N entries (1–50)
        fc.integer({ min: 1, max: 50 }),
        async ([dateA, dateB], n) => {
          // Normalize so date_from <= date_to
          const dateFrom = dateA <= dateB ? dateA : dateB;
          const dateTo = dateA <= dateB ? dateB : dateA;

          const date_from = dateFrom.toISOString();
          const date_to = dateTo.toISOString();

          const entries = makeAuditEntries(n, dateFrom, dateTo);
          const mockClient = makeSupabaseMock(entries);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const query: AuditLogQuery = { date_from, date_to };
          const result = await queryAuditLogs(query, userId);

          // All returned entries must have timestamp within [date_from, date_to]
          for (const entry of result.entries) {
            expect(entry.timestamp >= date_from).toBe(true);
            expect(entry.timestamp <= date_to).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 18b: Entries are ordered by timestamp DESC ────────────────────

  it("returned entries are ordered by timestamp DESC (most recent first)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        ),
        fc.integer({ min: 2, max: 50 }),
        async ([dateA, dateB], n) => {
          const dateFrom = dateA <= dateB ? dateA : dateB;
          const dateTo = dateA <= dateB ? dateB : dateA;

          const date_from = dateFrom.toISOString();
          const date_to = dateTo.toISOString();

          const entries = makeAuditEntries(n, dateFrom, dateTo);
          const mockClient = makeSupabaseMock(entries);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const query: AuditLogQuery = { date_from, date_to };
          const result = await queryAuditLogs(query, userId);

          // Verify descending order: each entry's timestamp must be >= the next
          for (let i = 0; i < result.entries.length - 1; i++) {
            expect(
              result.entries[i].timestamp >= result.entries[i + 1].timestamp,
            ).toBe(true);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 18c: Pagination limit is always <= 50 ─────────────────────────

  it("pagination.limit is always <= 50", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        ),
        fc.integer({ min: 1, max: 50 }),
        // Optionally supply a custom limit (1–50) or leave undefined
        fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
        async ([dateA, dateB], n, customLimit) => {
          const dateFrom = dateA <= dateB ? dateA : dateB;
          const dateTo = dateA <= dateB ? dateB : dateA;

          const date_from = dateFrom.toISOString();
          const date_to = dateTo.toISOString();

          const entries = makeAuditEntries(n, dateFrom, dateTo);
          const mockClient = makeSupabaseMock(entries);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const query: AuditLogQuery = {
            date_from,
            date_to,
            ...(customLimit !== undefined ? { limit: customLimit } : {}),
          };
          const result = await queryAuditLogs(query, userId);

          // Pagination limit must never exceed 50
          expect(result.pagination.limit).toBeLessThanOrEqual(50);
          expect(result.pagination.limit).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 18d: Pagination metadata is consistent ────────────────────────

  it("pagination metadata is consistent: page >= 1, total >= 0, pages = ceil(total/limit)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        ),
        fc.integer({ min: 1, max: 50 }),
        async ([dateA, dateB], n) => {
          const dateFrom = dateA <= dateB ? dateA : dateB;
          const dateTo = dateA <= dateB ? dateB : dateA;

          const date_from = dateFrom.toISOString();
          const date_to = dateTo.toISOString();

          const entries = makeAuditEntries(n, dateFrom, dateTo);
          const mockClient = makeSupabaseMock(entries);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const query: AuditLogQuery = { date_from, date_to };
          const result = await queryAuditLogs(query, userId);

          const { page, limit, total, pages } = result.pagination;

          expect(page).toBeGreaterThanOrEqual(1);
          expect(limit).toBeLessThanOrEqual(50);
          expect(total).toBeGreaterThanOrEqual(0);
          // pages = ceil(total / limit)
          expect(pages).toBe(Math.ceil(total / limit));
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 18e: Returned entry count does not exceed limit ───────────────

  it("number of returned entries does not exceed pagination.limit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
          fc.date({ min: new Date("2020-01-01"), max: new Date("2024-12-31") }),
        ),
        fc.integer({ min: 1, max: 50 }),
        async ([dateA, dateB], n) => {
          const dateFrom = dateA <= dateB ? dateA : dateB;
          const dateTo = dateA <= dateB ? dateB : dateA;

          const date_from = dateFrom.toISOString();
          const date_to = dateTo.toISOString();

          const entries = makeAuditEntries(n, dateFrom, dateTo);
          const mockClient = makeSupabaseMock(entries);
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const query: AuditLogQuery = { date_from, date_to };
          const result = await queryAuditLogs(query, userId);

          // The number of returned entries must not exceed the page limit
          expect(result.entries.length).toBeLessThanOrEqual(
            result.pagination.limit,
          );
        },
      ),
      { numRuns: 20 },
    );
  });
});
