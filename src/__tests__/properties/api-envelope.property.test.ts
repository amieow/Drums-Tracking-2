/**
 * Property-Based Tests for API Response Envelope Invariant (Property 21)
 *
 * **Validates: Requirements 16.1–16.5**
 *
 * Property 21: API Response Envelope Invariant
 * For any API request (success or error), assert response conforms to the
 * standard envelope:
 *   success → { success: true, data, meta: { timestamp: ISO8601, request_id: UUID_v4 } }
 *   error   → { success: false, error: { code, message }, meta: { timestamp, request_id } }
 * `request_id` is unique UUID v4; error codes map to correct HTTP status;
 * paginated endpoints include `pagination` object.
 */

import {
  errorResponse,
  getHttpStatus,
  successResponse,
} from "@/lib/api-response";
import type { ErrorCode, PaginationMeta } from "@/types";
import { ERROR_HTTP_STATUS } from "@/types";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** UUID v4 regex: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO 8601 datetime regex (simplified — covers the output of new Date().toISOString()) */
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const errorCodes = Object.keys(ERROR_HTTP_STATUS) as ErrorCode[];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 21: API Response Envelope Invariant", () => {
  // ─── Property 21a: Success envelope invariant ──────────────────────────────

  it("success envelope: successResponse(data) always returns correct envelope shape", () => {
    fc.assert(
      fc.property(fc.anything(), (data) => {
        const response = successResponse(data);

        // success flag must be true
        expect(response.success).toBe(true);

        // data must be the exact value passed in
        expect(response.data).toStrictEqual(data);

        // meta must exist with timestamp and request_id
        expect(response.meta).toBeDefined();
        expect(typeof response.meta.timestamp).toBe("string");
        expect(typeof response.meta.request_id).toBe("string");

        // timestamp must be ISO 8601
        expect(response.meta.timestamp).toMatch(ISO8601_RE);

        // request_id must be UUID v4
        expect(response.meta.request_id).toMatch(UUID_V4_RE);

        // pagination must not be present when not provided
        expect(response.pagination).toBeUndefined();
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 21b: Error envelope invariant ────────────────────────────────

  it("error envelope: errorResponse(code, message) always returns correct envelope shape", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...errorCodes),
        fc.string(),
        (code, message) => {
          const response = errorResponse(code, message);

          // success flag must be false
          expect(response.success).toBe(false);

          // error object must contain code and message
          expect(response.error).toBeDefined();
          expect(response.error.code).toBe(code);
          expect(response.error.message).toBe(message);

          // meta must exist with timestamp and request_id
          expect(response.meta).toBeDefined();
          expect(typeof response.meta.timestamp).toBe("string");
          expect(typeof response.meta.request_id).toBe("string");

          // timestamp must be ISO 8601
          expect(response.meta.timestamp).toMatch(ISO8601_RE);

          // request_id must be UUID v4
          expect(response.meta.request_id).toMatch(UUID_V4_RE);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 21c: Unique request_id ──────────────────────────────────────

  it("unique request_id: N calls to successResponse/errorResponse all produce distinct request_ids", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.boolean(), // true = use successResponse, false = use errorResponse
        (n, useSuccess) => {
          const ids: string[] = [];

          for (let i = 0; i < n; i++) {
            const response = useSuccess
              ? successResponse({ index: i })
              : errorResponse("INTERNAL_ERROR", `error ${i}`);

            ids.push(response.meta.request_id);
          }

          // All request_ids must be distinct
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(n);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 21d: Error code → HTTP status mapping ───────────────────────

  it("error code → HTTP status: getHttpStatus(code) returns the correct HTTP status for every ErrorCode", () => {
    fc.assert(
      fc.property(fc.constantFrom(...errorCodes), (code) => {
        const status = getHttpStatus(code);
        const expected = ERROR_HTTP_STATUS[code];

        expect(status).toBe(expected);

        // HTTP status must be a valid client/server error code (4xx or 5xx)
        expect(status).toBeGreaterThanOrEqual(400);
        expect(status).toBeLessThanOrEqual(599);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 21e: Paginated response includes pagination object ───────────

  it("paginated response: successResponse(data, pagination) always includes the pagination object", () => {
    const paginationArb = fc.record<PaginationMeta>({
      page: fc.integer({ min: 1, max: 1000 }),
      limit: fc.integer({ min: 1, max: 50 }),
      total: fc.integer({ min: 0, max: 100000 }),
      pages: fc.integer({ min: 0, max: 10000 }),
    });

    fc.assert(
      fc.property(fc.anything(), paginationArb, (data, pagination) => {
        const response = successResponse(data, pagination);

        // success flag must be true
        expect(response.success).toBe(true);

        // data must be the exact value passed in
        expect(response.data).toStrictEqual(data);

        // pagination must be present and match the input exactly
        expect(response.pagination).toBeDefined();
        expect(response.pagination).toStrictEqual(pagination);

        // meta must still be valid
        expect(response.meta.timestamp).toMatch(ISO8601_RE);
        expect(response.meta.request_id).toMatch(UUID_V4_RE);
      }),
      { numRuns: 20 },
    );
  });
});
