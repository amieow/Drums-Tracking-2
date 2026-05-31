/**
 * Unit Tests — Location Service
 *
 * Tests `listLocations`, `createLocation`, and `updateLocation` in isolation
 * by mocking `@/lib/supabase` so that `getSupabaseClient()` returns a
 * controlled mock client.
 *
 * Requirements: 14.1–14.6
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocation,
  listLocations,
  updateLocation,
} from "./location-service";

// ─── Mock: supabase ───────────────────────────────────────────────────────────

let mockSupabaseClient:
  | ReturnType<typeof buildListMockClient>
  | ReturnType<typeof buildCreateMockClient>
  | ReturnType<typeof buildUpdateMockClient>;

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(() => mockSupabaseClient),
}));

// ─── Mock Client Builders ─────────────────────────────────────────────────────

/**
 * Builds a mock client for `listLocations`.
 *
 * `listLocations` calls:
 *   from("location_counts").select(...) → resolves to { data, error }
 */
function buildListMockClient(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn((_table: string) => ({
      select: vi.fn(() => Promise.resolve(result)),
    })),
  };
}

/**
 * Builds a mock client for `createLocation`.
 *
 * `createLocation` calls:
 *   from("locations").insert(...).select(...).single() → resolves to insertResult
 */
function buildCreateMockClient(insertResult: {
  data: unknown;
  error: unknown;
}) {
  return {
    from: vi.fn((_table: string) => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(insertResult)),
        })),
      })),
    })),
  };
}

/**
 * Builds a mock client for `updateLocation`.
 *
 * `updateLocation` calls three chained queries:
 *   1. from("locations").select(...).eq(...).single()  → fetchResult
 *   2. from("locations").update(...).eq(...).select(...).single() → updateResult
 *   3. from("location_counts").select(...).eq(...).single() → countResult
 *
 * We distinguish the three `from` calls by table name and call order.
 */
function buildUpdateMockClient(opts: {
  fetchResult: { data: unknown; error: unknown };
  updateResult: { data: unknown; error: unknown };
  countResult?: { data: unknown; error: unknown };
}) {
  const {
    fetchResult,
    updateResult,
    countResult = { data: { current_count: 3 }, error: null },
  } = opts;

  let locationsCallCount = 0;

  return {
    from: vi.fn((table: string) => {
      if (table === "locations") {
        locationsCallCount += 1;
        if (locationsCallCount === 1) {
          // First call: fetch existing location
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(fetchResult)),
              })),
            })),
          };
        }
        // Second call: update location
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(updateResult)),
              })),
            })),
          })),
        };
      }

      // location_counts: fetch current_count after update
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve(countResult)),
          })),
        })),
      };
    }),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Rows returned by the `location_counts` view. */
const MOCK_LOCATION_COUNTS_ROWS = [
  {
    zone_id: "COLD-A",
    name: "Cold Storage A",
    type: "cold",
    temperature_target: -5,
    capacity: 50,
    current_count: 12,
  },
  {
    zone_id: "STD-01",
    name: "Standard Zone 1",
    type: "standard",
    temperature_target: null,
    capacity: 100,
    current_count: 0,
  },
];

/** A valid standard zone creation payload. */
const VALID_STANDARD_INPUT = {
  zone_id: "STD-01",
  name: "Standard Zone 1",
  type: "standard" as const,
  capacity: 100,
};

/** A valid cold zone creation payload. */
const VALID_COLD_INPUT = {
  zone_id: "COLD-A",
  name: "Cold Storage A",
  type: "cold" as const,
  temperature_target: 0,
  capacity: 50,
};

/** The DB row returned after a successful standard zone insert. */
const MOCK_CREATED_STANDARD_ROW = {
  zone_id: "STD-01",
  name: "Standard Zone 1",
  type: "standard",
  temperature_target: null,
  capacity: 100,
};

/** The DB row returned after a successful cold zone insert. */
const MOCK_CREATED_COLD_ROW = {
  zone_id: "COLD-A",
  name: "Cold Storage A",
  type: "cold",
  temperature_target: 0,
  capacity: 50,
};

/** An existing location row as returned by the DB fetch. */
const MOCK_EXISTING_LOCATION = {
  zone_id: "STD-01",
  name: "Standard Zone 1",
  type: "standard",
  temperature_target: null,
  capacity: 100,
};

/** The DB row returned after a successful update. */
const MOCK_UPDATED_LOCATION = {
  zone_id: "STD-01",
  name: "Standard Zone 1 — Updated",
  type: "standard",
  temperature_target: null,
  capacity: 120,
};

const USER_ID = "user-uuid-001";

// ─── listLocations ────────────────────────────────────────────────────────────

describe("listLocations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Returns array with computed current_count ────────────────────────────

  it("returns an array of locations with current_count from the location_counts view", async () => {
    // Validates: Requirements 14.1, 14.2
    mockSupabaseClient = buildListMockClient({
      data: MOCK_LOCATION_COUNTS_ROWS,
      error: null,
    });

    const result = await listLocations();

    expect(result).toHaveLength(2);

    const coldZone = result.find((l) => l.zone_id === "COLD-A");
    expect(coldZone).toBeDefined();
    expect(coldZone?.current_count).toBe(12);
    expect(coldZone?.temperature_target).toBe(-5);
    expect(coldZone?.type).toBe("cold");

    const stdZone = result.find((l) => l.zone_id === "STD-01");
    expect(stdZone).toBeDefined();
    expect(stdZone?.current_count).toBe(0);
    expect(stdZone?.temperature_target).toBeUndefined();
  });

  // ── 2. Returns empty array when no locations exist ──────────────────────────

  it("returns an empty array when the view returns no rows", async () => {
    mockSupabaseClient = buildListMockClient({
      data: [],
      error: null,
    });

    const result = await listLocations();

    expect(result).toEqual([]);
  });

  // ── 3. Throws INTERNAL_ERROR on DB failure ──────────────────────────────────

  it("throws INTERNAL_ERROR when the database query fails", async () => {
    mockSupabaseClient = buildListMockClient({
      data: null,
      error: { message: "connection refused" },
    });

    await expect(listLocations()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

// ─── createLocation ───────────────────────────────────────────────────────────

describe("createLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Valid standard zone → returns location with current_count: 0 ─────────

  it("returns created location with current_count: 0 for a valid standard zone", async () => {
    // Validates: Requirements 14.1, 14.3
    mockSupabaseClient = buildCreateMockClient({
      data: MOCK_CREATED_STANDARD_ROW,
      error: null,
    });

    const result = await createLocation(VALID_STANDARD_INPUT, USER_ID);

    expect(result.zone_id).toBe("STD-01");
    expect(result.name).toBe("Standard Zone 1");
    expect(result.type).toBe("standard");
    expect(result.capacity).toBe(100);
    expect(result.current_count).toBe(0);
    expect(result.temperature_target).toBeUndefined();
  });

  // ── 2. Cold zone without temperature_target → VALIDATION_ERROR ──────────────

  it("throws VALIDATION_ERROR when creating a cold zone without temperature_target", async () => {
    // Validates: Requirements 14.4, 14.5
    mockSupabaseClient = buildCreateMockClient({
      data: null,
      error: null,
    });

    const input = {
      zone_id: "COLD-B",
      name: "Cold Storage B",
      type: "cold" as const,
      capacity: 30,
      // temperature_target intentionally omitted
    };

    await expect(createLocation(input, USER_ID)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({
        temperature_target: expect.any(String),
      }),
    });
  });

  // ── 3. Cold zone with temperature_target = -31 (below -30) → VALIDATION_ERROR

  it("throws VALIDATION_ERROR when cold zone temperature_target is -31 (below -30)", async () => {
    // Validates: Requirements 14.4, 14.5
    mockSupabaseClient = buildCreateMockClient({
      data: null,
      error: null,
    });

    const input = {
      zone_id: "COLD-C",
      name: "Cold Storage C",
      type: "cold" as const,
      temperature_target: -31,
      capacity: 30,
    };

    await expect(createLocation(input, USER_ID)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({
        temperature_target: expect.any(String),
      }),
    });
  });

  // ── 4. Cold zone with temperature_target = 11 (above 10) → VALIDATION_ERROR ─

  it("throws VALIDATION_ERROR when cold zone temperature_target is 11 (above 10)", async () => {
    // Validates: Requirements 14.4, 14.5
    mockSupabaseClient = buildCreateMockClient({
      data: null,
      error: null,
    });

    const input = {
      zone_id: "COLD-D",
      name: "Cold Storage D",
      type: "cold" as const,
      temperature_target: 11,
      capacity: 30,
    };

    await expect(createLocation(input, USER_ID)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({
        temperature_target: expect.any(String),
      }),
    });
  });

  // ── 5. Cold zone with valid temperature_target = 0 → succeeds ───────────────

  it("succeeds when cold zone temperature_target is 0 (within -30 to 10 range)", async () => {
    // Validates: Requirements 14.4, 14.5
    mockSupabaseClient = buildCreateMockClient({
      data: MOCK_CREATED_COLD_ROW,
      error: null,
    });

    const result = await createLocation(VALID_COLD_INPUT, USER_ID);

    expect(result.zone_id).toBe("COLD-A");
    expect(result.type).toBe("cold");
    expect(result.temperature_target).toBe(0);
    expect(result.current_count).toBe(0);
  });

  // ── 6. Zone with capacity = 0 → succeeds (unlimited capacity) ───────────────

  it("succeeds when capacity is 0 (unlimited capacity, no validation error)", async () => {
    // Validates: Requirement 14.6 — capacity 0 means unlimited, no warning/error
    const unlimitedRow = {
      zone_id: "STD-UNLIMITED",
      name: "Unlimited Zone",
      type: "standard",
      temperature_target: null,
      capacity: 0,
    };

    mockSupabaseClient = buildCreateMockClient({
      data: unlimitedRow,
      error: null,
    });

    const input = {
      zone_id: "STD-UNLIMITED",
      name: "Unlimited Zone",
      type: "standard" as const,
      capacity: 0,
    };

    const result = await createLocation(input, USER_ID);

    expect(result.capacity).toBe(0);
    expect(result.current_count).toBe(0);
  });

  // ── 7. DB insert error → INTERNAL_ERROR ─────────────────────────────────────

  it("throws INTERNAL_ERROR when the database insert fails", async () => {
    mockSupabaseClient = buildCreateMockClient({
      data: null,
      error: { message: "unique constraint violation" },
    });

    await expect(
      createLocation(VALID_STANDARD_INPUT, USER_ID),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

// ─── updateLocation ───────────────────────────────────────────────────────────

describe("updateLocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Non-existent zone → NOT_FOUND ────────────────────────────────────────

  it("throws NOT_FOUND when the zone does not exist", async () => {
    // Validates: Requirement 14.3
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: null, error: { message: "No rows found" } },
      updateResult: { data: null, error: null }, // never reached
    });

    await expect(
      updateLocation("NONEXISTENT", { name: "New Name" }, USER_ID),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ── 2. Valid changes → returns updated location with current_count ───────────

  it("returns updated location with current_count from location_counts view", async () => {
    // Validates: Requirements 14.1, 14.2, 14.3
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_EXISTING_LOCATION, error: null },
      updateResult: { data: MOCK_UPDATED_LOCATION, error: null },
      countResult: { data: { current_count: 7 }, error: null },
    });

    const result = await updateLocation(
      "STD-01",
      { name: "Standard Zone 1 — Updated", capacity: 120 },
      USER_ID,
    );

    expect(result.zone_id).toBe("STD-01");
    expect(result.name).toBe("Standard Zone 1 — Updated");
    expect(result.capacity).toBe(120);
    expect(result.current_count).toBe(7);
  });

  // ── 3. Updating to cold type without temperature_target → VALIDATION_ERROR ───

  it("throws VALIDATION_ERROR when updating type to cold without temperature_target", async () => {
    // Validates: Requirements 14.4, 14.5
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_EXISTING_LOCATION, error: null },
      updateResult: { data: null, error: null }, // never reached
    });

    await expect(
      updateLocation("STD-01", { type: "cold" }, USER_ID),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: expect.objectContaining({
        temperature_target: expect.any(String),
      }),
    });
  });

  // ── 4. DB update error → INTERNAL_ERROR ─────────────────────────────────────

  it("throws INTERNAL_ERROR when the database update fails", async () => {
    mockSupabaseClient = buildUpdateMockClient({
      fetchResult: { data: MOCK_EXISTING_LOCATION, error: null },
      updateResult: {
        data: null,
        error: { message: "deadlock detected" },
      },
    });

    await expect(
      updateLocation("STD-01", { name: "New Name" }, USER_ID),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});
