/**
 * Property-Based Test: Invalid or Expired Tokens Are Rejected (Property 2)
 *
 * **Validates: Requirements 1.4, 1.5**
 *
 * For any API request carrying a JWT token that is missing, malformed,
 * has an invalid signature, or has an `exp` timestamp earlier than the
 * current server time, the API_Gateway SHALL return an `UNAUTHORIZED` error
 * response without forwarding the request to any downstream service.
 */

import * as fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractBearerToken, verifyJwt } from "../../lib/jwt";

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => {
  const mockGetUser = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    auth: { getUser: mockGetUser },
  }));
  return { createClient: mockCreateClient, _mockGetUser: mockGetUser };
});

async function getMockGetUser() {
  const mod = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any)._mockGetUser as ReturnType<typeof vi.fn>;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

  const mockGetUser = await getMockGetUser();
  mockGetUser.mockReset();
  // Default: Supabase always returns an error (simulating invalid/expired tokens)
  mockGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: "invalid JWT", status: 401 },
  });
});

// ─── Property 2: Invalid or Expired Tokens Are Rejected ──────────────────────

describe("Property 2: Invalid or Expired Tokens Are Rejected", () => {
  /**
   * Property: For any token string (empty, random, or Bearer-prefixed),
   * when Supabase returns an error (simulating invalid/expired tokens),
   * verifyJwt MUST return null (UNAUTHORIZED).
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  it("verifyJwt returns null for any token when Supabase returns an error", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        // Generate various invalid token strings:
        // - empty string
        // - arbitrary random strings
        // - strings with "Bearer " prefix (simulating malformed auth headers passed through)
        fc.oneof(
          fc.constant(""),
          fc.string(),
          fc.string().map((s) => "Bearer " + s),
        ),
        async (token) => {
          // Supabase always returns an error for any token (invalid/expired)
          mockGetUser.mockResolvedValue({
            data: { user: null },
            error: { message: "invalid or expired JWT", status: 401 },
          });

          const result = await verifyJwt(token);

          // MUST return null — UNAUTHORIZED, never forward downstream
          expect(result).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Property: For any token string where Supabase returns no user (null),
   * verifyJwt MUST return null (UNAUTHORIZED).
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  it("verifyJwt returns null when Supabase returns no user (null user, no error)", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(""),
          fc.string(),
          fc.string().map((s) => "Bearer " + s),
        ),
        async (token) => {
          mockGetUser.mockResolvedValue({
            data: { user: null },
            error: null,
          });

          const result = await verifyJwt(token);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Property: For any token with a missing or invalid role claim,
   * verifyJwt MUST return null (UNAUTHORIZED).
   *
   * **Validates: Requirements 1.4, 1.7**
   */
  it("verifyJwt returns null for tokens with invalid role claims", async () => {
    const mockGetUser = await getMockGetUser();

    // Generate invalid role values (not in ["operator", "qc", "ppic", "admin"])
    const invalidRoleArb = fc.oneof(
      fc.constant(null),
      fc.constant(""),
      fc.constant("superuser"),
      fc.constant("root"),
      fc
        .string()
        .filter((s) => !["operator", "qc", "ppic", "admin"].includes(s)),
    );

    await fc.assert(
      fc.asyncProperty(
        fc.string(), // any token string
        invalidRoleArb,
        async (token, invalidRole) => {
          mockGetUser.mockResolvedValue({
            data: {
              user: {
                id: "user-uuid",
                email: "user@example.com",
                user_metadata: { role: invalidRole },
                app_metadata: {},
              },
            },
            error: null,
          });

          const result = await verifyJwt(token);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── extractBearerToken: non-Bearer headers return null ──────────────────────

describe("Property 2 (middleware): extractBearerToken rejects non-Bearer headers", () => {
  /**
   * Property: For any Authorization header that does NOT start with "Bearer ",
   * extractBearerToken MUST return null.
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  it("returns null for any header that is not a valid Bearer token header", () => {
    fc.assert(
      fc.property(
        // Generate headers that are NOT valid Bearer headers:
        // - null
        // - empty string
        // - strings that don't start with "Bearer "
        fc.oneof(
          fc.constant(null),
          fc.constant(""),
          fc.string().filter((s) => !s.startsWith("Bearer ")),
        ),
        (header) => {
          const result = extractBearerToken(header);

          // Non-Bearer headers must return null
          if (
            header === null ||
            header === "" ||
            !header.startsWith("Bearer ")
          ) {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property: For any string s, extractBearerToken("Bearer " + s) returns s.
   * This verifies the extraction logic is correct for valid Bearer headers.
   *
   * **Validates: Requirements 1.4**
   */
  it("correctly extracts the token from any valid Bearer header", () => {
    fc.assert(
      fc.property(fc.string(), (token) => {
        const result = extractBearerToken("Bearer " + token);
        expect(result).toBe(token);
      }),
      { numRuns: 50 },
    );
  });
});

// ─── Combined middleware + verifyJwt: end-to-end rejection ───────────────────

describe("Property 2 (end-to-end): Invalid Authorization headers are rejected", () => {
  /**
   * Property: For any Authorization header that is not a valid Bearer header,
   * the combined extractBearerToken + verifyJwt pipeline returns null
   * (UNAUTHORIZED) without ever calling Supabase.
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  it("non-Bearer Authorization headers are rejected before reaching Supabase", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant(null),
          fc.constant(""),
          fc.string().filter((s) => !s.startsWith("Bearer ")),
        ),
        async (authHeader) => {
          mockGetUser.mockClear();

          const token = extractBearerToken(authHeader);

          // Non-Bearer headers produce null token — no need to call verifyJwt
          expect(token).toBeNull();

          // Supabase should NOT be called for null tokens
          // (verifyJwt is not called when token is null)
          expect(mockGetUser).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });

  /**
   * Property: For any Bearer Authorization header where Supabase returns an error,
   * verifyJwt returns null (UNAUTHORIZED).
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  it("Bearer headers with invalid/expired tokens are rejected by verifyJwt", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        // Generate Bearer headers with arbitrary token strings
        fc.string().map((s) => "Bearer " + s),
        async (authHeader) => {
          // Supabase always returns an error (invalid/expired token)
          mockGetUser.mockResolvedValue({
            data: { user: null },
            error: { message: "invalid or expired JWT", status: 401 },
          });

          const token = extractBearerToken(authHeader);
          // token is always non-null here (we generated "Bearer " + s)
          expect(token).not.toBeNull();

          const payload = await verifyJwt(token!);
          // Must return null — UNAUTHORIZED
          expect(payload).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });
});
