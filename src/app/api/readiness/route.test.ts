/**
 * Unit tests for GET /api/readiness
 *
 * Validates: Requirements 12.5, 12.6
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSupabaseMock() {
  const mod = await import("@/lib/supabase");
  return mod.getSupabaseClient as ReturnType<typeof vi.fn>;
}

function makeSupabaseClientMock(error: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ error }),
      }),
    }),
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  const getSupabaseClient = await getSupabaseMock();
  vi.mocked(getSupabaseClient).mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/readiness — DB up (Req 12.5)", () => {
  it("returns 200 with { ready: true } when DB is reachable", async () => {
    const getSupabaseClient = await getSupabaseMock();
    vi.mocked(getSupabaseClient).mockReturnValue(makeSupabaseClientMock(null));

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ready: true });
  });

  it("returns ready: true even when the query returns an empty result set", async () => {
    const getSupabaseClient = await getSupabaseMock();
    // No error means DB is up, even if no rows returned
    vi.mocked(getSupabaseClient).mockReturnValue(makeSupabaseClientMock(null));

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(body.ready).toBe(true);
  });
});

describe("GET /api/readiness — DB down (Req 12.6)", () => {
  it("returns 503 with { ready: false, error: 'INTERNAL_ERROR' } when DB returns an error", async () => {
    const getSupabaseClient = await getSupabaseMock();
    vi.mocked(getSupabaseClient).mockReturnValue(
      makeSupabaseClientMock({
        message: "connection refused",
        code: "PGRST000",
      }),
    );

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ready: false, error: "INTERNAL_ERROR" });
  });

  it("returns 503 with { ready: false, error: 'INTERNAL_ERROR' } when getSupabaseClient throws", async () => {
    const getSupabaseClient = await getSupabaseMock();
    vi.mocked(getSupabaseClient).mockImplementation(() => {
      throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
    });

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.error).toBe("INTERNAL_ERROR");
  });

  it("returns 503 when the DB query itself throws an unexpected error", async () => {
    const getSupabaseClient = await getSupabaseMock();
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("network timeout")),
        }),
      }),
    });

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.error).toBe("INTERNAL_ERROR");
  });
});
