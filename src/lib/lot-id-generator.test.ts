/**
 * Unit tests for src/lib/lot-id-generator.ts
 *
 * Validates: Requirements 3.2, 4.1, 4.4, 4.5
 */

import { describe, expect, it, vi } from "vitest";
import { generateLotId } from "./lot-id-generator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a mock Supabase client that resolves with the given sequence number. */
function mockClientWithSequence(sequence: number) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: sequence, error: null }),
  };
}

/** Creates a mock Supabase client that resolves with the given error. */
function mockClientWithError(message: string, code?: string) {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: null,
      error: { message, code: code ?? "P0001" },
    }),
  };
}

// ─── Format & Output ─────────────────────────────────────────────────────────

describe("generateLotId — output format (Req 3.2, 4.1)", () => {
  it('returns "LOT-2026-00001" for date "2026-06-15" with sequence 1', async () => {
    const client = mockClientWithSequence(1);
    const result = await generateLotId("2026-06-15", client);
    expect(result).toBe("LOT-2026-00001");
  });

  it('returns "LOT-2026-99999" for date "2026-06-15" with sequence 99999', async () => {
    const client = mockClientWithSequence(99999);
    const result = await generateLotId("2026-06-15", client);
    expect(result).toBe("LOT-2026-99999");
  });

  it("output matches the regex ^LOT-\\d{4}-\\d{5}$", async () => {
    const client = mockClientWithSequence(42);
    const result = await generateLotId("2026-06-15", client);
    expect(result).toMatch(/^LOT-\d{4}-\d{5}$/);
  });
});

// ─── Zero-padding (Req 4.1) ───────────────────────────────────────────────────

describe("generateLotId — zero-padding (Req 4.1)", () => {
  it("pads sequence 1 to 5 digits → 00001", async () => {
    const client = mockClientWithSequence(1);
    const result = await generateLotId("2026-06-15", client);
    expect(result.split("-")[2]).toBe("00001");
  });

  it("pads sequence 42 to 5 digits → 00042", async () => {
    const client = mockClientWithSequence(42);
    const result = await generateLotId("2026-06-15", client);
    expect(result.split("-")[2]).toBe("00042");
  });

  it("pads sequence 100 to 5 digits → 00100", async () => {
    const client = mockClientWithSequence(100);
    const result = await generateLotId("2026-06-15", client);
    expect(result.split("-")[2]).toBe("00100");
  });

  it("does not pad sequence 99999 (already 5 digits) → 99999", async () => {
    const client = mockClientWithSequence(99999);
    const result = await generateLotId("2026-06-15", client);
    expect(result.split("-")[2]).toBe("99999");
  });
});

// ─── Year rollover (Req 4.5) ──────────────────────────────────────────────────

describe("generateLotId — year rollover (Req 4.5)", () => {
  it('uses year 2027 for date "2027-01-01" with sequence 1 → "LOT-2027-00001"', async () => {
    const client = mockClientWithSequence(1);
    const result = await generateLotId("2027-01-01", client);
    expect(result).toBe("LOT-2027-00001");
  });

  it("passes the correct year to the RPC call on year rollover", async () => {
    const client = mockClientWithSequence(1);
    await generateLotId("2027-01-01", client);
    expect(client.rpc).toHaveBeenCalledWith("increment_lot_sequence", {
      p_year: 2027,
    });
  });

  it("passes year 2026 to the RPC call for a 2026 date", async () => {
    const client = mockClientWithSequence(5);
    await generateLotId("2026-06-15", client);
    expect(client.rpc).toHaveBeenCalledWith("increment_lot_sequence", {
      p_year: 2026,
    });
  });
});

// ─── Overflow guard (Req 4.4) ─────────────────────────────────────────────────

describe("generateLotId — overflow (Req 4.4)", () => {
  it("throws with INTERNAL_ERROR when the DB returns a SEQUENCE_OVERFLOW error", async () => {
    const client = mockClientWithError("SEQUENCE_OVERFLOW");
    await expect(generateLotId("2026-06-15", client)).rejects.toThrow(
      "INTERNAL_ERROR",
    );
  });

  it("throws with INTERNAL_ERROR when the DB returns error code P0001", async () => {
    const client = mockClientWithError("some db error", "P0001");
    await expect(generateLotId("2026-06-15", client)).rejects.toThrow(
      "INTERNAL_ERROR",
    );
  });

  it("throws with INTERNAL_ERROR when client-side sequence exceeds 99999", async () => {
    const client = mockClientWithSequence(100000);
    await expect(generateLotId("2026-06-15", client)).rejects.toThrow(
      "INTERNAL_ERROR",
    );
  });
});

// ─── Invalid year validation (Req 3.2) ───────────────────────────────────────

describe("generateLotId — invalid year (Req 3.2)", () => {
  it("throws with INTERNAL_ERROR for year 1999 (below range)", async () => {
    const client = mockClientWithSequence(1);
    await expect(generateLotId("1999-12-31", client)).rejects.toThrow(
      "INTERNAL_ERROR",
    );
  });

  it("throws with INTERNAL_ERROR for year 2100 (above range)", async () => {
    const client = mockClientWithSequence(1);
    await expect(generateLotId("2100-01-01", client)).rejects.toThrow(
      "INTERNAL_ERROR",
    );
  });

  it("does not call rpc when the year is invalid", async () => {
    const client = mockClientWithSequence(1);
    await expect(generateLotId("1999-06-15", client)).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("accepts boundary year 2000", async () => {
    const client = mockClientWithSequence(1);
    const result = await generateLotId("2000-01-01", client);
    expect(result).toBe("LOT-2000-00001");
  });

  it("accepts boundary year 2099", async () => {
    const client = mockClientWithSequence(1);
    const result = await generateLotId("2099-12-31", client);
    expect(result).toBe("LOT-2099-00001");
  });
});
