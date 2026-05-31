/**
 * Unit tests for SyncManager and checkDuplicate helper.
 *
 * Validates: Requirements 6.9, 7.2, 7.3, 7.4
 */

import type { QueuedScan } from "@/types/index";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { ScanQueue } from "./scan-queue";
import { SyncManager, checkDuplicate } from "./sync-manager";

// ─── localStorage mock ────────────────────────────────────────────────────────

function makeLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    _reset() {
      store = {};
      this.getItem.mockClear();
      this.setItem.mockClear();
      this.removeItem.mockClear();
      this.clear.mockClear();
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScanInput(
  lot_id = "LOT-2024-00001",
): Omit<QueuedScan, "id" | "retries" | "status"> {
  return {
    lot_id,
    target_status: "qc_pending",
    timestamp: new Date().toISOString(),
  };
}

function makeSuccessResponse(lot_id: string) {
  return {
    success: true,
    data: {
      processed_at: new Date().toISOString(),
      results: [{ lot_id, success: true }],
    },
  };
}

function makeFailureResponse(lot_id: string, error = "INVALID_TRANSITION") {
  return {
    success: true,
    data: {
      processed_at: new Date().toISOString(),
      results: [{ lot_id, success: false, error }],
    },
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let localStorageMock: ReturnType<typeof makeLocalStorageMock>;
let fetchMock: MockInstance;

beforeEach(() => {
  localStorageMock = makeLocalStorageMock();
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });

  // Default fetch mock — returns success for any lot_id.
  fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        items: Array<{ lot_id: string }>;
      };
      const lot_id = body.items[0].lot_id;
      return new Response(JSON.stringify(makeSuccessResponse(lot_id)), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    });

  // Suppress console.warn noise in tests.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

// ─── checkDuplicate (standalone helper) ──────────────────────────────────────

describe("checkDuplicate", () => {
  it("returns false and adds lot_id to the set when not a duplicate", () => {
    const set = new Set<string>();
    const result = checkDuplicate("LOT-2024-00001", set);

    expect(result).toBe(false);
    expect(set.has("LOT-2024-00001")).toBe(true);
  });

  it("returns true when lot_id is already in the set", () => {
    const set = new Set<string>(["LOT-2024-00001"]);
    const result = checkDuplicate("LOT-2024-00001", set);

    expect(result).toBe(true);
  });

  it("does NOT add the lot_id again when it is a duplicate", () => {
    const set = new Set<string>(["LOT-2024-00001"]);
    checkDuplicate("LOT-2024-00001", set);

    expect(set.size).toBe(1);
  });

  it("logs a warning when a duplicate is detected", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = new Set<string>(["LOT-2024-00001"]);

    checkDuplicate("LOT-2024-00001", set);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("LOT-2024-00001");
  });

  it("does NOT log a warning for a new lot_id", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const set = new Set<string>();

    checkDuplicate("LOT-2024-00001", set);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("treats different lot_ids independently", () => {
    const set = new Set<string>();

    expect(checkDuplicate("LOT-2024-00001", set)).toBe(false);
    expect(checkDuplicate("LOT-2024-00002", set)).toBe(false);
    expect(checkDuplicate("LOT-2024-00001", set)).toBe(true); // duplicate
    expect(checkDuplicate("LOT-2024-00002", set)).toBe(true); // duplicate
    expect(set.size).toBe(2);
  });
});

// ─── SyncManager.isProcessedInSession ────────────────────────────────────────

describe("isProcessedInSession", () => {
  it("returns false for a lot_id not yet processed", () => {
    const queue = new ScanQueue();
    const manager = new SyncManager(queue);

    expect(manager.isProcessedInSession("LOT-2024-00001")).toBe(false);
  });

  it("returns true after the lot_id has been synced successfully", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(manager.isProcessedInSession("LOT-2024-00001")).toBe(true);
  });
});

// ─── SyncManager.clearSession ─────────────────────────────────────────────────

describe("clearSession", () => {
  it("clears all tracked lot_ids from the session", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(manager.isProcessedInSession("LOT-2024-00001")).toBe(true);

    manager.clearSession();

    expect(manager.isProcessedInSession("LOT-2024-00001")).toBe(false);
  });

  it("allows the same lot_id to be processed again after clearSession", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));

    const manager = new SyncManager(queue);
    await manager.sync();

    manager.clearSession();

    // Re-enqueue and sync again — should NOT be treated as duplicate.
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    await manager.sync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── Duplicate scan detection in sync() ──────────────────────────────────────

describe("duplicate scan detection during sync", () => {
  it("does NOT submit a scan whose lot_id was already processed in the session", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00001")); // duplicate

    const manager = new SyncManager(queue);
    await manager.sync();

    // fetch should only be called once — the duplicate is skipped.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs a warning when a duplicate scan is skipped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00001")); // duplicate

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("LOT-2024-00001");
  });

  it("removes the duplicate scan from the queue without submitting it", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00001")); // duplicate

    const manager = new SyncManager(queue);
    await manager.sync();

    // Both scans should be gone from the queue after sync.
    expect(queue.size()).toBe(0);
  });

  it("continues processing other scans after skipping a duplicate", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00001")); // duplicate
    queue.enqueue(makeScanInput("LOT-2024-00002")); // different lot_id

    const manager = new SyncManager(queue);
    await manager.sync();

    // fetch called for LOT-2024-00001 and LOT-2024-00002 (not the duplicate).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queue.size()).toBe(0);
  });
});

// ─── Sync — successful submission ────────────────────────────────────────────

describe("sync — successful submission", () => {
  it("submits all pending scans in FIFO order", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00002"));
    queue.enqueue(makeScanInput("LOT-2024-00003"));

    const submittedLotIds: string[] = [];
    fetchMock.mockImplementation(async (_, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        items: Array<{ lot_id: string }>;
      };
      const lot_id = body.items[0].lot_id;
      submittedLotIds.push(lot_id);
      return new Response(JSON.stringify(makeSuccessResponse(lot_id)), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    });

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(submittedLotIds).toEqual([
      "LOT-2024-00001",
      "LOT-2024-00002",
      "LOT-2024-00003",
    ]);
  });

  it("removes successfully synced scans from the queue", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00002"));

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(queue.size()).toBe(0);
  });

  it("adds successfully synced lot_ids to processedInSession", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00002"));

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(manager.isProcessedInSession("LOT-2024-00001")).toBe(true);
    expect(manager.isProcessedInSession("LOT-2024-00002")).toBe(true);
  });
});

// ─── Sync — retry behavior ────────────────────────────────────────────────────

describe("sync — retry behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed scan up to 3 times before marking it failed", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));

    // Always return a network error.
    fetchMock.mockRejectedValue(new Error("Network error"));

    const manager = new SyncManager(queue);
    const syncPromise = manager.sync();

    // Advance timers for each retry interval (3 retries × 5 s).
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await syncPromise;

    // 1 initial attempt + 3 retries = 4 total calls.
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Scan should be marked failed in the queue.
    const all = queue.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("failed");
  });

  it("does not retry after a successful submission", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));

    // Succeed on first attempt.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeSuccessResponse("LOT-2024-00001")), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const manager = new SyncManager(queue);
    await manager.sync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("continues processing other scans after one permanently fails", async () => {
    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001")); // will fail
    queue.enqueue(makeScanInput("LOT-2024-00002")); // should succeed

    let callCount = 0;
    fetchMock.mockImplementation(async (_, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        items: Array<{ lot_id: string }>;
      };
      const lot_id = body.items[0].lot_id;
      callCount++;

      if (lot_id === "LOT-2024-00001") {
        throw new Error("Network error");
      }
      return new Response(JSON.stringify(makeSuccessResponse(lot_id)), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    });

    const manager = new SyncManager(queue);
    const syncPromise = manager.sync();

    // Advance through all retries for the first scan.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
    }
    await syncPromise;

    // LOT-2024-00001 should be failed, LOT-2024-00002 should be removed.
    const all = queue.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].lot_id).toBe("LOT-2024-00001");
    expect(all[0].status).toBe("failed");
  });
});

// ─── SyncManager.destroy ──────────────────────────────────────────────────────

describe("destroy", () => {
  it("does not throw when called", () => {
    const queue = new ScanQueue();
    const manager = new SyncManager(queue);
    expect(() => manager.destroy()).not.toThrow();
  });
});

// ─── Online event triggers sync ───────────────────────────────────────────────

describe("online event triggers sync", () => {
  it("submits all pending scans when the online event fires", async () => {
    // Set up a window-like environment with event listener support.
    const listeners: Record<string, EventListener[]> = {};
    const windowMock = {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = (listeners[event] ?? []).filter(
          (h) => h !== handler,
        );
      }),
    };
    Object.defineProperty(globalThis, "window", {
      value: windowMock,
      writable: true,
      configurable: true,
    });

    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00002"));

    const manager = new SyncManager(queue);
    manager.start();

    // Verify the listener was registered.
    expect(windowMock.addEventListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );

    // Fire the online event and wait for the async sync to complete.
    const onlineHandlers = listeners["online"] ?? [];
    expect(onlineHandlers).toHaveLength(1);

    // Trigger the handler and flush all microtasks.
    onlineHandlers[0](new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both scans should have been submitted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(queue.size()).toBe(0);

    manager.destroy();

    // Verify the listener was removed.
    expect(windowMock.removeEventListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );

    // Restore window.
    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("processes scans in FIFO order when triggered by the online event", async () => {
    const listeners: Record<string, EventListener[]> = {};
    const windowMock = {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = listeners[event] ?? [];
        listeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis, "window", {
      value: windowMock,
      writable: true,
      configurable: true,
    });

    const queue = new ScanQueue();
    queue.enqueue(makeScanInput("LOT-2024-00001"));
    queue.enqueue(makeScanInput("LOT-2024-00002"));
    queue.enqueue(makeScanInput("LOT-2024-00003"));

    const submittedOrder: string[] = [];
    fetchMock.mockImplementation(async (_, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        items: Array<{ lot_id: string }>;
      };
      const lot_id = body.items[0].lot_id;
      submittedOrder.push(lot_id);
      return new Response(JSON.stringify(makeSuccessResponse(lot_id)), {
        status: 207,
        headers: { "Content-Type": "application/json" },
      });
    });

    const manager = new SyncManager(queue);
    manager.start();

    const onlineHandlers = listeners["online"] ?? [];
    onlineHandlers[0](new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(submittedOrder).toEqual([
      "LOT-2024-00001",
      "LOT-2024-00002",
      "LOT-2024-00003",
    ]);

    manager.destroy();

    Object.defineProperty(globalThis, "window", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });
});
