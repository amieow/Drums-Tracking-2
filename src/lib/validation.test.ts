/**
 * Unit tests for src/lib/validation.ts
 *
 * Covers all five validators with boundary values, valid inputs, and
 * representative invalid inputs.
 */

import { describe, expect, it } from "vitest";
import {
  validateAuditLogQuery,
  validateLocationInput,
  validateRegistrationInput,
  validateScanBatch,
  validateSearchQuery,
} from "./validation";

// ─── validateRegistrationInput ────────────────────────────────────────────────

describe("validateRegistrationInput", () => {
  it("accepts a fully valid input", () => {
    const result = validateRegistrationInput({
      material_type: "Rose Extract",
      supplier: "Supplier Co.",
      intake_date: "2024-01-15",
    });
    expect(result.valid).toBe(true);
    expect(result.details).toBeUndefined();
  });

  it("accepts intake_date equal to today (not future)", () => {
    const today = new Date().toISOString().split("T")[0];
    const result = validateRegistrationInput({
      material_type: "A",
      supplier: "B",
      intake_date: today,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts material_type and supplier at exactly 1 character", () => {
    const result = validateRegistrationInput({
      material_type: "A",
      supplier: "B",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts material_type and supplier at exactly 100 characters", () => {
    const str100 = "a".repeat(100);
    const result = validateRegistrationInput({
      material_type: str100,
      supplier: str100,
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects missing material_type", () => {
    const result = validateRegistrationInput({
      supplier: "Supplier",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("material_type");
  });

  it("rejects empty material_type", () => {
    const result = validateRegistrationInput({
      material_type: "",
      supplier: "Supplier",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("material_type");
  });

  it("rejects whitespace-only material_type", () => {
    const result = validateRegistrationInput({
      material_type: "   ",
      supplier: "Supplier",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("material_type");
  });

  it("rejects material_type exceeding 100 characters", () => {
    const result = validateRegistrationInput({
      material_type: "a".repeat(101),
      supplier: "Supplier",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("material_type");
  });

  it("rejects missing supplier", () => {
    const result = validateRegistrationInput({
      material_type: "Rose",
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("supplier");
  });

  it("rejects supplier exceeding 100 characters", () => {
    const result = validateRegistrationInput({
      material_type: "Rose",
      supplier: "s".repeat(101),
      intake_date: "2024-01-01",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("supplier");
  });

  it("rejects missing intake_date", () => {
    const result = validateRegistrationInput({
      material_type: "Rose",
      supplier: "Supplier",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("intake_date");
  });

  it("rejects intake_date with invalid format", () => {
    const result = validateRegistrationInput({
      material_type: "Rose",
      supplier: "Supplier",
      intake_date: "15-01-2024",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("intake_date");
  });

  it("rejects intake_date that is a datetime string (not date-only)", () => {
    const result = validateRegistrationInput({
      material_type: "Rose",
      supplier: "Supplier",
      intake_date: "2024-01-15T10:00:00Z",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("intake_date");
  });

  it("rejects intake_date in the future", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const futureStr = future.toISOString().split("T")[0];
    const result = validateRegistrationInput({
      material_type: "Rose",
      supplier: "Supplier",
      intake_date: futureStr,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("intake_date");
  });

  it("reports multiple field errors at once", () => {
    const result = validateRegistrationInput({
      material_type: "",
      supplier: "",
      intake_date: "not-a-date",
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("material_type");
    expect(result.details).toHaveProperty("supplier");
    expect(result.details).toHaveProperty("intake_date");
  });
});

// ─── validateScanBatch ────────────────────────────────────────────────────────

describe("validateScanBatch", () => {
  const validItem = {
    lot_id: "LOT-2024-00001",
    target_status: "received" as const,
    timestamp: "2024-01-15T10:00:00Z",
  };

  it("accepts a batch with 1 valid item", () => {
    const result = validateScanBatch({ items: [validItem] });
    expect(result.valid).toBe(true);
  });

  it("accepts a batch with 50 valid items", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      lot_id: `LOT-2024-${String(i + 1).padStart(5, "0")}`,
      target_status: "received" as const,
      timestamp: "2024-01-15T10:00:00Z",
    }));
    const result = validateScanBatch({ items });
    expect(result.valid).toBe(true);
  });

  it("accepts all valid ItemStatus values", () => {
    const statuses = [
      "received",
      "qc_pending",
      "qc_pass",
      "qc_fail",
      "in_production",
      "finished",
      "cold_storage",
      "dispatched",
      "archived",
    ] as const;
    for (const status of statuses) {
      const result = validateScanBatch({
        items: [{ ...validItem, target_status: status }],
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects missing items field", () => {
    const result = validateScanBatch({});
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items");
  });

  it("rejects empty items array", () => {
    const result = validateScanBatch({ items: [] });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items");
  });

  it("rejects items array with more than 50 items", () => {
    const items = Array.from({ length: 51 }, () => validItem);
    const result = validateScanBatch({ items });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items");
  });

  it("rejects item with missing lot_id", () => {
    const result = validateScanBatch({
      items: [{ target_status: "received", timestamp: "2024-01-15T10:00:00Z" }],
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items[0].lot_id");
  });

  it("rejects item with invalid target_status", () => {
    const result = validateScanBatch({
      items: [
        {
          lot_id: "LOT-2024-00001",
          target_status: "invalid_status",
          timestamp: "2024-01-15T10:00:00Z",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items[0].target_status");
  });

  it("rejects item with missing timestamp", () => {
    const result = validateScanBatch({
      items: [{ lot_id: "LOT-2024-00001", target_status: "received" }],
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items[0].timestamp");
  });

  it("reports errors for multiple invalid items", () => {
    const result = validateScanBatch({
      items: [
        {
          lot_id: "",
          target_status: "received",
          timestamp: "2024-01-15T10:00:00Z",
        },
        {
          lot_id: "LOT-2024-00002",
          target_status: "bad_status",
          timestamp: "2024-01-15T10:00:00Z",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("items[0].lot_id");
    expect(result.details).toHaveProperty("items[1].target_status");
  });
});

// ─── validateAuditLogQuery ────────────────────────────────────────────────────

describe("validateAuditLogQuery", () => {
  it("accepts an empty query (all fields optional)", () => {
    const result = validateAuditLogQuery({});
    expect(result.valid).toBe(true);
  });

  it("accepts valid date_from and date_to", () => {
    const result = validateAuditLogQuery({
      date_from: "2024-01-01T00:00:00Z",
      date_to: "2024-01-31T23:59:59Z",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid page and limit", () => {
    const result = validateAuditLogQuery({ page: 1, limit: 50 });
    expect(result.valid).toBe(true);
  });

  it("accepts page=1 and limit=1 (boundary values)", () => {
    const result = validateAuditLogQuery({ page: 1, limit: 1 });
    expect(result.valid).toBe(true);
  });

  it("accepts datetime with offset timezone", () => {
    const result = validateAuditLogQuery({
      date_from: "2024-01-01T00:00:00+07:00",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid date_from format (date-only string)", () => {
    const result = validateAuditLogQuery({ date_from: "2024-01-01" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("date_from");
  });

  it("rejects invalid date_to format", () => {
    const result = validateAuditLogQuery({ date_to: "not-a-date" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("date_to");
  });

  it("rejects page=0", () => {
    const result = validateAuditLogQuery({ page: 0 });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("page");
  });

  it("rejects negative page", () => {
    const result = validateAuditLogQuery({ page: -1 });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("page");
  });

  it("rejects limit=0", () => {
    const result = validateAuditLogQuery({ limit: 0 });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("limit");
  });

  it("rejects limit=51 (exceeds max)", () => {
    const result = validateAuditLogQuery({ limit: 51 });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("limit");
  });

  it("ignores null date_from and date_to (treated as not provided)", () => {
    const result = validateAuditLogQuery({ date_from: null, date_to: null });
    expect(result.valid).toBe(true);
  });
});

// ─── validateSearchQuery ──────────────────────────────────────────────────────

describe("validateSearchQuery", () => {
  it("accepts a valid Lot ID", () => {
    const result = validateSearchQuery({ query: "LOT-2024-00001" });
    expect(result.valid).toBe(true);
  });

  it("accepts a Lot ID with year 2000 and counter 99999", () => {
    const result = validateSearchQuery({ query: "LOT-2000-99999" });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid UUID", () => {
    const result = validateSearchQuery({
      query: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an empty string", () => {
    const result = validateSearchQuery({ query: "" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects a whitespace-only string", () => {
    const result = validateSearchQuery({ query: "   " });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects a partial Lot ID (missing counter)", () => {
    const result = validateSearchQuery({ query: "LOT-2024" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects a Lot ID with wrong digit counts", () => {
    const result = validateSearchQuery({ query: "LOT-24-001" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects a plain text search term", () => {
    const result = validateSearchQuery({ query: "rose extract" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects a malformed UUID (wrong segment lengths)", () => {
    const result = validateSearchQuery({ query: "550e8400-e29b-41d4-a716" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });

  it("rejects missing query field", () => {
    const result = validateSearchQuery({});
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("query");
  });
});

// ─── validateLocationInput ────────────────────────────────────────────────────

describe("validateLocationInput", () => {
  it("accepts a valid standard location", () => {
    const result = validateLocationInput({
      name: "Receiving Dock",
      type: "standard",
      capacity: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a valid cold location with temperature_target in range", () => {
    const result = validateLocationInput({
      name: "Cold Room A",
      type: "cold",
      temperature_target: -10,
      capacity: 100,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts temperature_target at boundary -30", () => {
    const result = validateLocationInput({
      name: "Deep Freeze",
      type: "cold",
      temperature_target: -30,
      capacity: 50,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts temperature_target at boundary 10", () => {
    const result = validateLocationInput({
      name: "Cool Room",
      type: "cold",
      temperature_target: 10,
      capacity: 50,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts capacity=0 (unlimited)", () => {
    const result = validateLocationInput({
      name: "Open Floor",
      type: "standard",
      capacity: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts all valid location types", () => {
    const types = ["standard", "cold", "hazard", "qc", "production"] as const;
    for (const type of types) {
      const input =
        type === "cold"
          ? { name: "Zone", type, temperature_target: 0, capacity: 10 }
          : { name: "Zone", type, capacity: 10 };
      const result = validateLocationInput(input);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects missing name", () => {
    const result = validateLocationInput({ type: "standard", capacity: 0 });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("name");
  });

  it("rejects empty name", () => {
    const result = validateLocationInput({
      name: "",
      type: "standard",
      capacity: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("name");
  });

  it("rejects invalid type", () => {
    const result = validateLocationInput({
      name: "Zone",
      type: "freezer",
      capacity: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("type");
  });

  it("rejects cold type without temperature_target", () => {
    const result = validateLocationInput({
      name: "Cold Room",
      type: "cold",
      capacity: 50,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("temperature_target");
  });

  it("rejects cold type with temperature_target below -30", () => {
    const result = validateLocationInput({
      name: "Cold Room",
      type: "cold",
      temperature_target: -31,
      capacity: 50,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("temperature_target");
  });

  it("rejects cold type with temperature_target above 10", () => {
    const result = validateLocationInput({
      name: "Cold Room",
      type: "cold",
      temperature_target: 11,
      capacity: 50,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("temperature_target");
  });

  it("does not require temperature_target for non-cold types", () => {
    const result = validateLocationInput({
      name: "Hazard Zone",
      type: "hazard",
      capacity: 20,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects negative capacity", () => {
    const result = validateLocationInput({
      name: "Zone",
      type: "standard",
      capacity: -1,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("capacity");
  });

  it("rejects missing capacity", () => {
    const result = validateLocationInput({ name: "Zone", type: "standard" });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("capacity");
  });

  it("reports multiple errors at once", () => {
    const result = validateLocationInput({
      name: "",
      type: "invalid_type",
      capacity: -5,
    });
    expect(result.valid).toBe(false);
    expect(result.details).toHaveProperty("name");
    expect(result.details).toHaveProperty("type");
    expect(result.details).toHaveProperty("capacity");
  });
});
