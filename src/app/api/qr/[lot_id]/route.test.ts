/**
 * Unit tests for GET /api/qr/[lot_id]
 *
 * Validates: Requirements 15.4, 15.5
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  })),
}));

// ─── Mock qrcode ──────────────────────────────────────────────────────────────

vi.mock("qrcode", () => ({
  default: {
    toBuffer: vi.fn(() => Promise.resolve(Buffer.from("fake-png-data"))),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(lotId: string) {
  return GET(new Request(`http://localhost/api/qr/${lotId}`), {
    params: Promise.resolve({ lot_id: lotId }),
  });
}

// ─── Import route after mocks are set up ─────────────────────────────────────

const { GET } = await import("./route");

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockMaybeSingle.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/qr/[lot_id] — known lot_id (Req 15.4)", () => {
  it("returns 200 with Content-Type image/png for a known lot_id", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { lot_id: "LOT-2026-00001" },
      error: null,
    });

    const response = await makeGetRequest("LOT-2026-00001");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns a non-empty body for a known lot_id", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { lot_id: "LOT-2026-00001" },
      error: null,
    });

    const response = await makeGetRequest("LOT-2026-00001");
    const buffer = await response.arrayBuffer();

    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

describe("GET /api/qr/[lot_id] — non-existent lot_id (Req 15.5)", () => {
  it("returns 404 when lot_id is not found in the database", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await makeGetRequest("LOT-9999-99999");

    expect(response.status).toBe(404);
  });

  it("returns JSON error body with NOT_FOUND code for unknown lot_id", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await makeGetRequest("LOT-9999-99999");
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /api/qr/[lot_id] — database error", () => {
  it("returns 500 when the database query fails", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });

    const response = await makeGetRequest("LOT-2026-00001");

    expect(response.status).toBe(500);
  });

  it("returns JSON error body with INTERNAL_ERROR code on DB error", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });

    const response = await makeGetRequest("LOT-2026-00001");
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
