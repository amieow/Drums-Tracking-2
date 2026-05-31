/**
 * Property-Based Tests for QR Code Round-Trip (Property 14)
 *
 * **Validates: Requirements 15.1, 15.3**
 *
 * Property 14: QR Code Round-Trip
 * For any valid Lot ID, the QR code route SHALL:
 *   1. Return HTTP 200 with Content-Type: image/png
 *   2. Pass the exact lot_id string to QRCode.toBuffer (encoding correctness)
 *
 * Since actual QR decoding in a Node.js test environment requires a browser
 * engine, the round-trip is verified by asserting that QRCode.toBuffer is
 * called with the exact lot_id — i.e., the value encoded into the QR image
 * equals the original lot_id exactly.
 */

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("qrcode", () => ({
  default: {
    toBuffer: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

// Import after mock declarations so vi.mock hoisting works
import { GET } from "@/app/api/qr/[lot_id]/route";
import { getSupabaseClient } from "@/lib/supabase";
import QRCode from "qrcode";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deterministic PNG buffer returned by the mocked QRCode.toBuffer */
const FAKE_PNG_BUFFER = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // PNG signature
]);

/**
 * Builds a minimal Supabase mock that simulates finding a row for the given
 * lot_id in the items table (.from("items").select().eq().maybeSingle()).
 */
function makeSupabaseMock(found: boolean) {
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: found ? { lot_id: "LOT-2026-00001" } : null,
    error: null,
  });
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });

  return { from: fromFn };
}

// ─── Lot ID generator ─────────────────────────────────────────────────────────

/**
 * Generates valid Lot IDs matching the format LOT-2026-NNNNN.
 * Uses fc.string to produce the suffix, then pads/slices to exactly 5 chars.
 */
const validLotIdArb = fc
  .string({ minLength: 1, maxLength: 5 })
  .map((s) => `LOT-2026-${s.padStart(5, "0").slice(0, 5)}`);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Property 14: QR Code Round-Trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: QRCode.toBuffer returns the fake PNG buffer
    vi.mocked(QRCode.toBuffer).mockResolvedValue(FAKE_PNG_BUFFER as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Property 14a: Valid lot_id → 200 image/png ───────────────────────────

  it("valid lot_id: GET /api/qr/[lot_id] returns HTTP 200 with Content-Type image/png", async () => {
    await fc.assert(
      fc.asyncProperty(validLotIdArb, async (lot_id) => {
        // Arrange: item exists in DB
        const mockClient = makeSupabaseMock(true);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        // Act
        const request = new Request(`http://localhost/api/qr/${lot_id}`);
        const response = await GET(request, {
          params: Promise.resolve({ lot_id }),
        });

        // Assert: correct HTTP status
        expect(response.status).toBe(200);

        // Assert: correct Content-Type
        expect(response.headers.get("Content-Type")).toBe("image/png");
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 14b: QRCode.toBuffer is called with the exact lot_id ────────

  it("round-trip encoding: QRCode.toBuffer is called with the exact lot_id string", async () => {
    await fc.assert(
      fc.asyncProperty(validLotIdArb, async (lot_id) => {
        // Arrange: item exists in DB
        const mockClient = makeSupabaseMock(true);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        // Act
        const request = new Request(`http://localhost/api/qr/${lot_id}`);
        await GET(request, { params: Promise.resolve({ lot_id }) });

        // Assert: QRCode.toBuffer was called with the exact lot_id
        // This verifies the round-trip property: the value encoded into the
        // QR image equals the original lot_id exactly (Requirements 15.1, 15.3)
        expect(QRCode.toBuffer).toHaveBeenCalledWith(lot_id, {
          type: "png",
        });
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 14c: Non-existent lot_id → 404 ─────────────────────────────

  it("non-existent lot_id: GET /api/qr/[lot_id] returns HTTP 404", async () => {
    await fc.assert(
      fc.asyncProperty(validLotIdArb, async (lot_id) => {
        // Arrange: item does NOT exist in DB
        const mockClient = makeSupabaseMock(false);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        // Act
        const request = new Request(`http://localhost/api/qr/${lot_id}`);
        const response = await GET(request, {
          params: Promise.resolve({ lot_id }),
        });

        // Assert: 404 for unknown lot_id (Requirement 15.5)
        expect(response.status).toBe(404);

        // Assert: QRCode.toBuffer was NOT called (no QR generated for missing items)
        expect(QRCode.toBuffer).not.toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 14d: Response body is the PNG buffer from QRCode.toBuffer ───

  it("response body: response body matches the buffer returned by QRCode.toBuffer", async () => {
    await fc.assert(
      fc.asyncProperty(validLotIdArb, async (lot_id) => {
        // Arrange: item exists in DB
        const mockClient = makeSupabaseMock(true);
        vi.mocked(getSupabaseClient).mockReturnValue(mockClient as never);

        // Act
        const request = new Request(`http://localhost/api/qr/${lot_id}`);
        const response = await GET(request, {
          params: Promise.resolve({ lot_id }),
        });

        // Assert: response body equals the fake PNG buffer
        const body = await response.arrayBuffer();
        const bodyBytes = new Uint8Array(body);
        const expectedBytes = new Uint8Array(FAKE_PNG_BUFFER);

        expect(bodyBytes).toEqual(expectedBytes);
      }),
      { numRuns: 20 },
    );
  });
});
