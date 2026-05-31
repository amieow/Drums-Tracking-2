/**
 * In-Memory Rate Limiter for Login Endpoint
 *
 * Tracks failed login attempts per IP address. After 5 failures within a
 * 10-minute window, the IP is blocked for the remainder of that window.
 * The block auto-expires once the 10-minute window from the first failure
 * has elapsed.
 *
 * Validates: Requirement 1.3
 */

/** Duration of the rate-limit window in milliseconds (10 minutes). */
const WINDOW_MS = 10 * 60 * 1000; // 600 000 ms

/** Maximum number of failed attempts allowed within the window. */
const MAX_FAILURES = 5;

interface AttemptRecord {
  /** Timestamp (ms) of the first failed attempt in the current window. */
  windowStart: number;
  /** Number of failed attempts recorded within the current window. */
  count: number;
}

/**
 * In-memory store: IP address → attempt record.
 *
 * Exported for testing purposes only — do not mutate directly in production
 * code.
 */
export const _attemptStore = new Map<string, AttemptRecord>();

/**
 * Check whether the given IP is currently allowed to attempt a login.
 *
 * @param ip - The client IP address (e.g. from `x-forwarded-for` or
 *             `request.ip`).
 * @returns `{ allowed: true }` when the IP has not exceeded the failure
 *          threshold, or `{ allowed: false, retryAfter: <seconds> }` when it
 *          is blocked, where `retryAfter` is the number of whole seconds until
 *          the window expires and the block is lifted.
 */
export function checkRateLimit(
  ip: string,
): { allowed: true } | { allowed: false; retryAfter: number } {
  const now = Date.now();
  const record = _attemptStore.get(ip);

  if (!record) {
    // No prior failures — allow.
    return { allowed: true };
  }

  const windowAge = now - record.windowStart;

  if (windowAge >= WINDOW_MS) {
    // The window has expired — clear the stale record and allow.
    _attemptStore.delete(ip);
    return { allowed: true };
  }

  if (record.count >= MAX_FAILURES) {
    // Still within the window and over the threshold — block.
    const retryAfter = Math.ceil((WINDOW_MS - windowAge) / 1000);
    return { allowed: false, retryAfter };
  }

  // Within the window but under the threshold — allow.
  return { allowed: true };
}

/**
 * Record a failed login attempt for the given IP.
 *
 * Call this after a login attempt fails with invalid credentials. If no
 * existing window is active (or the previous window has expired), a new
 * window is started.
 *
 * @param ip - The client IP address.
 */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = _attemptStore.get(ip);

  if (!record || now - record.windowStart >= WINDOW_MS) {
    // Start a fresh window.
    _attemptStore.set(ip, { windowStart: now, count: 1 });
  } else {
    // Increment within the existing window.
    record.count += 1;
  }
}

/**
 * Clear all recorded failed attempts for the given IP.
 *
 * Call this after a successful login so that a previously-failing IP is not
 * penalised for earlier mistakes once it authenticates correctly.
 *
 * @param ip - The client IP address.
 */
export function resetAttempts(ip: string): void {
  _attemptStore.delete(ip);
}
