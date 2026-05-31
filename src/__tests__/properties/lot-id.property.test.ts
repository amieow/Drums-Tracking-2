/**
 * Property-Based Tests: Lot ID Format and Uniqueness Invariant (Property 5)
 *
 * **Validates: Requirements 3.2, 3.3, 4.1, 4.3**
 *
 * Property 5: For any set of N registration requests processed (concurrently
 * or sequentially), all generated `Lot_ID` values SHALL match the regular
 * expression `^LOT-\d{4}-\d{5}$` where the four-digit year equals the
 * `intake_date` year, the five-digit counter is in range 00001–99999, and all
 * N values are distinct with no collisions.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateLotId } from "../../lib/lot-id-generator";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Regex that every valid Lot ID must match (Requirement 3.2). */
const LOT_ID_REGEX = /^LOT-\d{4}-\d{5}$/;

/**
 * Build a mock Supabase client whose `rpc` method returns a sequentially
 * incrementing counter, simulating the `increment_lot_sequence` DB function.
 *
 * Each call to `rpc` increments the internal counter by 1 and returns
 * `{ data: counter, error: null }`.
 */
function buildMockSupabaseClient(startAt = 0) {
  let counter = startAt;
  return {
    rpc: (_fn: string, _args: unknown) => {
      counter += 1;
      return Promise.resolve({ data: counter, error: null });
    },
    /** Expose current counter value for assertions. */
    get currentCounter() {
      return counter;
    },
  };
}

// ─── Arbitrary: valid intake_date strings (2000-01-01 … 2099-12-31) ──────────

const validIntakeDateArb = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2099-12-31") })
  .map((d) => d.toISOString().split("T")[0]);

// ─── Property 5: Lot ID Format and Uniqueness Invariant ───────────────────────

describe("Property 5: Lot ID Format and Uniqueness Invariant (Req 3.2, 3.3, 4.1, 4.3)", () => {
  // ── Sub-property A: Format invariant ────────────────────────────────────────
  it("for any valid intake_date (2000–2099), the generated lot_id matches ^LOT-\\d{4}-\\d{5}$", async () => {
    await fc.assert(
      fc.asyncProperty(validIntakeDateArb, async (intakeDate) => {
        const client = buildMockSupabaseClient(0);
        const lotId = await generateLotId(intakeDate, client);

        // Assert: format matches the canonical regex (Req 3.2)
        expect(lotId).toMatch(LOT_ID_REGEX);
      }),
      { numRuns: 20 },
    );
  });

  // ── Sub-property B: Year segment ────────────────────────────────────────────
  it("the 4-digit year segment in the lot_id equals the year from intake_date", async () => {
    await fc.assert(
      fc.asyncProperty(validIntakeDateArb, async (intakeDate) => {
        const client = buildMockSupabaseClient(0);
        const lotId = await generateLotId(intakeDate, client);

        // Extract year from intake_date and from the generated lot_id
        const expectedYear = intakeDate.substring(0, 4);
        const parts = lotId.split("-"); // ["LOT", "YYYY", "NNNNN"]
        const yearSegment = parts[1];

        // Assert: year segment matches intake_date year (Req 3.3, 4.1)
        expect(yearSegment).toBe(expectedYear);
      }),
      { numRuns: 20 },
    );
  });

  // ── Sub-property C: Counter range ───────────────────────────────────────────
  it("the 5-digit counter segment is in range 00001–99999", async () => {
    await fc.assert(
      fc.asyncProperty(
        validIntakeDateArb,
        // Generate a starting counter in 0–99998 so the incremented value stays ≤ 99999
        fc.integer({ min: 0, max: 99998 }),
        async (intakeDate, startAt) => {
          const client = buildMockSupabaseClient(startAt);
          const lotId = await generateLotId(intakeDate, client);

          const parts = lotId.split("-"); // ["LOT", "YYYY", "NNNNN"]
          const counterStr = parts[2];
          const counterNum = parseInt(counterStr, 10);

          // Assert: counter is zero-padded to exactly 5 digits (Req 3.2)
          expect(counterStr).toHaveLength(5);

          // Assert: counter is in the valid range 00001–99999 (Req 4.3)
          expect(counterNum).toBeGreaterThanOrEqual(1);
          expect(counterNum).toBeLessThanOrEqual(99999);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ── Sub-property D: Uniqueness ───────────────────────────────────────────────
  it("N lot IDs generated for the same year (with incrementing counter) are all distinct", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pick a year in 2000–2099
        fc.integer({ min: 2000, max: 2099 }).map((y) => `${y}-06-15`),
        // Generate between 2 and 20 IDs per run
        fc.integer({ min: 2, max: 20 }),
        async (intakeDate, n) => {
          // A single shared mock client whose counter increments across all calls
          const client = buildMockSupabaseClient(0);

          const lotIds: string[] = [];
          for (let i = 0; i < n; i++) {
            const lotId = await generateLotId(intakeDate, client);
            lotIds.push(lotId);
          }

          // Assert: all N values are distinct — no collisions (Req 4.3)
          const uniqueSet = new Set(lotIds);
          expect(uniqueSet.size).toBe(n);

          // Assert: every generated ID still matches the format
          for (const lotId of lotIds) {
            expect(lotId).toMatch(LOT_ID_REGEX);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
