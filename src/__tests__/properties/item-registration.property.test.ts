/**
 * Property-Based Tests: Item Registration Produces Correct Initial State (Property 4)
 *
 * **Validates: Requirements 3.1, 3.7**
 *
 * Property 4: For any valid registration input (material_type, supplier,
 * intake_date), the `registerItem` service SHALL return a response with:
 *   - `current_status === "received"`
 *   - `location_zone === "RECEIVING"`
 *   - a non-empty `lot_id` string
 *   - a `qr_code` string that contains the `lot_id`
 *   - a non-empty `created_at` string
 */

import * as fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerItem } from "../../services/item-service";

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => {
  const mockInsert = vi.fn();
  const mockFrom = vi.fn(() => ({
    insert: mockInsert,
  }));
  const mockRpc = vi.fn();
  const mockGetSupabaseClient = vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  }));
  return {
    getSupabaseClient: mockGetSupabaseClient,
    _mockFrom: mockFrom,
    _mockInsert: mockInsert,
    _mockRpc: mockRpc,
  };
});

// ─── Mock @/lib/lot-id-generator ─────────────────────────────────────────────

vi.mock("@/lib/lot-id-generator", () => {
  const mockGenerateLotId = vi.fn();
  return {
    generateLotId: mockGenerateLotId,
    _mockGenerateLotId: mockGenerateLotId,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMocks() {
  const supabaseMod = await import("@/lib/supabase");
  const lotIdMod = await import("@/lib/lot-id-generator");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = supabaseMod as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = lotIdMod as any;
  return {
    mockFrom: s._mockFrom as ReturnType<typeof vi.fn>,
    mockInsert: s._mockInsert as ReturnType<typeof vi.fn>,
    mockRpc: s._mockRpc as ReturnType<typeof vi.fn>,
    mockGenerateLotId: l._mockGenerateLotId as ReturnType<typeof vi.fn>,
  };
}

// ─── Property 4: Item Registration Produces Correct Initial State ─────────────

describe("Property 4: Item Registration Produces Correct Initial State (Req 3.1, 3.7)", () => {
  beforeEach(async () => {
    const { mockFrom, mockInsert, mockRpc, mockGenerateLotId } =
      await getMocks();
    mockFrom.mockReset();
    mockInsert.mockReset();
    mockRpc.mockReset();
    mockGenerateLotId.mockReset();
  });

  it("for any valid {material_type, supplier, intake_date}, response has current_status='received', location_zone='RECEIVING', non-empty lot_id, qr_code containing lot_id, and non-empty created_at", async () => {
    const { mockFrom, mockInsert, mockGenerateLotId } = await getMocks();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          // Filter out whitespace-only strings — validation requires trim().length > 0
          material_type: fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0),
          supplier: fc
            .string({ minLength: 1, maxLength: 100 })
            .filter((s) => s.trim().length > 0),
          // Constrain dates to years 2000–2099 (lot-id-generator requirement)
          // and not in the future (registration validation requirement)
          intake_date: fc
            .date({
              min: new Date("2000-01-01"),
              max: new Date(),
            })
            .map((d) => d.toISOString().split("T")[0]),
        }),
        async ({ material_type, supplier, intake_date }) => {
          // Derive the year from the generated intake_date for a realistic lot_id
          const year = intake_date.substring(0, 4);
          const lotId = `LOT-${year}-00001`;
          const createdAt = new Date().toISOString();

          // Mock generateLotId to return a valid lot_id based on the intake_date year
          mockGenerateLotId.mockResolvedValueOnce(lotId);

          // Mock the Supabase insert chain:
          // supabase.from("items").insert(...).select(...).single()
          const mockSingle = vi.fn().mockResolvedValueOnce({
            data: {
              id: "test-uuid-1234",
              lot_id: lotId,
              created_at: createdAt,
              current_status: "received",
              location_zone: "RECEIVING",
            },
            error: null,
          });
          const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
          const mockInsertChain = vi
            .fn()
            .mockReturnValue({ select: mockSelect });

          // Mock the audit_logs insert (second call to from())
          const mockAuditInsert = vi
            .fn()
            .mockResolvedValueOnce({ error: null });

          // from() is called twice: once for "items", once for "audit_logs"
          mockFrom.mockImplementation((table: string) => {
            if (table === "items") {
              return { insert: mockInsertChain };
            }
            // audit_logs
            return { insert: mockAuditInsert };
          });

          // Also wire up mockInsert for the items table (used by the service)
          mockInsert.mockReturnValue({ select: mockSelect });

          const result = await registerItem(
            { material_type, supplier, intake_date },
            "user-uuid-123",
            "user@example.com",
            "127.0.0.1",
          );

          // Assert: current_status must be "received" (Req 3.1, 3.7)
          expect(result.current_status).toBe("received");

          // Assert: location_zone must be "RECEIVING" (Req 3.1, 3.7)
          expect(result.location_zone).toBe("RECEIVING");

          // Assert: lot_id is a non-empty string (Req 3.7)
          expect(typeof result.lot_id).toBe("string");
          expect(result.lot_id.length).toBeGreaterThan(0);

          // Assert: qr_code contains the lot_id (Req 3.7)
          expect(typeof result.qr_code).toBe("string");
          expect(result.qr_code).toContain(result.lot_id);

          // Assert: created_at is a non-empty string (Req 3.7)
          expect(typeof result.created_at).toBe("string");
          expect(result.created_at.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});
