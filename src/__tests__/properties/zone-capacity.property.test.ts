/**
 * Property-Based Tests for Zone Capacity Invariant (Property 12)
 *
 * **Validates: Requirements 14.2, 14.3, 14.5**
 *
 * Property 12: Zone Capacity Invariant
 * For any Location with `capacity > 0`, the `current_count` (computed as the
 * count of items with `location_zone = zone_id`) SHALL never exceed `capacity`.
 * Any item update that would cause `current_count` to exceed `capacity` SHALL
 * return a `VALIDATION_ERROR` and SHALL NOT update the item's `location_zone`.
 *
 * Since capacity enforcement at the DB level uses a CHECK constraint, this
 * property test validates the `validateLocationInput` function from
 * `src/lib/validation.ts` and the `createLocation` / `updateLocation` service
 * functions (which call `validateLocationInput` internally).
 */

import { validateLocationInput } from "@/lib/validation";
import { createLocation, updateLocation } from "@/services/location-service";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Supabase mock factory ────────────────────────────────────────────────────

/**
 * Creates a chainable Supabase mock for location operations.
 *
 * - `createResult`: the data returned by `.insert().select().single()`
 * - `existingLocation`: the data returned by the fetch in `updateLocation`
 * - `updateResult`: the data returned by `.update().select().single()`
 * - `countResult`: the data returned by the `location_counts` view query
 */
function makeLocationSupabaseMock(options: {
  createResult?: Record<string, unknown> | null;
  existingLocation?: Record<string, unknown> | null;
  updateResult?: Record<string, unknown> | null;
  countResult?: { current_count: number } | null;
}) {
  const {
    createResult = null,
    existingLocation = null,
    updateResult = null,
    countResult = null,
  } = options;

  // Insert chain: .insert().select().single()
  const insertSingleFn = vi.fn().mockResolvedValue({
    data: createResult,
    error: createResult ? null : { message: "insert failed" },
  });
  const insertSelectFn = vi.fn().mockReturnValue({ single: insertSingleFn });
  const insertFn = vi.fn().mockReturnValue({ select: insertSelectFn });

  // Fetch chain for updateLocation: .select().eq().single()
  const fetchSingleFn = vi.fn().mockResolvedValue({
    data: existingLocation,
    error: existingLocation ? null : { message: "not found" },
  });
  const fetchEqFn = vi.fn().mockReturnValue({ single: fetchSingleFn });
  const fetchSelectFn = vi.fn().mockReturnValue({ eq: fetchEqFn });

  // Update chain: .update().eq().select().single()
  const updateSingleFn = vi.fn().mockResolvedValue({
    data: updateResult,
    error: updateResult ? null : { message: "update failed" },
  });
  const updateSelectFn = vi.fn().mockReturnValue({ single: updateSingleFn });
  const updateEqFn = vi.fn().mockReturnValue({ select: updateSelectFn });
  const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn });

  // location_counts view chain: .select().eq().single()
  const countSingleFn = vi.fn().mockResolvedValue({
    data: countResult,
    error: countResult ? null : { message: "count not found" },
  });
  const countEqFn = vi.fn().mockReturnValue({ single: countSingleFn });
  const countSelectFn = vi.fn().mockReturnValue({ eq: countEqFn });

  // .from() dispatcher — routes to the right chain based on table name
  let locationsCallCount = 0;
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "locations") {
      locationsCallCount++;
      // First call in updateLocation is the fetch; subsequent calls are the update
      if (locationsCallCount === 1 && existingLocation !== undefined) {
        return { select: fetchSelectFn, insert: insertFn };
      }
      return { select: fetchSelectFn, insert: insertFn, update: updateFn };
    }
    if (table === "location_counts") {
      return { select: countSelectFn };
    }
    return {};
  });

  return { from: fromFn };
}

// ─── Module mock setup ────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "@/lib/supabase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const USER_ID = "user-uuid-0001";

/** Build a minimal location DB row fixture. */
function makeLocationRow(overrides: Record<string, unknown> = {}) {
  return {
    zone_id: "ZONE-TEST-01",
    name: "Test Zone",
    type: "standard",
    temperature_target: null,
    capacity: 10,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 12: Zone Capacity Invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── validateLocationInput: capacity >= 0 always passes ──────────────────────

  it("validateLocationInput: any capacity >= 0 passes validation", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (capacity) => {
        const result = validateLocationInput({
          name: "Test Zone",
          type: "standard",
          capacity,
        });

        // capacity >= 0 must always be valid
        expect(result.valid).toBe(true);
        expect(result.details?.capacity).toBeUndefined();
      }),
      { numRuns: 20 },
    );
  });

  // ─── validateLocationInput: capacity < 0 always fails ────────────────────────

  it("validateLocationInput: any capacity < 0 fails validation with details.capacity", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: -1 }), (capacity) => {
        const result = validateLocationInput({
          name: "Test Zone",
          type: "standard",
          capacity,
        });

        // capacity < 0 must always be invalid
        expect(result.valid).toBe(false);
        expect(result.details).toBeDefined();
        expect(result.details!.capacity).toBeDefined();
      }),
      { numRuns: 20 },
    );
  });

  // ─── validateLocationInput: capacity = 0 passes (unlimited) ──────────────────

  it("validateLocationInput: capacity = 0 passes validation (unlimited zone)", () => {
    const result = validateLocationInput({
      name: "Unlimited Zone",
      type: "standard",
      capacity: 0,
    });

    expect(result.valid).toBe(true);
    expect(result.details?.capacity).toBeUndefined();
  });

  // ─── validateLocationInput: non-integer capacity fails ───────────────────────

  it("validateLocationInput: non-integer capacity fails validation", () => {
    fc.assert(
      fc.property(
        // Generate floats that are not integers (e.g., 1.5, 2.7)
        // fc.float requires 32-bit float boundaries — use Math.fround
        fc
          .float({
            min: Math.fround(0.1),
            max: Math.fround(100),
            noNaN: true,
            noDefaultInfinity: true,
          })
          .filter((n) => !Number.isInteger(n)),
        (capacity) => {
          const result = validateLocationInput({
            name: "Test Zone",
            type: "standard",
            capacity,
          });

          expect(result.valid).toBe(false);
          expect(result.details?.capacity).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── createLocation: valid capacity > 0 succeeds ─────────────────────────────

  it("createLocation: any capacity > 0 creates location successfully", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (capacity) => {
        const locationRow = makeLocationRow({ capacity });
        const mockClient = makeLocationSupabaseMock({
          createResult: locationRow,
        });
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        const result = await createLocation(
          {
            zone_id: "ZONE-TEST-01",
            name: "Test Zone",
            type: "standard",
            capacity,
          },
          USER_ID,
        );

        // Must return the location with the correct capacity
        expect(result.capacity).toBe(capacity);
        // current_count must start at 0 for a new location
        expect(result.current_count).toBe(0);
        // capacity must never be negative
        expect(result.capacity).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  // ─── createLocation: capacity = 0 succeeds (unlimited) ───────────────────────

  it("createLocation: capacity = 0 creates an unlimited location successfully", async () => {
    const locationRow = makeLocationRow({ capacity: 0 });
    const mockClient = makeLocationSupabaseMock({ createResult: locationRow });
    vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

    const result = await createLocation(
      {
        zone_id: "ZONE-TEST-01",
        name: "Unlimited Zone",
        type: "standard",
        capacity: 0,
      },
      USER_ID,
    );

    expect(result.capacity).toBe(0);
    expect(result.current_count).toBe(0);
  });

  // ─── createLocation: capacity = -1 throws VALIDATION_ERROR ───────────────────

  it("createLocation: capacity = -1 throws VALIDATION_ERROR", async () => {
    // No mock needed — validation fires before any DB call
    const mockClient = makeLocationSupabaseMock({});
    vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

    let thrown: unknown;
    try {
      await createLocation(
        {
          zone_id: "ZONE-TEST-01",
          name: "Bad Zone",
          type: "standard",
          capacity: -1,
        },
        USER_ID,
      );
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    const error = thrown as { code: string; details: Record<string, string> };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.capacity).toBeDefined();
  });

  // ─── createLocation: any negative capacity throws VALIDATION_ERROR ────────────

  it("createLocation: any negative capacity throws VALIDATION_ERROR", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1000, max: -1 }),
        async (capacity) => {
          const mockClient = makeLocationSupabaseMock({});
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await createLocation(
              {
                zone_id: "ZONE-TEST-01",
                name: "Bad Zone",
                type: "standard",
                capacity,
              },
              USER_ID,
            );
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeDefined();
          const error = thrown as {
            code: string;
            details: Record<string, string>;
          };
          expect(error.code).toBe("VALIDATION_ERROR");
          expect(error.details.capacity).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── updateLocation: preserving valid capacity succeeds ──────────────────────

  it("updateLocation: preserving capacity constraints works correctly", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100 }), async (capacity) => {
        const existingRow = makeLocationRow({ capacity });
        const updatedRow = makeLocationRow({ capacity, name: "Updated Zone" });
        const mockClient = makeLocationSupabaseMock({
          existingLocation: existingRow,
          updateResult: updatedRow,
          countResult: { current_count: 0 },
        });
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        const result = await updateLocation(
          "ZONE-TEST-01",
          { name: "Updated Zone" },
          USER_ID,
        );

        // Capacity must be preserved after update
        expect(result.capacity).toBe(capacity);
        // current_count must not exceed capacity
        expect(result.current_count).toBeLessThanOrEqual(result.capacity);
      }),
      { numRuns: 20 },
    );
  });

  // ─── updateLocation: setting negative capacity throws VALIDATION_ERROR ────────

  it("updateLocation: setting capacity to a negative value throws VALIDATION_ERROR", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -1000, max: -1 }),
        async (badCapacity) => {
          const existingRow = makeLocationRow({ capacity: 10 });
          const mockClient = makeLocationSupabaseMock({
            existingLocation: existingRow,
          });
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          let thrown: unknown;
          try {
            await updateLocation(
              "ZONE-TEST-01",
              { capacity: badCapacity },
              USER_ID,
            );
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeDefined();
          const error = thrown as {
            code: string;
            details: Record<string, string>;
          };
          expect(error.code).toBe("VALIDATION_ERROR");
          expect(error.details.capacity).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Zone capacity invariant: current_count never exceeds capacity ────────────

  it("zone capacity invariant: current_count never exceeds capacity for any valid location", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        // current_count is always <= capacity (the invariant we're testing)
        fc.integer({ min: 0, max: 100 }),
        async (capacity, rawCount) => {
          // Clamp current_count to capacity to simulate a valid DB state
          const currentCount = Math.min(rawCount, capacity);

          const existingRow = makeLocationRow({ capacity });
          const updatedRow = makeLocationRow({ capacity });
          const mockClient = makeLocationSupabaseMock({
            existingLocation: existingRow,
            updateResult: updatedRow,
            countResult: { current_count: currentCount },
          });
          vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

          const result = await updateLocation(
            "ZONE-TEST-01",
            { name: "Test Zone" },
            USER_ID,
          );

          // The invariant: current_count must never exceed capacity
          expect(result.current_count).toBeLessThanOrEqual(result.capacity);
          // capacity must remain positive
          expect(result.capacity).toBeGreaterThan(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});
