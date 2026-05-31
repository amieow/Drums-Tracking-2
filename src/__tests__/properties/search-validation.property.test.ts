/**
 * Property-Based Tests for Search Input Validation (Property 16)
 *
 * **Validates: Requirements 9.3**
 *
 * Property 16: Search Input Validation
 * For any search query that is an empty string, a whitespace-only string, or a
 * string that neither matches `^LOT-\d{4}-\d{5}$` nor is a non-empty
 * alphanumeric UUID, the Item_Service SHALL return a `VALIDATION_ERROR` without
 * executing a database query.
 */

import { searchItem } from "@/services/item-service";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Helper validators (mirrors validation.ts logic) ─────────────────────────

/** Returns true if `s` matches the Lot ID format: LOT-YYYY-NNNNN */
function isValidLotId(s: string): boolean {
  return /^LOT-\d{4}-\d{5}$/.test(s);
}

/**
 * Returns true if `s` matches the UUID format:
 * 8-4-4-4-12 lowercase hex digits
 */
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

// ─── Supabase mock setup ──────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

// Import after mock declaration so vi.mock hoisting works
import { getSupabaseClient } from "@/lib/supabase";

/**
 * Creates a Supabase mock that tracks whether `.from()` was called.
 * For validation-error paths, `.from()` should NEVER be called.
 */
function makeTrackingSupabaseMock() {
  const fromFn = vi.fn();
  return { from: fromFn };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 16: Search Input Validation", () => {
  const userId = "user-uuid-0001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Property 16a: Empty string returns VALIDATION_ERROR ─────────────────

  it("empty string: searchItem throws VALIDATION_ERROR and does not call DB", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(""), async (query) => {
        const mockClient = makeTrackingSupabaseMock();
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        let thrown: unknown;
        try {
          await searchItem(query, userId);
        } catch (err) {
          thrown = err;
        }

        // Must throw VALIDATION_ERROR
        expect(thrown).toBeDefined();
        const error = thrown as { code: string };
        expect(error.code).toBe("VALIDATION_ERROR");

        // Must NOT have called the DB
        expect(mockClient.from).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 16b: Whitespace-only strings return VALIDATION_ERROR ────────

  it("whitespace-only strings: searchItem throws VALIDATION_ERROR and does not call DB", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => s.trim() === "" && s.length > 0),
        async (query) => {
          const mockClient = makeTrackingSupabaseMock();
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await searchItem(query, userId);
          } catch (err) {
            thrown = err;
          }

          // Must throw VALIDATION_ERROR
          expect(thrown).toBeDefined();
          const error = thrown as { code: string };
          expect(error.code).toBe("VALIDATION_ERROR");

          // Must NOT have called the DB
          expect(mockClient.from).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 16c: Invalid format strings return VALIDATION_ERROR ─────────

  it("invalid format strings: searchItem throws VALIDATION_ERROR and does not call DB", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string()
          .filter(
            (s) => !isValidLotId(s) && !isValidUuid(s) && s.trim().length > 0,
          ),
        async (query) => {
          const mockClient = makeTrackingSupabaseMock();
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await searchItem(query, userId);
          } catch (err) {
            thrown = err;
          }

          // Must throw VALIDATION_ERROR
          expect(thrown).toBeDefined();
          const error = thrown as { code: string };
          expect(error.code).toBe("VALIDATION_ERROR");

          // Must NOT have called the DB
          expect(mockClient.from).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 16d: Combined — all invalid query types ────────────────────

  it("all invalid query types: searchItem always throws VALIDATION_ERROR and never calls DB", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(""),
          fc.string().filter((s) => s.trim() === "" && s.length > 0),
          fc
            .string()
            .filter(
              (s) => !isValidLotId(s) && !isValidUuid(s) && s.trim().length > 0,
            ),
        ),
        async (query) => {
          const mockClient = makeTrackingSupabaseMock();
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await searchItem(query, userId);
          } catch (err) {
            thrown = err;
          }

          // Must throw VALIDATION_ERROR
          expect(thrown).toBeDefined();
          const error = thrown as {
            code: string;
            message: string;
            details: Record<string, string>;
          };

          expect(error.code).toBe("VALIDATION_ERROR");
          // Must include a message
          expect(typeof error.message).toBe("string");
          expect(error.message.length).toBeGreaterThan(0);
          // Must include details with a query field
          expect(error.details).toBeDefined();
          expect(typeof error.details.query).toBe("string");

          // Must NOT have called the DB
          expect(mockClient.from).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });
});
