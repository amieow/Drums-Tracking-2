/**
 * Unit tests for POST /api/auth/verify
 *
 * Validates: Requirements 1.4, 1.5
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @/lib/jwt ───────────────────────────────────────────────────────────

vi.mock("@/lib/jwt", () => ({
  extractBearerToken: vi.fn(),
  verifyJwt: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJwtMocks() {
  const mod = await import("@/lib/jwt");
  return {
    extractBearerToken: mod.extractBearerToken as ReturnType<typeof vi.fn>,
    verifyJwt: mod.verifyJwt as ReturnType<typeof vi.fn>,
  };
}

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader !== undefined) {
    headers["Authorization"] = authHeader;
  }
  return new Request("http://localhost/api/auth/verify", {
    method: "POST",
    headers,
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  const { extractBearerToken, verifyJwt } = await getJwtMocks();
  vi.mocked(extractBearerToken).mockReset();
  vi.mocked(verifyJwt).mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/verify — valid token (Req 1.4)", () => {
  it("returns 200 with JWTPayload for a valid token", async () => {
    const { extractBearerToken, verifyJwt } = await getJwtMocks();

    const mockPayload = {
      sub: "user-uuid-123",
      email: "operator@example.com",
      role: "operator",
      iat: 1700000000,
      exp: 1700028800,
    };

    vi.mocked(extractBearerToken).mockReturnValue("valid-token");
    vi.mocked(verifyJwt).mockResolvedValue(mockPayload);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest("Bearer valid-token"));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.sub).toBe("user-uuid-123");
    expect(body.data.email).toBe("operator@example.com");
    expect(body.data.role).toBe("operator");
    expect(body.data.iat).toBe(1700000000);
    expect(body.data.exp).toBe(1700028800);
  });

  it("passes the extracted token to verifyJwt", async () => {
    const { extractBearerToken, verifyJwt } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue("extracted-token");
    vi.mocked(verifyJwt).mockResolvedValue({
      sub: "user-uuid",
      email: "user@example.com",
      role: "admin",
      iat: 1700000000,
      exp: 1700028800,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest("Bearer extracted-token"));
    await POST(req);

    expect(vi.mocked(verifyJwt)).toHaveBeenCalledWith("extracted-token");
  });
});

describe("POST /api/auth/verify — expired/invalid token (Req 1.5)", () => {
  it("returns 401 UNAUTHORIZED when verifyJwt returns null (expired token)", async () => {
    const { extractBearerToken, verifyJwt } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue("expired-token");
    vi.mocked(verifyJwt).mockResolvedValue(null);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest("Bearer expired-token"));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 UNAUTHORIZED when verifyJwt returns null (invalid token)", async () => {
    const { extractBearerToken, verifyJwt } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue("invalid.token.here");
    vi.mocked(verifyJwt).mockResolvedValue(null);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest("Bearer invalid.token.here"));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/auth/verify — missing Authorization header (Req 1.4)", () => {
  it("returns 401 UNAUTHORIZED when Authorization header is missing", async () => {
    const { extractBearerToken } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue(null);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest());
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 UNAUTHORIZED when Authorization header is malformed (no Bearer prefix)", async () => {
    const { extractBearerToken } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue(null);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest("Basic dXNlcjpwYXNz"));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not call verifyJwt when token extraction fails", async () => {
    const { extractBearerToken, verifyJwt } = await getJwtMocks();

    vi.mocked(extractBearerToken).mockReturnValue(null);

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest());
    await POST(req);

    expect(vi.mocked(verifyJwt)).not.toHaveBeenCalled();
  });
});
