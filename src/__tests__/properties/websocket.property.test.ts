/**
 * Property-Based Tests for WebSocket Events on Item Changes (Property 19)
 *
 * **Validates: Requirements 11.1, 11.2**
 *
 * Property 19: WebSocket Events Published on Item Changes
 * For any item status/location change, assert `item_updated` event published
 * with `lot_id`, `current_status`, `location_zone`, `updated_at`; for any new
 * registration, assert `item_created` event published with `lot_id`,
 * `material_type`, `current_status`, `created_at`.
 */

import { publishWsEvent } from "@/services/item-service";
import type {
  ItemStatus,
  WsItemCreatedEvent,
  WsItemUpdatedEvent,
} from "@/types";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAAS_BASE_URL = process.env.NEXT_PUBLIC_DAAS_URL ?? "";

const BROADCAST_URL = `${DAAS_BASE_URL}/ws/broadcast`;

const ITEM_STATUSES: ItemStatus[] = [
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

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates a valid LOT-YYYY-NNNNN lot_id string. */
const lotIdArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 99999 }),
  )
  .map(([year, seq]) => `LOT-${year}-${String(seq).padStart(5, "0")}`);

/** Generates a valid ISO 8601 datetime string. */
const isoDateArb = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") })
  .map((d) => d.toISOString());

/** Generates a non-empty string up to 100 chars (material_type, location_zone). */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 });

/** Generates an item_updated event payload. */
const itemUpdatedEventArb = fc
  .record({
    lot_id: lotIdArb,
    current_status: fc.constantFrom(...ITEM_STATUSES),
    location_zone: nonEmptyStringArb,
    updated_at: isoDateArb,
  })
  .map(
    (data): WsItemUpdatedEvent => ({
      event: "item_updated",
      data,
      meta: { timestamp: new Date().toISOString() },
    }),
  );

/** Generates an item_created event payload. */
const itemCreatedEventArb = fc
  .record({
    lot_id: lotIdArb,
    material_type: nonEmptyStringArb,
    created_at: isoDateArb,
  })
  .map(
    (data): WsItemCreatedEvent => ({
      event: "item_created",
      data: {
        ...data,
        current_status: "received",
      },
      meta: { timestamp: new Date().toISOString() },
    }),
  );

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/** Creates a mock fetch that resolves with a 200 OK response. */
function makeSuccessFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
  });
}

/** Creates a mock fetch that resolves with a non-2xx response. */
function makeErrorResponseFetch(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
  });
}

/** Creates a mock fetch that rejects (network error). */
function makeThrowingFetch(error: Error) {
  return vi.fn().mockRejectedValue(error);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 19: WebSocket Events Published on Item Changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DAAS_WS_BROADCAST_URL", "https://daas.example.com/ws/broadcast");
    vi.stubEnv("NEXT_PUBLIC_DAAS_URL", "https://daas.example.com");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Property 19a: item_updated event ─────────────────────────────────────

  it("item_updated event: publishWsEvent calls fetch with correct URL and payload for any item update", async () => {
    await fc.assert(
      fc.asyncProperty(itemUpdatedEventArb, async (event) => {
        const mockFetch = makeSuccessFetch();
        vi.stubGlobal("fetch", mockFetch);

        await publishWsEvent(event);

        // fetch must have been called exactly once
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [
          string,
          RequestInit,
        ];

        // Must POST to the broadcast endpoint
        expect(calledUrl).toBe(BROADCAST_URL);
        expect(calledOptions.method).toBe("POST");

        // Content-Type must be application/json
        const headers = calledOptions.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");

        // Body must be the serialized event
        const body = JSON.parse(
          calledOptions.body as string,
        ) as WsItemUpdatedEvent;
        expect(body.event).toBe("item_updated");
        expect(body.data.lot_id).toBe(event.data.lot_id);
        expect(body.data.current_status).toBe(event.data.current_status);
        expect(body.data.location_zone).toBe(event.data.location_zone);
        expect(body.data.updated_at).toBe(event.data.updated_at);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 19b: item_created event ─────────────────────────────────────

  it("item_created event: publishWsEvent calls fetch with correct URL and payload for any new registration", async () => {
    await fc.assert(
      fc.asyncProperty(itemCreatedEventArb, async (event) => {
        const mockFetch = makeSuccessFetch();
        vi.stubGlobal("fetch", mockFetch);

        await publishWsEvent(event);

        // fetch must have been called exactly once
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [
          string,
          RequestInit,
        ];

        // Must POST to the broadcast endpoint
        expect(calledUrl).toBe(BROADCAST_URL);
        expect(calledOptions.method).toBe("POST");

        // Content-Type must be application/json
        const headers = calledOptions.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");

        // Body must be the serialized event with all required fields
        const body = JSON.parse(
          calledOptions.body as string,
        ) as WsItemCreatedEvent;
        expect(body.event).toBe("item_created");
        expect(body.data.lot_id).toBe(event.data.lot_id);
        expect(body.data.material_type).toBe(event.data.material_type);
        expect(body.data.current_status).toBe("received");
        expect(body.data.created_at).toBe(event.data.created_at);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 19c: Failure tolerance — non-2xx response ───────────────────

  it("failure tolerance: publishWsEvent does NOT throw when fetch returns a non-2xx status", async () => {
    const nonOkStatuses = [400, 401, 403, 404, 500, 502, 503] as const;

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(itemUpdatedEventArb, itemCreatedEventArb),
        fc.constantFrom(...nonOkStatuses),
        async (event, status) => {
          const mockFetch = makeErrorResponseFetch(status);
          vi.stubGlobal("fetch", mockFetch);

          // Must NOT throw — errors are logged, not re-thrown (Req 11.1)
          await expect(publishWsEvent(event)).resolves.toBeUndefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 19d: Failure tolerance — fetch throws ───────────────────────

  it("failure tolerance: publishWsEvent does NOT throw when fetch rejects (network error)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(itemUpdatedEventArb, itemCreatedEventArb),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (event, errorMessage) => {
          const mockFetch = makeThrowingFetch(new Error(errorMessage));
          vi.stubGlobal("fetch", mockFetch);

          // Must NOT throw — network errors are caught and logged (Req 11.1)
          await expect(publishWsEvent(event)).resolves.toBeUndefined();
        },
      ),
      { numRuns: 20 },
    );
  });
});
