/**
 * Integration Tests: Health and Readiness Endpoints
 *
 * Tests for:
 *   - GET /api/health  (Requirements 12.4)
 *   - GET /api/readiness  (Requirements 12.5, 12.6)
 *
 * Route handlers are tested directly by importing and calling them with
 * mock NextRequest objects, without spinning up an HTTP server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @supabase/supabase-js before importing route handlers ───────────────

vi.mock("@supabase/supabase-js", () => {
  const mockFrom = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    from: mockFrom,
  }));
  return { createClient: mockCreateClient, _mockFrom: mockFrom };
});

// ─── Mock next/server NextResponse ───────────────────────────────────────────
// We use the real NextResponse from next/server; ensure env vars are set so
// the supabase singleton doesn't throw before we can mock it.

// ─── Imports ─────────────────────────────────────────────────────────────────

import { GET as healthGET } from "../../app/api/health/route";
import { GET as readinessGET } from "../../app/api/readiness/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Retrieve the mocked `from` function after module resolution. */
async function getMockFrom() {
  const mod = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any)._mockFrom as ReturnType<typeof vi.fn>;
}

// ─── Health endpoint ──────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns HTTP 200 with { status: 'ok' } when the process is running", async () => {
    const response = healthGET();

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("always returns the same response regardless of how many times it is called", async () => {
    for (let i = 0; i < 5; i++) {
      const response = healthGET();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: "ok" });
    }
  });
});

// ─── Readiness endpoint ───────────────────────────────────────────────────────

describe("GET /api/readiness", () => {
  beforeEach(() => {
    // Provide required env vars so the Supabase singleton can be constructed
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

    // Reset the singleton so each test gets a fresh client mock
    vi.resetModules();
  });

  it("returns HTTP 200 with { ready: true } when the DB query succeeds", async () => {
    const mockFrom = await getMockFrom();

    // Simulate a successful DB ping: no error returned
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce({ data: [], error: null }),
      }),
    });

    const response = await readinessGET();

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ ready: true });
  });

  it("returns HTTP 503 with { ready: false, error: 'INTERNAL_ERROR' } when the DB query returns an error", async () => {
    const mockFrom = await getMockFrom();

    // Simulate a DB failure: Supabase returns an error object
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce({
          data: null,
          error: { message: "connection refused", code: "PGRST000" },
        }),
      }),
    });

    const response = await readinessGET();

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body).toEqual({ ready: false, error: "INTERNAL_ERROR" });
  });

  it("returns HTTP 503 with { ready: false, error: 'INTERNAL_ERROR' } when the Supabase client throws", async () => {
    const mockFrom = await getMockFrom();

    // Simulate a thrown error (e.g., network failure, missing env var)
    mockFrom.mockImplementationOnce(() => {
      throw new Error("Network unreachable");
    });

    const response = await readinessGET();

    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body).toEqual({ ready: false, error: "INTERNAL_ERROR" });
  });
});
