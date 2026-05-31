import { describe, expect, it } from "vitest";
import type { ItemStatus } from "../types";
import { VALID_TRANSITIONS, validateTransition } from "./state-machine";

const ALL_STATUSES: ItemStatus[] = [
  "received",
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
];

describe("VALID_TRANSITIONS", () => {
  it("covers all ItemStatus values", () => {
    for (const status of ALL_STATUSES) {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("has the correct transition map", () => {
    expect(VALID_TRANSITIONS.received).toEqual(["qc_pending"]);
    expect(VALID_TRANSITIONS.qc_pending).toEqual(["qc_pass", "qc_fail"]);
    expect(VALID_TRANSITIONS.qc_pass).toEqual([
      "in_production",
      "cold_storage",
    ]);
    expect(VALID_TRANSITIONS.qc_fail).toEqual(["archived"]);
    expect(VALID_TRANSITIONS.in_production).toEqual(["finished"]);
    expect(VALID_TRANSITIONS.finished).toEqual(["cold_storage", "dispatched"]);
    expect(VALID_TRANSITIONS.cold_storage).toEqual(["dispatched"]);
    expect(VALID_TRANSITIONS.dispatched).toEqual(["archived"]);
    expect(VALID_TRANSITIONS.archived).toEqual([]);
  });

  it("allowed array matches the map exactly for each state", () => {
    // Requirements 5.1, 5.2: the allowed list returned by validateTransition
    // must always equal VALID_TRANSITIONS[current] exactly.
    for (const current of ALL_STATUSES) {
      for (const target of ALL_STATUSES) {
        const { allowed } = validateTransition(current, target);
        expect(allowed).toEqual(VALID_TRANSITIONS[current]);
      }
    }
  });
});

describe("validateTransition — every valid transition pair (Req 5.1)", () => {
  const validPairs: [ItemStatus, ItemStatus][] = [
    ["received", "qc_pending"],
    ["qc_pending", "qc_pass"],
    ["qc_pending", "qc_fail"],
    ["qc_pass", "in_production"],
    ["qc_pass", "cold_storage"],
    ["qc_fail", "archived"],
    ["in_production", "finished"],
    ["finished", "cold_storage"],
    ["finished", "dispatched"],
    ["cold_storage", "dispatched"],
    ["dispatched", "archived"],
  ];

  for (const [current, target] of validPairs) {
    it(`${current} → ${target} returns valid=true with correct allowed list`, () => {
      const result = validateTransition(current, target);
      expect(result.valid).toBe(true);
      expect(result.allowed).toEqual(VALID_TRANSITIONS[current]);
    });
  }
});

describe("validateTransition — every invalid transition pair (Req 5.2, 5.3, 5.6)", () => {
  // Build the complete set of invalid pairs: all (current, target) combos
  // where target is NOT in VALID_TRANSITIONS[current].
  const invalidPairs: [ItemStatus, ItemStatus][] = [];
  for (const current of ALL_STATUSES) {
    for (const target of ALL_STATUSES) {
      if (!VALID_TRANSITIONS[current].includes(target)) {
        invalidPairs.push([current, target]);
      }
    }
  }

  for (const [current, target] of invalidPairs) {
    it(`${current} → ${target} returns valid=false with correct allowed list`, () => {
      const result = validateTransition(current, target);
      expect(result.valid).toBe(false);
      expect(result.allowed).toEqual(VALID_TRANSITIONS[current]);
    });
  }
});

describe("validateTransition — self-transitions (Req 5.6)", () => {
  for (const status of ALL_STATUSES) {
    it(`${status} → ${status} (self-transition) returns valid=false`, () => {
      const result = validateTransition(status, status);
      expect(result.valid).toBe(false);
      expect(result.allowed).toEqual(VALID_TRANSITIONS[status]);
    });
  }
});

describe("validateTransition — transitions from archived (Req 5.3)", () => {
  for (const target of ALL_STATUSES) {
    it(`archived → ${target} returns valid=false with empty allowed list`, () => {
      const result = validateTransition("archived", target);
      expect(result.valid).toBe(false);
      expect(result.allowed).toEqual([]);
    });
  }
});

describe("validateTransition — allowed list is always returned (Req 5.2)", () => {
  it("returns the allowed list even when the transition is invalid", () => {
    const result = validateTransition("qc_pass", "received");
    expect(result.valid).toBe(false);
    expect(result.allowed).toEqual(["in_production", "cold_storage"]);
  });

  it("returns the allowed list for a valid transition", () => {
    const result = validateTransition("received", "qc_pending");
    expect(result).toEqual({ valid: true, allowed: ["qc_pending"] });
  });
});
