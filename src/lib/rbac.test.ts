/**
 * Unit tests for the RBAC helper (src/lib/rbac.ts)
 *
 * Covers Requirements 2.1–2.4:
 *   2.1 — operator permissions
 *   2.2 — qc permissions
 *   2.3 — ppic permissions
 *   2.4 — admin permissions
 */

import { describe, expect, it } from "vitest";
import { ACTIONS, checkPermission } from "./rbac";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_ACTIONS = Object.values(ACTIONS);

// ─── operator (Requirement 2.1) ───────────────────────────────────────────────

describe("checkPermission — operator (Requirement 2.1)", () => {
  const ALLOWED = [
    ACTIONS.ITEMS_REGISTER,
    ACTIONS.ITEMS_READ,
    ACTIONS.ITEMS_UPDATE_STATUS,
    ACTIONS.ITEMS_UPDATE_LOCATION,
    ACTIONS.ITEMS_BULK_SCAN,
    ACTIONS.LOCATIONS_READ,
  ];

  const DENIED = [
    ACTIONS.ITEMS_QC_PASS,
    ACTIONS.ITEMS_QC_FAIL,
    ACTIONS.USERS_MANAGE,
    ACTIONS.AUDIT_READ,
    ACTIONS.AUDIT_EXPORT,
    ACTIONS.LOCATIONS_MANAGE,
  ];

  it.each(ALLOWED)("allows %s", (action) => {
    expect(checkPermission("operator", action)).toBe(true);
  });

  it.each(DENIED)("denies %s", (action) => {
    expect(checkPermission("operator", action)).toBe(false);
  });
});

// ─── qc (Requirement 2.2) ─────────────────────────────────────────────────────

describe("checkPermission — qc (Requirement 2.2)", () => {
  const ALLOWED = [
    ACTIONS.ITEMS_READ,
    ACTIONS.ITEMS_QC_PASS,
    ACTIONS.ITEMS_QC_FAIL,
    ACTIONS.ITEMS_BULK_SCAN,
    ACTIONS.LOCATIONS_READ,
  ];

  const DENIED = [
    ACTIONS.ITEMS_REGISTER,
    ACTIONS.ITEMS_UPDATE_STATUS,
    ACTIONS.ITEMS_UPDATE_LOCATION,
    ACTIONS.USERS_MANAGE,
    ACTIONS.AUDIT_READ,
    ACTIONS.AUDIT_EXPORT,
    ACTIONS.LOCATIONS_MANAGE,
  ];

  it.each(ALLOWED)("allows %s", (action) => {
    expect(checkPermission("qc", action)).toBe(true);
  });

  it.each(DENIED)("denies %s", (action) => {
    expect(checkPermission("qc", action)).toBe(false);
  });
});

// ─── ppic (Requirement 2.3) ───────────────────────────────────────────────────

describe("checkPermission — ppic (Requirement 2.3)", () => {
  const ALLOWED = [ACTIONS.ITEMS_READ, ACTIONS.LOCATIONS_READ] as string[];

  const DENIED = ALL_ACTIONS.filter((a) => !ALLOWED.includes(a));

  it.each(ALLOWED)("allows %s", (action) => {
    expect(checkPermission("ppic", action)).toBe(true);
  });

  it.each(DENIED)("denies %s", (action) => {
    expect(checkPermission("ppic", action)).toBe(false);
  });
});

// ─── admin (Requirement 2.4) ──────────────────────────────────────────────────

describe("checkPermission — admin (Requirement 2.4)", () => {
  it.each(ALL_ACTIONS)("allows %s", (action) => {
    expect(checkPermission("admin", action)).toBe(true);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("checkPermission — edge cases", () => {
  it("returns false for an unknown action string", () => {
    expect(checkPermission("operator", "items:unknown_action")).toBe(false);
  });

  it("returns false for an empty action string", () => {
    expect(checkPermission("admin", "")).toBe(false);
  });

  it("is case-sensitive — uppercase action is denied", () => {
    expect(checkPermission("operator", "ITEMS:REGISTER")).toBe(false);
  });
});
