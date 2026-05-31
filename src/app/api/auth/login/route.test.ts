/**
 * Unit tests for POST /api/auth/login
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */

import { _attemptStore } from "@/lib/rate-limiter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────

vi.mock("@supabase/supabase-js", () => {
  const mockSignInWithPassword = vi.fn();
  const mockCreateClient = vi.fn(() => ({
    auth: { signInWithPassword: mockSignInWithPassword },
  }));
  return {
    createClient: mockCreateClient,
    _mockSignIn: mockSignInWithPassword,
  };
});

// ─── Mock rate-limiter ────────────────────────────────────────────────────────

vi.mock("@/lib/rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limiter")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(() => ({ allowed: true })),
    recordFailedAttempt: vi.fn(),
    resetAttempts: vi.fn(),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getMockSignIn() {
  const mod = await import("@supabase/supabase-js");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any)._mockSignIn as ReturnType<typeof vi.fn>;
}

async function getRateLimiterMocks() {
  const mod = await import("@/lib/rate-limiter");
  return {
    checkRateLimit: mod.checkRateLimit as ReturnType<typeof vi.fn>,
    recordFailedAttempt: mod.recordFailedAttempt as ReturnType<typeof vi.fn>,
    resetAttempts: mod.resetAttempts as ReturnType<typeof vi.fn>,
  };
}

function makeRequest(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  _attemptStore.clear();

  const mockSignIn = await getMockSignIn();
  mockSignIn.mockReset();

  const { checkRateLimit, recordFailedAttempt, resetAttempts } =
    await getRateLimiterMocks();
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true });
  vi.mocked(recordFailedAttempt).mockReset();
  vi.mocked(resetAttempts).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — valid credentials (Req 1.1, 1.2)", () => {
  it("returns 200 with token and user object on valid credentials", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid-123",
          email: "operator@example.com",
          user_metadata: { role: "operator" },
          app_metadata: {},
        },
        session: {
          access_token: "mock-jwt-token",
        },
      },
      error: null,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "operator@example.com", password: "password123" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toBe("mock-jwt-token");
    expect(body.data.user.id).toBe("user-uuid-123");
    expect(body.data.user.email).toBe("operator@example.com");
    expect(body.data.user.role).toBe("operator");
  });

  it("returns user with role from app_metadata when user_metadata has no role", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: {
        user: {
          id: "admin-uuid",
          email: "admin@example.com",
          user_metadata: {},
          app_metadata: { role: "admin" },
        },
        session: {
          access_token: "admin-jwt-token",
        },
      },
      error: null,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "admin@example.com", password: "adminpass" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.user.role).toBe("admin");
  });

  it("resets rate limit attempts on successful login", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "qc@example.com",
          user_metadata: { role: "qc" },
          app_metadata: {},
        },
        session: { access_token: "token" },
      },
      error: null,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const { resetAttempts } = await getRateLimiterMocks();

    const req = new NextRequest(
      makeRequest({ email: "qc@example.com", password: "pass" }),
    );
    await POST(req);

    expect(vi.mocked(resetAttempts)).toHaveBeenCalledWith("1.2.3.4");
  });
});

describe("POST /api/auth/login — invalid credentials (Req 1.2)", () => {
  it("returns 401 AUTH_FAILED when Supabase returns an error", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "wrong@example.com", password: "wrongpass" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_FAILED");
  });

  it("returns 401 AUTH_FAILED when user has no valid system role", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: {
        user: {
          id: "user-uuid",
          email: "norole@example.com",
          user_metadata: {},
          app_metadata: {},
        },
        session: { access_token: "token" },
      },
      error: null,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "norole@example.com", password: "pass" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_FAILED");
  });

  it("records a failed attempt when credentials are invalid", async () => {
    const mockSignIn = await getMockSignIn();
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials", status: 400 },
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const { recordFailedAttempt } = await getRateLimiterMocks();

    const req = new NextRequest(
      makeRequest({ email: "bad@example.com", password: "bad" }),
    );
    await POST(req);

    expect(vi.mocked(recordFailedAttempt)).toHaveBeenCalledWith("1.2.3.4");
  });
});

describe("POST /api/auth/login — rate limited (Req 1.3)", () => {
  it("returns 429 RATE_LIMITED when IP is blocked", async () => {
    const { checkRateLimit } = await getRateLimiterMocks();
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfter: 540,
    });

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "user@example.com", password: "pass" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("does not call Supabase when IP is rate limited", async () => {
    const { checkRateLimit } = await getRateLimiterMocks();
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      retryAfter: 300,
    });

    const mockSignIn = await getMockSignIn();

    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "user@example.com", password: "pass" }),
    );
    await POST(req);

    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login — input validation (Req 1.1)", () => {
  it("returns 400 INVALID_INPUT when email is missing", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest({ password: "pass" }));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when password is missing", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest({ email: "user@example.com" }));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when email is an empty string", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(makeRequest({ email: "", password: "pass" }));
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when password is an empty string", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      makeRequest({ email: "user@example.com", password: "" }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 INVALID_INPUT when body is not valid JSON", async () => {
    const { POST } = await import("./route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "1.2.3.4",
        },
        body: "not-json",
      }),
    );
    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });
});
