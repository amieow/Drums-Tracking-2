/**
 * Property-Based Test: Registration Input Validation Rejects Invalid Inputs (Property 6)
 *
 * **Validates: Requirements 3.4, 3.5, 13.1, 13.2**
 *
 * Property 6: For any registration request with a missing or empty
 * `material_type`, `supplier`, or `intake_date`, or with `intake_date` set to
 * a future date, or with `material_type`/`supplier` exceeding 100 characters,
 * the Item_Service SHALL return a `VALIDATION_ERROR` identifying the failing
 * field(s) and SHALL NOT create an item record or emit any events.
 */

import * as fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerItem } from "../../services/item-service";

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => {
  return {
    getSupabaseClient: vi.fn(() => ({
      from: mockFrom,
    })),
  };
});

// ─── Mock @/lib/lot-id-generator ──────────────────────────────────────────────

vi.mock("@/lib/lot-id-generator", () => ({
  generateLotId: vi.fn().mockResolvedValue("LOT-2026-00001"),
}));

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Wire up the Supabase mock chain: from().insert().select().single()
  mockSingle.mockResolvedValue({
    data: null,
    error: { message: "not called" },
  });
  mockSelect.mockReturnValue({ single: mockSingle });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockFrom.mockReturnValue({ insert: mockInsert });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a date string N days from today in YYYY-MM-DD format. */
function futureDateString(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().split("T")[0];
}

/** Checks that the thrown error has code "VALIDATION_ERROR". */
function isValidationError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as Record<string, unknown>).code === "VALIDATION_ERROR"
  );
}

// ─── Arbitraries for invalid inputs ──────────────────────────────────────────

/**
 * Generates a string longer than 100 characters.
 * Uses printable ASCII to avoid encoding edge cases.
 */
const longStringArb = fc.string({ minLength: 101, maxLength: 200 });

/**
 * Generates a future date string (at least 1 day ahead).
 * Maps a Date object to YYYY-MM-DD.
 */
const futureDateArb = fc
  .integer({ min: 1, max: 3650 }) // 1 day to 10 years ahead
  .map((days) => futureDateString(days));

/**
 * Generates an invalid registration input using fc.oneof:
 *
 * 1. Empty material_type
 * 2. Empty supplier
 * 3. material_type > 100 chars
 * 4. supplier > 100 chars
 * 5. Future intake_date
 */
const invalidInputArb = fc.oneof(
  // Case 1: Empty material_type
  fc.constant({
    material_type: "",
    supplier: "ValidSupplier",
    intake_date: "2024-01-01",
  }),
  // Case 2: Empty supplier
  fc.constant({
    material_type: "ValidMaterial",
    supplier: "",
    intake_date: "2024-01-01",
  }),
  // Case 3: material_type > 100 chars
  longStringArb.map((longStr) => ({
    material_type: longStr,
    supplier: "ValidSupplier",
    intake_date: "2024-01-01",
  })),
  // Case 4: supplier > 100 chars
  longStringArb.map((longStr) => ({
    material_type: "ValidMaterial",
    supplier: longStr,
    intake_date: "2024-01-01",
  })),
  // Case 5: Future intake_date
  futureDateArb.map((futureDate) => ({
    material_type: "ValidMaterial",
    supplier: "ValidSupplier",
    intake_date: futureDate,
  })),
);

// ─── Property 6: Registration Input Validation Rejects Invalid Inputs ─────────

describe("Property 6: Registration Input Validation Rejects Invalid Inputs (Req 3.4, 3.5, 13.1, 13.2)", () => {
  it("for any invalid input, registerItem throws VALIDATION_ERROR and does NOT call supabase insert", async () => {
    await fc.assert(
      fc.asyncProperty(invalidInputArb, async (invalidInput) => {
        // Reset insert spy before each run
        mockInsert.mockClear();

        let threw = false;
        let thrownError: unknown = null;

        try {
          await registerItem(
            invalidInput,
            "user-uuid-123",
            "user@example.com",
            "127.0.0.1",
          );
        } catch (err) {
          threw = true;
          thrownError = err;
        }

        // Assert: registerItem MUST throw for invalid input
        expect(threw).toBe(true);

        // Assert: the thrown error MUST have code "VALIDATION_ERROR"
        expect(isValidationError(thrownError)).toBe(true);

        // Assert: Supabase insert MUST NOT have been called (no item created)
        expect(mockInsert).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it("empty material_type always produces VALIDATION_ERROR without DB insert", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Vary the supplier and intake_date while keeping material_type empty
        fc.record({
          supplier: fc.string({ minLength: 1, maxLength: 100 }),
          intake_date: fc.constant("2024-06-15"),
        }),
        async ({ supplier, intake_date }) => {
          mockInsert.mockClear();

          let thrownError: unknown = null;
          try {
            await registerItem(
              { material_type: "", supplier, intake_date },
              "user-uuid-123",
              "user@example.com",
              "127.0.0.1",
            );
          } catch (err) {
            thrownError = err;
          }

          expect(isValidationError(thrownError)).toBe(true);
          expect(mockInsert).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  it("empty supplier always produces VALIDATION_ERROR without DB insert", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          material_type: fc.string({ minLength: 1, maxLength: 100 }),
          intake_date: fc.constant("2024-06-15"),
        }),
        async ({ material_type, intake_date }) => {
          mockInsert.mockClear();

          let thrownError: unknown = null;
          try {
            await registerItem(
              { material_type, supplier: "", intake_date },
              "user-uuid-123",
              "user@example.com",
              "127.0.0.1",
            );
          } catch (err) {
            thrownError = err;
          }

          expect(isValidationError(thrownError)).toBe(true);
          expect(mockInsert).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  it("material_type > 100 chars always produces VALIDATION_ERROR without DB insert", async () => {
    await fc.assert(
      fc.asyncProperty(longStringArb, async (longMaterialType) => {
        mockInsert.mockClear();

        let thrownError: unknown = null;
        try {
          await registerItem(
            {
              material_type: longMaterialType,
              supplier: "ValidSupplier",
              intake_date: "2024-06-15",
            },
            "user-uuid-123",
            "user@example.com",
            "127.0.0.1",
          );
        } catch (err) {
          thrownError = err;
        }

        expect(isValidationError(thrownError)).toBe(true);
        expect(mockInsert).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it("supplier > 100 chars always produces VALIDATION_ERROR without DB insert", async () => {
    await fc.assert(
      fc.asyncProperty(longStringArb, async (longSupplier) => {
        mockInsert.mockClear();

        let thrownError: unknown = null;
        try {
          await registerItem(
            {
              material_type: "ValidMaterial",
              supplier: longSupplier,
              intake_date: "2024-06-15",
            },
            "user-uuid-123",
            "user@example.com",
            "127.0.0.1",
          );
        } catch (err) {
          thrownError = err;
        }

        expect(isValidationError(thrownError)).toBe(true);
        expect(mockInsert).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  it("future intake_date always produces VALIDATION_ERROR without DB insert", async () => {
    await fc.assert(
      fc.asyncProperty(futureDateArb, async (futureDate) => {
        mockInsert.mockClear();

        let thrownError: unknown = null;
        try {
          await registerItem(
            {
              material_type: "ValidMaterial",
              supplier: "ValidSupplier",
              intake_date: futureDate,
            },
            "user-uuid-123",
            "user@example.com",
            "127.0.0.1",
          );
        } catch (err) {
          thrownError = err;
        }

        expect(isValidationError(thrownError)).toBe(true);
        expect(mockInsert).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });
});
