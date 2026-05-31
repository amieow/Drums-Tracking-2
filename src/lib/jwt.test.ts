/**
 * Unit tests for src/lib/jwt.ts
 *
 * Validates: Requirements 1.4, 1.5, 1.6, 1.7
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractBearerToken, verifyJwt } from "./jwt";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal base64url-encoded JWT string with the given payload.
 * The header and signature are stubs — only the payload matters for verifyJwt
 * since signature verification is delegated to Supabase Auth.
 */
function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const body = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${header}.${body}.stub-signature`;
}

// A valid payload with iat/exp values
const NOW = Math.floor(Date.now() / 1000);
const VALID_PAYLOAD = {
  sub: "user-uuid",
  email: "user@example.com",
  iat: NOW,
  exp: NOW + 28800,
};

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => {
  const mockGetUser = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    auth: { getUser: mockGetUser },
  }));
  return { createClient: mockCreateClient, _mockGetUser: mockGetUser };
});

// Helper to access the mock after module resolution
async function getMockGetUser() {
  const mod = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any)._mockGetUser as ReturnType<typeof vi.fn>;
}

// ─── extractBearerToken ───────────────────────────────────────────────────────

describe("extractBearerToken", () => {
  it("returns the token from a valid Bearer header", () => {
    const token = extractBearerToken("Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
    expect(token).toBe("eyJhbGciOiJIUzI1NiJ9.payload.sig");
  });

  it("returns null when the header is null", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns null when the header is an empty string", () => {
    expect(extractBearerToken("")).toBeNull();
  });

  it("returns null when the scheme is Basic instead of Bearer", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when the header has no scheme prefix", () => {
    expect(extractBearerToken("eyJhbGciOiJIUzI1NiJ9.payload.sig")).toBeNull();
  });

  it("returns null when the header is 'Bearer' with no token", () => {
    // "Bearer " prefix is present but the token part is empty string
    expect(extractBearerToken("Bearer ")).toBe("");
  });

  it("returns null when the scheme is lowercase 'bearer'", () => {
    expect(
      extractBearerToken("bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"),
    ).toBeNull();
  });

  it("preserves the full token including dots", () => {
    const raw = "header.payload.signature";
    expect(extractBearerToken(`Bearer ${raw}`)).toBe(raw);
  });
});

// ─── verifyJwt ────────────────────────────────────────────────────────────────

describe("verifyJwt", () => {
  beforeEach(async () => {
    // Reset env vars before each test
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    // Reset mock state
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockReset();
  });

  // ── Valid token ─────────────────────────────────────────────────────────────

  it("returns a JWTPayload for a valid token with role in user_metadata (Req 1.4, 1.6)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid-123",
          email: "operator@example.com",
          user_metadata: { role: "operator" },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).not.toBeNull();
    expect(result?.sub).toBe("user-uuid-123");
    expect(result?.email).toBe("operator@example.com");
    expect(result?.role).toBe("operator");
    expect(typeof result?.iat).toBe("number");
    expect(typeof result?.exp).toBe("number");
  });

  it("returns a JWTPayload for a valid token with role in app_metadata (Req 1.6)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid-456",
          email: "admin@example.com",
          user_metadata: {},
          app_metadata: { role: "admin" },
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).not.toBeNull();
    expect(result?.role).toBe("admin");
  });

  it("accepts all four valid roles (Req 1.6)", async () => {
    const mockGetUser = await getMockGetUser();
    const roles = ["operator", "qc", "ppic", "admin"] as const;

    for (const role of roles) {
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: "user-uuid",
            email: "user@example.com",
            user_metadata: { role },
            app_metadata: {},
          },
        },
        error: null,
      });

      const token = buildJwt(VALID_PAYLOAD);
      const result = await verifyJwt(token);
      expect(result?.role).toBe(role);
    }
  });

  it("decodes iat and exp from the JWT payload (Req 1.1)", async () => {
    const mockGetUser = await getMockGetUser();
    const iat = 1700000000;
    const exp = iat + 28800;

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: { role: "qc" },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt({
      sub: "user-uuid",
      email: "user@example.com",
      iat,
      exp,
    });
    const result = await verifyJwt(token);

    expect(result?.iat).toBe(iat);
    expect(result?.exp).toBe(exp);
  });

  // ── Expired / invalid token ─────────────────────────────────────────────────

  it("returns null when Supabase returns an error (expired token) (Req 1.5)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "JWT expired", status: 401 },
    });

    const token = buildJwt({ ...VALID_PAYLOAD, exp: NOW - 1 });
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  it("returns null when Supabase returns an error (invalid signature) (Req 1.4)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT", status: 401 },
    });

    const result = await verifyJwt("invalid.token.here");
    expect(result).toBeNull();
  });

  it("returns null for a completely malformed token (not a JWT) (Req 1.4)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "malformed JWT", status: 401 },
    });

    const result = await verifyJwt("not-a-jwt-at-all");
    expect(result).toBeNull();
  });

  it("returns null when the token has no payload segment (Req 1.4)", async () => {
    // A token with only one segment — no dots
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "malformed JWT", status: 401 },
    });

    const result = await verifyJwt("onlyone");
    expect(result).toBeNull();
  });

  // ── Missing role claim ──────────────────────────────────────────────────────

  it("returns null when user has no role in user_metadata or app_metadata (Req 1.7)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: {},
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  it("returns null when user_metadata.role is null (Req 1.7)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: { role: null },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  // ── Invalid role value ──────────────────────────────────────────────────────

  it("returns null when role is an unknown value (Req 1.7)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: { role: "unknown_role" },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  it("returns null when role is 'superuser' (not in valid set) (Req 1.7)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: { role: "superuser" },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  it("returns null when role is an empty string (Req 1.7)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "user@example.com",
          user_metadata: { role: "" },
          app_metadata: {},
        },
      },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  // ── Missing env vars ────────────────────────────────────────────────────────

  it("returns null when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  it("returns null when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });

  // ── Supabase returns no user ────────────────────────────────────────────────

  it("returns null when Supabase returns no error but user is null (Req 1.4)", async () => {
    const mockGetUser = await getMockGetUser();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const token = buildJwt(VALID_PAYLOAD);
    const result = await verifyJwt(token);

    expect(result).toBeNull();
  });
});
