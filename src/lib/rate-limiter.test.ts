/**
 * Unit tests for the in-memory rate limiter.
 *
 * Validates: Requirement 1.3
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _attemptStore,
  checkRateLimit,
  recordFailedAttempt,
  resetAttempts,
} from "./rate-limiter";

/** Helper: record N failed attempts for a given IP. */
function recordN(ip: string, n: number): void {
  for (let i = 0; i < n; i++) {
    recordFailedAttempt(ip);
  }
}

beforeEach(() => {
  // Start each test with a clean store and real timers.
  _attemptStore.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── checkRateLimit ───────────────────────────────────────────────────────────

describe("checkRateLimit — no prior failures", () => {
  it("allows an IP with no recorded failures", () => {
    const result = checkRateLimit("1.2.3.4");
    expect(result).toEqual({ allowed: true });
  });
});

describe("checkRateLimit — under the threshold", () => {
  it("allows an IP with 1 failure", () => {
    recordN("1.2.3.4", 1);
    expect(checkRateLimit("1.2.3.4")).toEqual({ allowed: true });
  });

  it("allows an IP with 4 failures (one below threshold)", () => {
    recordN("1.2.3.4", 4);
    expect(checkRateLimit("1.2.3.4")).toEqual({ allowed: true });
  });
});

describe("checkRateLimit — at and above the threshold (Req 1.3)", () => {
  it("blocks an IP after exactly 5 failures within the window", () => {
    recordN("1.2.3.4", 5);
    const result = checkRateLimit("1.2.3.4");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(600);
    }
  });

  it("blocks an IP after 6 failures within the window", () => {
    recordN("1.2.3.4", 6);
    const result = checkRateLimit("1.2.3.4");
    expect(result.allowed).toBe(false);
  });

  it("returns retryAfter ≤ 600 seconds when blocked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    recordN("10.0.0.1", 5);

    // Advance 1 minute into the window.
    vi.advanceTimersByTime(60_000);

    const result = checkRateLimit("10.0.0.1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // 9 minutes remain → retryAfter should be ≤ 540 and > 0.
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(540);
    }
  });
});

describe("checkRateLimit — auto-unblock after 10-minute window (Req 1.3)", () => {
  it("allows the IP again once the 10-minute window has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    recordN("10.0.0.1", 5);

    // Advance exactly 10 minutes.
    vi.advanceTimersByTime(10 * 60 * 1000);

    const result = checkRateLimit("10.0.0.1");
    expect(result).toEqual({ allowed: true });
  });

  it("allows the IP again after more than 10 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    recordN("10.0.0.1", 5);

    // Advance 11 minutes.
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(checkRateLimit("10.0.0.1")).toEqual({ allowed: true });
  });

  it("cleans up the stale record from the store on auto-unblock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    recordN("10.0.0.1", 5);
    vi.advanceTimersByTime(10 * 60 * 1000);

    checkRateLimit("10.0.0.1");

    expect(_attemptStore.has("10.0.0.1")).toBe(false);
  });
});

// ─── recordFailedAttempt ──────────────────────────────────────────────────────

describe("recordFailedAttempt", () => {
  it("creates a new record on the first failure", () => {
    recordFailedAttempt("5.5.5.5");
    expect(_attemptStore.get("5.5.5.5")?.count).toBe(1);
  });

  it("increments the count on subsequent failures within the window", () => {
    recordN("5.5.5.5", 3);
    expect(_attemptStore.get("5.5.5.5")?.count).toBe(3);
  });

  it("resets the window when a failure arrives after the window has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));

    recordN("5.5.5.5", 3);
    const firstWindowStart = _attemptStore.get("5.5.5.5")!.windowStart;

    // Advance past the window.
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    recordFailedAttempt("5.5.5.5");

    const record = _attemptStore.get("5.5.5.5")!;
    expect(record.count).toBe(1);
    expect(record.windowStart).toBeGreaterThan(firstWindowStart);
  });
});

// ─── resetAttempts ────────────────────────────────────────────────────────────

describe("resetAttempts", () => {
  it("clears all recorded failures for the given IP", () => {
    recordN("9.9.9.9", 5);
    expect(checkRateLimit("9.9.9.9").allowed).toBe(false);

    resetAttempts("9.9.9.9");

    expect(checkRateLimit("9.9.9.9")).toEqual({ allowed: true });
    expect(_attemptStore.has("9.9.9.9")).toBe(false);
  });

  it("is a no-op for an IP with no recorded failures", () => {
    expect(() => resetAttempts("0.0.0.0")).not.toThrow();
    expect(_attemptStore.has("0.0.0.0")).toBe(false);
  });
});

// ─── Independent IP tracking ──────────────────────────────────────────────────

describe("independent IP tracking (Req 1.3)", () => {
  it("tracks different IPs independently", () => {
    recordN("192.168.1.1", 5);
    recordN("192.168.1.2", 2);

    expect(checkRateLimit("192.168.1.1").allowed).toBe(false);
    expect(checkRateLimit("192.168.1.2")).toEqual({ allowed: true });
  });

  it("resetting one IP does not affect another", () => {
    recordN("10.0.0.1", 5);
    recordN("10.0.0.2", 5);

    resetAttempts("10.0.0.1");

    expect(checkRateLimit("10.0.0.1")).toEqual({ allowed: true });
    expect(checkRateLimit("10.0.0.2").allowed).toBe(false);
  });
});

// ─── 6th attempt is blocked (Req 1.3: "more than 5 times") ───────────────────

describe("6th attempt is blocked (Req 1.3)", () => {
  it("5th attempt is still allowed, 6th is blocked", () => {
    // Attempts 1–4: allowed
    recordN("172.16.0.1", 4);
    expect(checkRateLimit("172.16.0.1")).toEqual({ allowed: true });

    // 5th failure recorded
    recordFailedAttempt("172.16.0.1");
    // Now 5 failures exist → next check should be blocked
    const result = checkRateLimit("172.16.0.1");
    expect(result.allowed).toBe(false);
  });
});
