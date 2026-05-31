/**
 * Unit tests for src/lib/api-response.ts
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
 */

import { describe, expect, it } from "vitest";
import type { PaginationMeta } from "../types/index";
import { ERROR_HTTP_STATUS } from "../types/index";
import { errorResponse, getHttpStatus, successResponse } from "./api-response";

// UUID v4 regex
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ISO 8601 datetime regex (basic check)
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/;

// ─── successResponse ─────────────────────────────────────────────────────────

describe("successResponse", () => {
  it("sets success to true", () => {
    const res = successResponse({ id: "1" });
    expect(res.success).toBe(true);
  });

  it("includes the provided data payload", () => {
    const data = { lot_id: "LOT-2026-00001", current_status: "received" };
    const res = successResponse(data);
    expect(res.data).toEqual(data);
  });

  it("meta.timestamp is a valid ISO 8601 string", () => {
    const res = successResponse({});
    expect(res.meta.timestamp).toMatch(ISO_8601_RE);
  });

  it("meta.request_id is a valid UUID v4 (Req 16.5)", () => {
    const res = successResponse({});
    expect(res.meta.request_id).toMatch(UUID_V4_RE);
  });

  it("each call produces a unique request_id", () => {
    const ids = Array.from(
      { length: 20 },
      () => successResponse({}).meta.request_id,
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
  });

  it("omits pagination when not provided", () => {
    const res = successResponse({ value: 42 });
    expect(res.pagination).toBeUndefined();
  });

  it("includes pagination when provided (Req 16.4)", () => {
    const pagination: PaginationMeta = {
      page: 2,
      limit: 50,
      total: 120,
      pages: 3,
    };
    const res = successResponse([], pagination);
    expect(res.pagination).toEqual(pagination);
  });

  it("works with array data", () => {
    const data = [1, 2, 3];
    const res = successResponse(data);
    expect(res.data).toEqual(data);
  });

  it("works with null data", () => {
    const res = successResponse(null);
    expect(res.data).toBeNull();
  });
});

// ─── errorResponse ───────────────────────────────────────────────────────────

describe("errorResponse", () => {
  it("sets success to false", () => {
    const res = errorResponse("NOT_FOUND", "Item not found");
    expect(res.success).toBe(false);
  });

  it("includes the error code", () => {
    const res = errorResponse("FORBIDDEN", "Access denied");
    expect(res.error.code).toBe("FORBIDDEN");
  });

  it("includes the human-readable message", () => {
    const res = errorResponse("UNAUTHORIZED", "Token expired");
    expect(res.error.message).toBe("Token expired");
  });

  it("meta.timestamp is a valid ISO 8601 string", () => {
    const res = errorResponse("INTERNAL_ERROR", "Unexpected error");
    expect(res.meta.timestamp).toMatch(ISO_8601_RE);
  });

  it("meta.request_id is a valid UUID v4 (Req 16.5)", () => {
    const res = errorResponse("INTERNAL_ERROR", "Unexpected error");
    expect(res.meta.request_id).toMatch(UUID_V4_RE);
  });

  it("each call produces a unique request_id", () => {
    const ids = Array.from(
      { length: 20 },
      () => errorResponse("INTERNAL_ERROR", "err").meta.request_id,
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
  });

  it("omits details when not provided (Req 16.1)", () => {
    const res = errorResponse("NOT_FOUND", "Not found");
    expect(res.error.details).toBeUndefined();
  });

  it("includes details when provided (Req 16.1)", () => {
    const details = { material_type: "Field is required" };
    const res = errorResponse("VALIDATION_ERROR", "Validation failed", details);
    expect(res.error.details).toEqual(details);
  });

  it("includes empty details object when explicitly passed", () => {
    const res = errorResponse("INVALID_INPUT", "Bad request", {});
    expect(res.error.details).toEqual({});
  });
});

// ─── getHttpStatus ────────────────────────────────────────────────────────────

describe("getHttpStatus (Req 16.3)", () => {
  const cases: Array<[keyof typeof ERROR_HTTP_STATUS, number]> = [
    ["INVALID_INPUT", 400],
    ["VALIDATION_ERROR", 422],
    ["UNAUTHORIZED", 401],
    ["AUTH_FAILED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["INVALID_TRANSITION", 422],
    ["BATCH_TOO_LARGE", 413],
    ["RATE_LIMITED", 429],
    ["INTERNAL_ERROR", 500],
  ];

  it.each(cases)("%s → %i", (code, expected) => {
    expect(getHttpStatus(code)).toBe(expected);
  });

  it("covers every ErrorCode in ERROR_HTTP_STATUS", () => {
    const allCodes = Object.keys(ERROR_HTTP_STATUS) as Array<
      keyof typeof ERROR_HTTP_STATUS
    >;
    for (const code of allCodes) {
      expect(getHttpStatus(code)).toBe(ERROR_HTTP_STATUS[code]);
    }
  });
});
