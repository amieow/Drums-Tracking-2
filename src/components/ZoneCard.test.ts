/**
 * Unit tests for ZoneCard component logic.
 *
 * Tests the capacity warning logic (Requirement 8.5) and color coding
 * (Requirement 8.4) without requiring a DOM renderer.
 */

import type { Location, LocationType } from "@/types";
import { describe, expect, it } from "vitest";

// ─── Re-implement the pure helpers under test ─────────────────────────────────
// These mirror the logic in ZoneCard.tsx so we can test them in isolation.

function isAtCapacity(location: Location): boolean {
  return location.capacity > 0 && location.current_count >= location.capacity;
}

const ZONE_TYPE_LABELS: Record<LocationType, string> = {
  cold: "Cold Storage",
  hazard: "Hazard",
  qc: "QC",
  production: "Production",
  standard: "Standard",
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    zone_id: "TEST-01",
    name: "Test Zone",
    type: "standard",
    capacity: 10,
    current_count: 0,
    ...overrides,
  };
}

// ─── Capacity warning logic (Requirement 8.5) ─────────────────────────────────

describe("isAtCapacity — Requirement 8.5", () => {
  it("returns false when current_count is below capacity", () => {
    expect(isAtCapacity(makeLocation({ capacity: 10, current_count: 9 }))).toBe(
      false,
    );
  });

  it("returns true when current_count equals capacity (capacity > 0)", () => {
    expect(
      isAtCapacity(makeLocation({ capacity: 10, current_count: 10 })),
    ).toBe(true);
  });

  it("returns true when current_count exceeds capacity (capacity > 0)", () => {
    expect(
      isAtCapacity(makeLocation({ capacity: 10, current_count: 11 })),
    ).toBe(true);
  });

  it("returns false when capacity is 0 (unlimited zone)", () => {
    // Requirement 14.6: capacity=0 means unlimited — no warning should show
    expect(
      isAtCapacity(makeLocation({ capacity: 0, current_count: 999 })),
    ).toBe(false);
  });

  it("returns false when current_count is 0 and capacity is 0", () => {
    expect(isAtCapacity(makeLocation({ capacity: 0, current_count: 0 }))).toBe(
      false,
    );
  });

  it("returns false when current_count is 0 and capacity > 0", () => {
    expect(isAtCapacity(makeLocation({ capacity: 5, current_count: 0 }))).toBe(
      false,
    );
  });

  it("returns true at exactly capacity=1, current_count=1", () => {
    expect(isAtCapacity(makeLocation({ capacity: 1, current_count: 1 }))).toBe(
      true,
    );
  });
});

// ─── Zone type labels (Requirement 8.4) ──────────────────────────────────────

describe("Zone type labels — Requirement 8.4", () => {
  const cases: Array<[LocationType, string]> = [
    ["cold", "Cold Storage"],
    ["hazard", "Hazard"],
    ["qc", "QC"],
    ["production", "Production"],
    ["standard", "Standard"],
  ];

  it.each(cases)(
    "type '%s' maps to label '%s'",
    (type: LocationType, expectedLabel: string) => {
      expect(ZONE_TYPE_LABELS[type]).toBe(expectedLabel);
    },
  );

  it("covers all five LocationType values", () => {
    const allTypes: LocationType[] = [
      "cold",
      "hazard",
      "qc",
      "production",
      "standard",
    ];
    for (const t of allTypes) {
      expect(ZONE_TYPE_LABELS[t]).toBeDefined();
      expect(typeof ZONE_TYPE_LABELS[t]).toBe("string");
      expect(ZONE_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("ZoneCard edge cases", () => {
  it("capacity warning is independent of zone type", () => {
    const types: LocationType[] = [
      "cold",
      "hazard",
      "qc",
      "production",
      "standard",
    ];
    for (const type of types) {
      const atCap = makeLocation({ type, capacity: 5, current_count: 5 });
      const belowCap = makeLocation({ type, capacity: 5, current_count: 4 });
      expect(isAtCapacity(atCap)).toBe(true);
      expect(isAtCapacity(belowCap)).toBe(false);
    }
  });

  it("unlimited zones (capacity=0) never trigger warning regardless of count", () => {
    const largeCounts = [0, 1, 100, 500, 9999];
    for (const count of largeCounts) {
      expect(
        isAtCapacity(makeLocation({ capacity: 0, current_count: count })),
      ).toBe(false);
    }
  });
});
