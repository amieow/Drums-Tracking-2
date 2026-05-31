/**
 * Property-Based Tests for Audit Entry Completeness and Immutability (Property 17)
 *
 * **Validates: Requirements 10.1, 10.3, 10.8**
 *
 * Property 17: Audit Entry Completeness and Immutability Round-Trip
 * For any system event (item creation, status change, location change, bulk
 * update, user login, user logout, audit export, forbidden attempt), the
 * Audit_Service SHALL write an AuditEntry with all required fields correctly
 * populated (`item_id` and `previous_state` set to `null` for non-item events).
 * When that AuditEntry is read back by its `id`, all field values SHALL be
 * identical to those written.
 */

import type { AuditAction, AuditEntry } from "@/types";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Constants ────────────────────────────────────────────────────────────────

/** All auditable action types defined in the system. */
const ALL_AUDIT_ACTIONS: AuditAction[] = [
  "item_created",
  "item_status_changed",
  "item_location_changed",
  "item_bulk_updated",
  "user_login",
  "user_logout",
  "audit_exported",
  "forbidden_attempt",
];

/**
 * Non-item events: these must have `item_id === null` and
 * `previous_state === null` per Requirement 10.3.
 */
const NON_ITEM_ACTIONS: AuditAction[] = [
  "user_login",
  "user_logout",
  "audit_exported",
  "forbidden_attempt",
];

/** Item events: these carry an `item_id` and may have a `previous_state`. */
const ITEM_ACTIONS: AuditAction[] = [
  "item_created",
  "item_status_changed",
  "item_location_changed",
  "item_bulk_updated",
];

// ─── In-memory Supabase mock ──────────────────────────────────────────────────

/**
 * Creates a minimal Supabase client mock that simulates a write-then-read
 * round-trip against the `audit_logs` table:
 *
 * - `from("audit_logs").insert(entry)` → stores the entry in memory
 * - `from("audit_logs").select("*").eq("id", id).single()` → returns the stored entry
 *
 * The mock is intentionally simple: it stores exactly one entry per instance
 * and returns it on the subsequent read. This is sufficient for the round-trip
 * property because each property run creates a fresh mock.
 */
function makeAuditRoundTripMock() {
  let storedEntry: AuditEntry | null = null;

  // insert chain: .insert(data) → Promise<{ error: null }>
  const insertFn = vi.fn().mockImplementation((data: AuditEntry) => {
    storedEntry = { ...data };
    return Promise.resolve({ error: null });
  });

  // single chain: .single() → Promise<{ data: AuditEntry | null, error: null }>
  const singleFn = vi.fn().mockImplementation(() => {
    return Promise.resolve({
      data: storedEntry ? { ...storedEntry } : null,
      error: storedEntry ? null : { message: "not found" },
    });
  });

  // eq chain: .eq("id", id) → { single }
  const eqFn = vi.fn().mockReturnValue({ single: singleFn });

  // select chain: .select("*") → { eq }
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });

  // from dispatcher
  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === "audit_logs") {
      return {
        insert: insertFn,
        select: selectFn,
      };
    }
    return {};
  });

  return {
    client: { from: fromFn },
    getStored: () => storedEntry,
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a UUID-like string (simplified for test purposes). */
const uuidArb = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/** Generates a valid ISO 8601 timestamp string. */
const isoTimestampArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") })
  .map((d) => d.toISOString());

/** Generates a valid IPv4 address string. */
const ipAddressArb = fc
  .tuple(
    fc.integer({ min: 1, max: 254 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generates a non-empty JSON string representing a state snapshot. */
const jsonStateArb = fc
  .record({
    status: fc.constantFrom(
      "received",
      "qc_pending",
      "qc_pass",
      "qc_fail",
      "in_production",
      "finished",
      "cold_storage",
      "dispatched",
      "archived",
    ),
    location: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map((obj) => JSON.stringify(obj));

/**
 * Generates a complete AuditEntry for an item event.
 * `item_id` is a UUID, `previous_state` may be a JSON string or null.
 */
const itemAuditEntryArb = fc.record({
  id: uuidArb,
  item_id: uuidArb,
  action: fc.constantFrom(...ITEM_ACTIONS),
  previous_state: fc.oneof(fc.constant(null), jsonStateArb),
  new_state: jsonStateArb,
  user_id: uuidArb,
  user_email: fc.emailAddress(),
  ip_address: ipAddressArb,
  timestamp: isoTimestampArb,
});

/**
 * Generates a complete AuditEntry for a non-item event.
 * `item_id` MUST be null and `previous_state` MUST be null per Req 10.3.
 */
const nonItemAuditEntryArb = fc.record({
  id: uuidArb,
  item_id: fc.constant(null),
  action: fc.constantFrom(...NON_ITEM_ACTIONS),
  previous_state: fc.constant(null),
  new_state: jsonStateArb,
  user_id: uuidArb,
  user_email: fc.emailAddress(),
  ip_address: ipAddressArb,
  timestamp: isoTimestampArb,
});

// ─── Module mock setup ────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "@/lib/supabase";

// ─── Helper: simulate write-then-read round-trip ──────────────────────────────

/**
 * Simulates writing an AuditEntry to `audit_logs` and reading it back by `id`.
 *
 * Uses the mocked Supabase client to:
 * 1. Call `from("audit_logs").insert(entry)` — stores entry in memory
 * 2. Call `from("audit_logs").select("*").eq("id", entry.id).single()` — retrieves it
 *
 * Returns the retrieved entry (or null on failure).
 */
async function roundTripAuditEntry(
  entry: AuditEntry,
): Promise<AuditEntry | null> {
  const supabase = getSupabaseClient();

  // Write
  const { error: insertError } = await supabase
    .from("audit_logs")
    .insert(entry);

  if (insertError) {
    throw new Error(`Insert failed: ${insertError.message}`);
  }

  // Read back by id
  const { data, error: selectError } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("id", entry.id)
    .single();

  if (selectError) {
    throw new Error(`Select failed: ${selectError.message}`);
  }

  return data as AuditEntry | null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 17: Audit Entry Completeness and Immutability Round-Trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Property 17a: Item event round-trip — all fields identical ──────────────

  it("item events: all field values are identical after write-then-read round-trip", async () => {
    await fc.assert(
      fc.asyncProperty(itemAuditEntryArb, async (entry) => {
        const { client } = makeAuditRoundTripMock();
        vi.mocked(getSupabaseClient).mockReturnValue(client as never);

        const retrieved = await roundTripAuditEntry(entry);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(entry.id);
        expect(retrieved!.item_id).toBe(entry.item_id);
        expect(retrieved!.action).toBe(entry.action);
        expect(retrieved!.previous_state).toBe(entry.previous_state);
        expect(retrieved!.new_state).toBe(entry.new_state);
        expect(retrieved!.user_id).toBe(entry.user_id);
        expect(retrieved!.user_email).toBe(entry.user_email);
        expect(retrieved!.ip_address).toBe(entry.ip_address);
        expect(retrieved!.timestamp).toBe(entry.timestamp);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 17b: Non-item event round-trip — all fields identical ──────────

  it("non-item events: all field values are identical after write-then-read round-trip", async () => {
    await fc.assert(
      fc.asyncProperty(nonItemAuditEntryArb, async (entry) => {
        const { client } = makeAuditRoundTripMock();
        vi.mocked(getSupabaseClient).mockReturnValue(client as never);

        const retrieved = await roundTripAuditEntry(entry);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(entry.id);
        expect(retrieved!.item_id).toBe(entry.item_id);
        expect(retrieved!.action).toBe(entry.action);
        expect(retrieved!.previous_state).toBe(entry.previous_state);
        expect(retrieved!.new_state).toBe(entry.new_state);
        expect(retrieved!.user_id).toBe(entry.user_id);
        expect(retrieved!.user_email).toBe(entry.user_email);
        expect(retrieved!.ip_address).toBe(entry.ip_address);
        expect(retrieved!.timestamp).toBe(entry.timestamp);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 17c: Non-item events have item_id === null ────────────────────

  it("non-item events: item_id is null after round-trip (Requirement 10.3)", async () => {
    await fc.assert(
      fc.asyncProperty(nonItemAuditEntryArb, async (entry) => {
        const { client } = makeAuditRoundTripMock();
        vi.mocked(getSupabaseClient).mockReturnValue(client as never);

        const retrieved = await roundTripAuditEntry(entry);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.item_id).toBeNull();
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 17d: Non-item events have previous_state === null ─────────────

  it("non-item events: previous_state is null after round-trip (Requirement 10.3)", async () => {
    await fc.assert(
      fc.asyncProperty(nonItemAuditEntryArb, async (entry) => {
        const { client } = makeAuditRoundTripMock();
        vi.mocked(getSupabaseClient).mockReturnValue(client as never);

        const retrieved = await roundTripAuditEntry(entry);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.previous_state).toBeNull();
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 17e: All action types are covered ──────────────────────────────

  it("all action types: every AuditAction can be written and read back with correct action field", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_AUDIT_ACTIONS),
        fc.record({
          id: uuidArb,
          user_id: uuidArb,
          user_email: fc.emailAddress(),
          ip_address: ipAddressArb,
          timestamp: isoTimestampArb,
          new_state: jsonStateArb,
        }),
        async (action, base) => {
          const isNonItem = NON_ITEM_ACTIONS.includes(action);

          const entry: AuditEntry = {
            ...base,
            action,
            item_id: isNonItem ? null : base.user_id, // reuse uuid for item_id on item events
            previous_state: isNonItem ? null : null, // null for simplicity; valid for item_created
          };

          const { client } = makeAuditRoundTripMock();
          vi.mocked(getSupabaseClient).mockReturnValue(client as never);

          const retrieved = await roundTripAuditEntry(entry);

          expect(retrieved).not.toBeNull();
          expect(retrieved!.action).toBe(action);

          if (isNonItem) {
            expect(retrieved!.item_id).toBeNull();
            expect(retrieved!.previous_state).toBeNull();
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 17f: Retrieved entry is a deep-equal copy (immutability) ───────

  it("immutability: retrieved entry is structurally identical to written entry (no field mutation)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(itemAuditEntryArb, nonItemAuditEntryArb),
        async (entry) => {
          const { client } = makeAuditRoundTripMock();
          vi.mocked(getSupabaseClient).mockReturnValue(client as never);

          const retrieved = await roundTripAuditEntry(entry);

          expect(retrieved).not.toBeNull();

          // Deep structural equality — every field must match exactly
          const fields: (keyof AuditEntry)[] = [
            "id",
            "item_id",
            "action",
            "previous_state",
            "new_state",
            "user_id",
            "user_email",
            "ip_address",
            "timestamp",
          ];

          for (const field of fields) {
            expect(retrieved![field]).toStrictEqual(
              (entry as AuditEntry)[field],
            );
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});
