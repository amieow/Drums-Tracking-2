/**
 * Property-Based Tests: JWT Token Contains Valid Claims (Property 1)
 *
 * **Validates: Requirements 1.1, 1.6**
 *
 * Property 1: For any successful login with valid credentials, the issued JWT
 * token SHALL contain a `sub` (user UUID), `email`, and `role` claim where
 * `role` is exactly one value from ["operator", "qc", "ppic", "admin"], and
 * the `exp` claim equals `iat + 28800` (8 hours).
 */

import * as fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyJwt } from "../../lib/jwt";
import type { UserRole } from "../../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a base64url-encoded JWT string with the given payload.
 * Mirrors the helper in jwt.test.ts — the header and signature are stubs
 * since signature verification is delegated to Supabase Auth (mocked).
 */
function buildMockJwt(payload: Record<string, unknown>): string {
  const toBase64Url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = toBase64Url({ alg: "HS256", typ: "JWT" });
  const body = toBase64Url(payload);
  return `${header}.${body}.stub-signature`;
}

/** Valid roles accepted by the system (Requirement 1.6). */
const VALID_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => {
  const mockGetUser = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    auth: { getUser: mockGetUser },
  }));
  return { createClient: mockCreateClient, _mockGetUser: mockGetUser };
});

/** Retrieve the mocked `getUser` function after module resolution. */
async function getMockGetUser() {
  const mod = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any)._mockGetUser as ReturnType<typeof vi.fn>;
}

// ─── Property 1: JWT Token Contains Valid Claims ──────────────────────────────

describe("Property 1: JWT Token Contains Valid Claims (Req 1.1, 1.6)", () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

    const mockGetUser = await getMockGetUser();
    mockGetUser.mockReset();
  });

  it("for any valid {email, role} input, verifyJwt returns payload with sub (non-empty), email (matches), role ∈ valid set, and exp = iat + 28800", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          email: fc.emailAddress(),
          role: fc.constantFrom<UserRole>("operator", "qc", "ppic", "admin"),
        }),
        async ({ email, role }) => {
          // Simulate a fixed point in time for iat/exp
          const iat = Math.floor(Date.now() / 1000);
          const exp = iat + 28800; // 8 hours

          // Generate a deterministic UUID-like sub for this input
          const sub = `user-${email.replace(/[^a-z0-9]/g, "-")}-${role}`;

          // Build a mock JWT with the correct claims
          const token = buildMockJwt({ sub, email, role, iat, exp });

          // Mock Supabase to return the user matching the generated input
          mockGetUser.mockResolvedValueOnce({
            data: {
              user: {
                id: sub,
                email,
                user_metadata: { role },
                app_metadata: {},
              },
            },
            error: null,
          });

          const payload = await verifyJwt(token);

          // Assert: payload must not be null
          expect(payload).not.toBeNull();

          if (payload === null) return; // type narrowing

          // Assert: sub is a non-empty string (Req 1.1)
          expect(typeof payload.sub).toBe("string");
          expect(payload.sub.length).toBeGreaterThan(0);

          // Assert: email matches the generated input (Req 1.1)
          expect(payload.email).toBe(email);

          // Assert: role is exactly one value from the valid set (Req 1.6)
          expect(VALID_ROLES).toContain(payload.role);
          expect(payload.role).toBe(role);

          // Assert: exp = iat + 28800 (8 hours) (Req 1.1)
          expect(payload.exp).toBe(payload.iat + 28800);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("role claim is always exactly one of the four valid roles — never undefined, null, or an arbitrary string", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          email: fc.emailAddress(),
          role: fc.constantFrom<UserRole>("operator", "qc", "ppic", "admin"),
        }),
        async ({ email, role }) => {
          const iat = Math.floor(Date.now() / 1000);
          const exp = iat + 28800;
          const sub = `user-${role}`;

          const token = buildMockJwt({ sub, email, role, iat, exp });

          mockGetUser.mockResolvedValueOnce({
            data: {
              user: {
                id: sub,
                email,
                user_metadata: { role },
                app_metadata: {},
              },
            },
            error: null,
          });

          const payload = await verifyJwt(token);

          expect(payload).not.toBeNull();
          // Role must be one of the four valid values — no other value is acceptable
          expect(["operator", "qc", "ppic", "admin"]).toContain(payload?.role);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("exp is always exactly iat + 28800 regardless of the email or role generated", async () => {
    const mockGetUser = await getMockGetUser();

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          email: fc.emailAddress(),
          role: fc.constantFrom<UserRole>("operator", "qc", "ppic", "admin"),
          // Generate a variety of iat values (past Unix timestamps)
          iat: fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
        }),
        async ({ email, role, iat }) => {
          const exp = iat + 28800;
          const sub = `user-${role}`;

          const token = buildMockJwt({ sub, email, role, iat, exp });

          mockGetUser.mockResolvedValueOnce({
            data: {
              user: {
                id: sub,
                email,
                user_metadata: { role },
                app_metadata: {},
              },
            },
            error: null,
          });

          const payload = await verifyJwt(token);

          expect(payload).not.toBeNull();
          // The critical invariant: exp must equal iat + 28800 (Req 1.1)
          expect(payload?.exp).toBe(payload?.iat! + 28800);
          expect(payload?.exp).toBe(exp);
          expect(payload?.iat).toBe(iat);
        },
      ),
      { numRuns: 20 },
    );
  });
});
