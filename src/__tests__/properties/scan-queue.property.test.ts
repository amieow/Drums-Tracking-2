/**
 * Property-Based Tests: ScanQueue Sync Order and Retry Behavior (Property 11)
 *
 * **Validates: Requirements 7.2, 7.3, 7.4**
 *
 * Property 11: ScanQueue Sync Order and Retry Behavior
 * For any ScanQueue containing N pending scans, when network connectivity is
 * restored, the Mobile_Client SHALL:
 *   1. Submit scans in FIFO order (the order they were enqueued)
 *   2. Retry each failed submission up to 3 times (4 total attempts) at
 *      5-second intervals
 *   3. Remove successfully submitted scans from the queue
 *   4. Mark permanently failed scans without discarding other queued scans
 *
 * Test strategy:
 *   - Mock localStorage so ScanQueue works in the Node test environment
 *   - Mock global fetch to control success/failure per scan
 *   - Use fake timers to advance through 5-second retry intervals instantly
 *   - Generate N scans (1–10) via fc.integer({ min: 1, max: 10 })
 *   - Run at least 20 examples per property
 */

import * as fc from "fast-check";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { ScanQueue } from "../../lib/scan-queue";
import { SyncManager } from "../../lib/sync-manager";
import type { ItemStatus } from "../../types";

// ─── localStorage mock ────────────────────────────────────────────────────────

/**
 * A minimal in-memory localStorage implementation for Node.js tests.
 * ScanQueue reads/writes to `localStorage` directly; we replace the global
 * with this mock before each test.
 */
function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    _store: store,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES: ItemStatus[] = [
  "received",
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
];

/** Arbitrary for a single scan input (without id/retries/status). */
const scanInputArb = (index: number) => ({
  lot_id: `LOT-2024-${String(index + 1).padStart(5, "0")}`,
  target_status: "qc_pending" as ItemStatus,
  timestamp: new Date(Date.now() + index * 1000).toISOString(),
});

/**
 * Build a successful fetch mock response for the bulk-scan endpoint.
 * Returns `{ success: true, data: { results: [{ lot_id, success: true }] } }`.
 */
function makeSuccessResponse(lot_id: string): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        processed_at: new Date().toISOString(),
        results: [{ lot_id, success: true }],
      },
    }),
    text: async () => "",
  } as unknown as Response;
}

/**
 * Build a network-error fetch mock that throws (simulates transient failure).
 */
function makeNetworkError(): Promise<Response> {
  return Promise.reject(new Error("Network error"));
}

/**
 * Build a business-rule failure response (HTTP 200 but success: false in result).
 * This causes a permanent failure (no retry).
 */
function makeBusinessFailureResponse(lot_id: string): Response {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        processed_at: new Date().toISOString(),
        results: [{ lot_id, success: false, error: "INVALID_TRANSITION" }],
      },
    }),
    text: async () => "",
  } as unknown as Response;
}

/**
 * Advance fake timers by the retry interval (5 seconds) and flush all
 * pending microtasks/promises. Repeat `count` times.
 *
 * This is needed because SyncManager.delay() uses setTimeout internally,
 * and we need to advance time AND flush the promise queue for each retry.
 */
async function advanceRetryIntervals(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
  }
}

// ─── Test setup ───────────────────────────────────────────────────────────────

describe("Property 11: ScanQueue Sync Order and Retry Behavior (Req 7.2, 7.3, 7.4)", () => {
  let localStorageMock: ReturnType<typeof makeLocalStorageMock>;
  let fetchMock: MockInstance;

  beforeEach(() => {
    // Install fake timers (for setTimeout in SyncManager.delay)
    vi.useFakeTimers();

    // Install localStorage mock
    localStorageMock = makeLocalStorageMock();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });

    // Install fetch mock
    fetchMock = vi.fn();
    Object.defineProperty(globalThis, "fetch", {
      value: fetchMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Property 11a: FIFO submission order ─────────────────────────────────────

  it("Property 11a — FIFO order: scans are submitted in the order they were enqueued", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n) => {
        // Reset localStorage for each run
        localStorageMock.clear();

        const queue = new ScanQueue();
        const manager = new SyncManager(queue);

        // Enqueue N scans in order
        const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
        for (const scan of scans) {
          queue.enqueue(scan);
        }

        // Track the order of lot_ids submitted to fetch
        const submittedOrder: string[] = [];

        fetchMock.mockImplementation(
          async (_url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string) as {
              items: Array<{ lot_id: string }>;
            };
            const lot_id = body.items[0].lot_id;
            submittedOrder.push(lot_id);
            return makeSuccessResponse(lot_id);
          },
        );

        // Trigger sync (simulates network restore)
        await manager.sync();

        // Assert: scans were submitted in FIFO order (Req 7.2)
        expect(submittedOrder).toHaveLength(n);
        for (let i = 0; i < n; i++) {
          expect(submittedOrder[i]).toBe(scans[i].lot_id);
        }
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 11b: Retry ≤ 3 times per failed scan ───────────────────────────

  it("Property 11b — retry ≤ 3 times: each failed scan is retried at most 3 times (4 total attempts)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n) => {
        localStorageMock.clear();

        const queue = new ScanQueue();
        const manager = new SyncManager(queue);

        // Enqueue N scans
        const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
        for (const scan of scans) {
          queue.enqueue(scan);
        }

        // Track attempt counts per lot_id
        const attemptCounts: Record<string, number> = {};

        // All fetches fail with network errors (transient failures → triggers retries)
        fetchMock.mockImplementation(
          async (_url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string) as {
              items: Array<{ lot_id: string }>;
            };
            const lot_id = body.items[0].lot_id;
            attemptCounts[lot_id] = (attemptCounts[lot_id] ?? 0) + 1;
            return makeNetworkError();
          },
        );

        // Run sync and advance timers through all retry intervals
        // MAX_RETRIES = 3, so up to 3 retries after initial attempt = 4 total
        // Each retry waits 5 seconds, so we need to advance 3 * 5s = 15s per scan
        // But scans are processed sequentially, so we advance as the sync runs
        const syncPromise = manager.sync();
        // Advance through all possible retry intervals: n scans × 3 retries × 5s
        await advanceRetryIntervals(n * 3 + 1);
        await syncPromise;

        // Assert: each scan was attempted at most 4 times (1 initial + 3 retries) (Req 7.2)
        for (const scan of scans) {
          const attempts = attemptCounts[scan.lot_id] ?? 0;
          expect(attempts).toBeGreaterThanOrEqual(1);
          expect(attempts).toBeLessThanOrEqual(4);
        }
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 11c: Successful scans removed from queue ───────────────────────

  it("Property 11c — successful scans removed: after successful sync, queue contains no pending scans", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n) => {
        localStorageMock.clear();

        const queue = new ScanQueue();
        const manager = new SyncManager(queue);

        // Enqueue N scans
        const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
        for (const scan of scans) {
          queue.enqueue(scan);
        }

        // All fetches succeed
        fetchMock.mockImplementation(
          async (_url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string) as {
              items: Array<{ lot_id: string }>;
            };
            const lot_id = body.items[0].lot_id;
            return makeSuccessResponse(lot_id);
          },
        );

        // Trigger sync
        await manager.sync();

        // Assert: queue is empty after all scans succeed (Req 7.3)
        expect(queue.getPending()).toHaveLength(0);
        expect(queue.size()).toBe(0);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 11d: Failed scans marked, others continue ──────────────────────

  it("Property 11d — failed scans marked: after exhausting retries, scan has status=failed and other scans continue processing", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Need at least 2 scans: one that fails, one that succeeds
        fc.integer({ min: 2, max: 10 }),
        async (n) => {
          localStorageMock.clear();

          const queue = new ScanQueue();
          const manager = new SyncManager(queue);

          // Enqueue N scans
          const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
          for (const scan of scans) {
            queue.enqueue(scan);
          }

          // First scan always fails (network error, exhausts retries)
          // All other scans succeed
          const failingLotId = scans[0].lot_id;

          fetchMock.mockImplementation(
            async (_url: string, options: RequestInit) => {
              const body = JSON.parse(options.body as string) as {
                items: Array<{ lot_id: string }>;
              };
              const lot_id = body.items[0].lot_id;

              if (lot_id === failingLotId) {
                return makeNetworkError();
              }
              return makeSuccessResponse(lot_id);
            },
          );

          // Run sync and advance timers through retries for the failing scan
          const syncPromise = manager.sync();
          // The failing scan needs 3 retries × 5s = 15s of timer advancement
          await advanceRetryIntervals(4);
          await syncPromise;

          // Assert: the failing scan is marked as failed (Req 7.4)
          const allScans = queue.getAll();
          const failedScans = allScans.filter((s) => s.status === "failed");
          expect(failedScans).toHaveLength(1);
          expect(failedScans[0].lot_id).toBe(failingLotId);
          expect(typeof failedScans[0].error).toBe("string");
          expect(failedScans[0].error!.length).toBeGreaterThan(0);

          // Assert: other scans were successfully removed (Req 7.3, 7.4)
          // Only the failed scan remains in the queue
          expect(queue.size()).toBe(1);
          expect(queue.getPending()).toHaveLength(0);
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 11e: Business-rule failures are permanent (no retry) ────────────

  it("Property 11e — business-rule failures: a scan rejected by the server (success:false) is marked failed immediately without retrying", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async (n) => {
        localStorageMock.clear();

        const queue = new ScanQueue();
        const manager = new SyncManager(queue);

        // Enqueue N scans
        const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
        for (const scan of scans) {
          queue.enqueue(scan);
        }

        // Track attempt counts per lot_id
        const attemptCounts: Record<string, number> = {};

        // All fetches return business-rule failure (success: false in result)
        fetchMock.mockImplementation(
          async (_url: string, options: RequestInit) => {
            const body = JSON.parse(options.body as string) as {
              items: Array<{ lot_id: string }>;
            };
            const lot_id = body.items[0].lot_id;
            attemptCounts[lot_id] = (attemptCounts[lot_id] ?? 0) + 1;
            return makeBusinessFailureResponse(lot_id);
          },
        );

        // Trigger sync — no timer advancement needed since business failures
        // are permanent and don't trigger retries
        await manager.sync();

        // Assert: each scan was attempted exactly once (no retries for business failures)
        for (const scan of scans) {
          expect(attemptCounts[scan.lot_id]).toBe(1);
        }

        // Assert: all scans are marked as failed (Req 7.4)
        const allScans = queue.getAll();
        expect(allScans).toHaveLength(n);
        for (const s of allScans) {
          expect(s.status).toBe("failed");
          expect(typeof s.error).toBe("string");
        }
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 11f: Mixed success/failure — failed scans don't block others ────

  it("Property 11f — mixed results: failed scans are marked without discarding other queued scans", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate N where first half fail, second half succeed
        fc.integer({ min: 2, max: 8 }),
        async (n) => {
          localStorageMock.clear();

          const queue = new ScanQueue();
          const manager = new SyncManager(queue);

          // Enqueue N scans
          const scans = Array.from({ length: n }, (_, i) => scanInputArb(i));
          for (const scan of scans) {
            queue.enqueue(scan);
          }

          // First half fail (network errors), second half succeed
          const halfN = Math.floor(n / 2);
          const failingLotIds = new Set(
            scans.slice(0, halfN).map((s) => s.lot_id),
          );
          const succeedingLotIds = new Set(
            scans.slice(halfN).map((s) => s.lot_id),
          );

          fetchMock.mockImplementation(
            async (_url: string, options: RequestInit) => {
              const body = JSON.parse(options.body as string) as {
                items: Array<{ lot_id: string }>;
              };
              const lot_id = body.items[0].lot_id;

              if (failingLotIds.has(lot_id)) {
                return makeNetworkError();
              }
              return makeSuccessResponse(lot_id);
            },
          );

          // Run sync and advance timers through retries for failing scans
          const syncPromise = manager.sync();
          // Each failing scan needs 3 retries × 5s = 15s
          await advanceRetryIntervals(halfN * 3 + 1);
          await syncPromise;

          const allScans = queue.getAll();

          // Assert: failing scans are marked as failed (Req 7.4)
          const failedScans = allScans.filter((s) => s.status === "failed");
          expect(failedScans).toHaveLength(halfN);
          for (const s of failedScans) {
            expect(failingLotIds.has(s.lot_id)).toBe(true);
          }

          // Assert: succeeding scans were removed from the queue (Req 7.3)
          const remainingLotIds = new Set(allScans.map((s) => s.lot_id));
          for (const lot_id of succeedingLotIds) {
            expect(remainingLotIds.has(lot_id)).toBe(false);
          }

          // Assert: total remaining = only the failed scans (Req 7.4)
          expect(queue.size()).toBe(halfN);
          expect(queue.getPending()).toHaveLength(0);
        },
      ),
      { numRuns: 20 },
    );
  });
});
