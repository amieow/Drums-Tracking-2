/**
 * Property-Based Tests: ScanQueue Capacity and Persistence (Property 10)
 *
 * **Validates: Requirements 7.1, 7.6, 7.7**
 *
 * Property 10: ScanQueue Capacity and Persistence
 * For any sequence of offline scans up to 500, the Mobile_Client SHALL store
 * each scan in the ScanQueue (localStorage). When the 501st scan is attempted,
 * the Mobile_Client SHALL reject it and display a warning without overwriting
 * existing queued scans. Pending (non-failed) scans SHALL survive app
 * close/reopen and be restored from localStorage on next launch.
 *
 * Test strategy:
 *   - Mock localStorage using Object.defineProperty(globalThis, 'localStorage', ...)
 *   - Use fc.array(fc.record({...}), {minLength:1, maxLength:500}) for scan sequences
 *   - Property 10a: Capacity invariant — all N ≤ 500 scans are stored
 *   - Property 10b: Overflow rejection — 501st scan is rejected with a warning,
 *     existing scans are preserved unchanged
 *   - Property 10c: Persistence round-trip — after enqueuing scans, a new
 *     ScanQueue instance reads the same data from localStorage
 *   - Run at least 20 examples per property
 */

import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanQueue } from "../../lib/scan-queue";

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

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Arbitrary for a single scan input (without id/retries/status), as specified
 * in the task description.
 */
const scanItemArb = fc.record({
  lot_id: fc.string({ minLength: 1, maxLength: 20 }),
  target_status: fc.constantFrom("received" as const, "qc_pending" as const),
  timestamp: fc.constant("2024-01-01T00:00:00Z"),
});

/**
 * Arbitrary for a sequence of 1–500 scan inputs.
 */
const scanSequenceArb = fc.array(scanItemArb, {
  minLength: 1,
  maxLength: 500,
});

// ─── Test setup ───────────────────────────────────────────────────────────────

describe("Property 10: ScanQueue Capacity and Persistence (Req 7.1, 7.6, 7.7)", () => {
  let localStorageMock: ReturnType<typeof makeLocalStorageMock>;

  beforeEach(() => {
    localStorageMock = makeLocalStorageMock();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Property 10a: Capacity invariant ────────────────────────────────────────

  it("Property 10a — capacity invariant: for any sequence of N scans (1–500), all N are stored in the queue", async () => {
    await fc.assert(
      fc.asyncProperty(scanSequenceArb, async (scans) => {
        // Reset localStorage for each run
        localStorageMock.clear();

        const queue = new ScanQueue();

        // Enqueue all scans
        for (const scan of scans) {
          queue.enqueue(scan);
        }

        // Assert: all N scans are stored (Req 7.1)
        expect(queue.size()).toBe(scans.length);

        // Assert: size never exceeds 500 (Req 7.1)
        expect(queue.size()).toBeLessThanOrEqual(500);

        // Assert: all stored scans have the expected fields
        const all = queue.getAll();
        expect(all).toHaveLength(scans.length);
        for (const stored of all) {
          expect(typeof stored.id).toBe("string");
          expect(stored.id.length).toBeGreaterThan(0);
          expect(stored.retries).toBe(0);
          expect(stored.status).toBe("pending");
        }
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 10b: 501st scan rejected with warning ──────────────────────────

  it("Property 10b — overflow rejection: the 501st scan is rejected with a console.warn and existing scans are preserved", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate exactly 500 scans to fill the queue, plus one extra
        fc.array(scanItemArb, { minLength: 500, maxLength: 500 }),
        scanItemArb,
        async (first500, extraScan) => {
          localStorageMock.clear();

          const queue = new ScanQueue();

          // Fill the queue to capacity
          for (const scan of first500) {
            queue.enqueue(scan);
          }

          // Capture the state before the overflow attempt
          const snapshotBefore = queue.getAll().map((s) => s.id);
          expect(queue.size()).toBe(500);

          // Spy on console.warn to verify the warning is emitted (Req 7.7)
          const warnSpy = vi.spyOn(console, "warn");

          // Attempt to enqueue the 501st scan
          queue.enqueue(extraScan);

          // Assert: queue size is still 500 — the 501st was rejected (Req 7.7)
          expect(queue.size()).toBe(500);

          // Assert: a warning was logged (Req 7.7)
          expect(warnSpy).toHaveBeenCalledOnce();
          const warnArg = warnSpy.mock.calls[0][0] as string;
          expect(typeof warnArg).toBe("string");
          expect(warnArg.length).toBeGreaterThan(0);

          // Assert: existing scans are preserved unchanged (Req 7.7)
          const snapshotAfter = queue.getAll().map((s) => s.id);
          expect(snapshotAfter).toEqual(snapshotBefore);

          warnSpy.mockRestore();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 10c: Persistence round-trip ────────────────────────────────────

  it("Property 10c — persistence round-trip: after enqueuing scans, a new ScanQueue instance reads the same data from localStorage", async () => {
    await fc.assert(
      fc.asyncProperty(scanSequenceArb, async (scans) => {
        localStorageMock.clear();

        // First instance: enqueue scans
        const queue1 = new ScanQueue();
        for (const scan of scans) {
          queue1.enqueue(scan);
        }

        const originalScans = queue1.getAll();

        // Second instance: reads from the same localStorage (simulates app reopen)
        const queue2 = new ScanQueue();

        // Assert: size matches (Req 7.6)
        expect(queue2.size()).toBe(queue1.size());

        // Assert: all scans are restored with identical field values (Req 7.6)
        const restoredScans = queue2.getAll();
        expect(restoredScans).toHaveLength(originalScans.length);

        for (let i = 0; i < originalScans.length; i++) {
          expect(restoredScans[i].id).toBe(originalScans[i].id);
          expect(restoredScans[i].lot_id).toBe(originalScans[i].lot_id);
          expect(restoredScans[i].target_status).toBe(
            originalScans[i].target_status,
          );
          expect(restoredScans[i].timestamp).toBe(originalScans[i].timestamp);
          expect(restoredScans[i].retries).toBe(originalScans[i].retries);
          expect(restoredScans[i].status).toBe(originalScans[i].status);
        }

        // Assert: pending scans are restored as pending (Req 7.6)
        const pendingOriginal = queue1.getPending();
        const pendingRestored = queue2.getPending();
        expect(pendingRestored).toHaveLength(pendingOriginal.length);
      }),
      { numRuns: 20 },
    );
  });

  // ─── Property 10d: Existing scans preserved on overflow ──────────────────────

  it("Property 10d — existing scans preserved on overflow: when queue is full, no existing scan is modified or removed", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1–10 extra scans to attempt after filling the queue
        fc.array(scanItemArb, { minLength: 1, maxLength: 10 }),
        async (extraScans) => {
          localStorageMock.clear();

          const queue = new ScanQueue();

          // Fill the queue to exactly 500
          const fillScans = Array.from({ length: 500 }, (_, i) => ({
            lot_id: `LOT-2024-${String(i + 1).padStart(5, "0")}`,
            target_status: "qc_pending" as const,
            timestamp: "2024-01-01T00:00:00Z",
          }));
          for (const scan of fillScans) {
            queue.enqueue(scan);
          }

          // Capture deep snapshot of all scans before overflow attempts
          const snapshotBefore = JSON.parse(
            JSON.stringify(queue.getAll()),
          ) as ReturnType<typeof queue.getAll>;

          const warnSpy = vi.spyOn(console, "warn");

          // Attempt to enqueue each extra scan (all should be rejected)
          for (const extra of extraScans) {
            queue.enqueue(extra);
          }

          // Assert: queue size is still exactly 500 (Req 7.7)
          expect(queue.size()).toBe(500);

          // Assert: a warning was emitted for each rejected scan (Req 7.7)
          expect(warnSpy).toHaveBeenCalledTimes(extraScans.length);

          // Assert: every existing scan is identical to the pre-overflow snapshot (Req 7.7)
          const snapshotAfter = queue.getAll();
          expect(snapshotAfter).toHaveLength(500);
          for (let i = 0; i < 500; i++) {
            expect(snapshotAfter[i].id).toBe(snapshotBefore[i].id);
            expect(snapshotAfter[i].lot_id).toBe(snapshotBefore[i].lot_id);
            expect(snapshotAfter[i].status).toBe(snapshotBefore[i].status);
            expect(snapshotAfter[i].retries).toBe(snapshotBefore[i].retries);
          }

          warnSpy.mockRestore();
        },
      ),
      { numRuns: 20 },
    );
  });
});
