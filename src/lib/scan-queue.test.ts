/**
 * Unit tests for ScanQueue.
 *
 * Validates: Requirements 7.1, 7.4, 7.5, 7.7
 */

import type { QueuedScan } from "@/types/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanQueue } from "./scan-queue";

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

let localStorageMock: ReturnType<typeof makeLocalStorageMock>;

beforeEach(() => {
  localStorageMock = makeLocalStorageMock();
  // Assign to global so the ScanQueue can access it via `typeof localStorage`.
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // Remove the mock so SSR tests can verify absence.
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

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

// ─── enqueue ──────────────────────────────────────────────────────────────────

describe("enqueue", () => {
  it("adds a scan with auto-generated id, retries=0, status=pending", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());

    const all = q.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBeTruthy();
    expect(all[0].retries).toBe(0);
    expect(all[0].status).toBe("pending");
  });

  it("preserves the provided lot_id, target_status, and timestamp", () => {
    const q = new ScanQueue();
    const input = makeScanInput("LOT-2024-00042");
    q.enqueue(input);

    const scan = q.getAll()[0];
    expect(scan.lot_id).toBe("LOT-2024-00042");
    expect(scan.target_status).toBe("qc_pending");
    expect(scan.timestamp).toBe(input.timestamp);
  });

  it("persists to localStorage after enqueue", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "drums_scan_queue",
      expect.any(String),
    );
  });

  it("does NOT add a scan when the queue is full (500 items)", () => {
    const q = new ScanQueue();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 500; i++) {
      q.enqueue(makeScanInput(`LOT-2024-${String(i).padStart(5, "0")}`));
    }
    expect(q.size()).toBe(500);

    q.enqueue(makeScanInput("LOT-2024-99999"));
    expect(q.size()).toBe(500);
    expect(warnSpy).toHaveBeenCalledOnce();

    warnSpy.mockRestore();
  });

  it("logs a warning (not an error) when the queue is full", () => {
    const q = new ScanQueue();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 500; i++) {
      q.enqueue(makeScanInput(`LOT-2024-${String(i).padStart(5, "0")}`));
    }
    q.enqueue(makeScanInput("LOT-2024-99999"));

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ─── dequeue ─────────────────────────────────────────────────────────────────

describe("dequeue", () => {
  it("returns undefined when the queue is empty", () => {
    const q = new ScanQueue();
    expect(q.dequeue()).toBeUndefined();
  });

  it("returns the first pending scan (FIFO order)", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));

    const first = q.dequeue();
    expect(first?.lot_id).toBe("LOT-2024-00001");
  });

  it("removes the dequeued scan from the queue", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.dequeue();

    expect(q.size()).toBe(0);
  });

  it("persists to localStorage after dequeue", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    localStorageMock.setItem.mockClear();

    q.dequeue();

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "drums_scan_queue",
      expect.any(String),
    );
  });

  it("skips failed scans and returns the first pending one", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));

    // Mark the first scan as failed.
    const firstId = q.getAll()[0].id;
    q.markFailed(firstId, "network error");

    const dequeued = q.dequeue();
    expect(dequeued?.lot_id).toBe("LOT-2024-00002");
  });

  it("returns undefined when all scans are failed", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    const id = q.getAll()[0].id;
    q.markFailed(id, "error");

    expect(q.dequeue()).toBeUndefined();
  });
});

// ─── markFailed ──────────────────────────────────────────────────────────────

describe("markFailed", () => {
  it("sets status to failed and records the error message", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;

    q.markFailed(id, "timeout");

    const scan = q.getAll()[0];
    expect(scan.status).toBe("failed");
    expect(scan.error).toBe("timeout");
  });

  it("persists to localStorage after markFailed", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;
    localStorageMock.setItem.mockClear();

    q.markFailed(id, "error");

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "drums_scan_queue",
      expect.any(String),
    );
  });

  it("is a no-op for an unknown id", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const sizeBefore = q.size();

    expect(() => q.markFailed("non-existent-id", "error")).not.toThrow();
    expect(q.size()).toBe(sizeBefore);
  });
});

// ─── markSuccess ─────────────────────────────────────────────────────────────

describe("markSuccess", () => {
  it("removes the scan with the given id", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));
    const id = q.getAll()[0].id;

    q.markSuccess(id);

    expect(q.size()).toBe(1);
    expect(q.getAll()[0].lot_id).toBe("LOT-2024-00002");
  });

  it("persists to localStorage after markSuccess", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;
    localStorageMock.setItem.mockClear();

    q.markSuccess(id);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "drums_scan_queue",
      expect.any(String),
    );
  });

  it("is a no-op for an unknown id", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());

    expect(() => q.markSuccess("non-existent-id")).not.toThrow();
    expect(q.size()).toBe(1);
  });
});

// ─── getPending ───────────────────────────────────────────────────────────────

describe("getPending", () => {
  it("returns only scans with status=pending", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));
    q.enqueue(makeScanInput("LOT-2024-00003"));

    const ids = q.getAll().map((s) => s.id);
    q.markFailed(ids[1], "error");

    const pending = q.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.every((s) => s.status === "pending")).toBe(true);
  });

  it("returns an empty array when all scans are failed", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;
    q.markFailed(id, "error");

    expect(q.getPending()).toHaveLength(0);
  });

  it("returns an empty array when the queue is empty", () => {
    const q = new ScanQueue();
    expect(q.getPending()).toHaveLength(0);
  });
});

// ─── getAll ───────────────────────────────────────────────────────────────────

describe("getAll", () => {
  it("returns all scans regardless of status", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));
    const id = q.getAll()[0].id;
    q.markFailed(id, "error");

    const all = q.getAll();
    expect(all).toHaveLength(2);
  });

  it("returns a copy — mutations do not affect the internal state", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());

    const all = q.getAll();
    all.pop();

    expect(q.size()).toBe(1);
  });
});

// ─── size ─────────────────────────────────────────────────────────────────────

describe("size", () => {
  it("returns 0 for an empty queue", () => {
    const q = new ScanQueue();
    expect(q.size()).toBe(0);
  });

  it("increments after enqueue", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput("LOT-2024-00001"));
    q.enqueue(makeScanInput("LOT-2024-00002"));
    expect(q.size()).toBe(2);
  });

  it("decrements after dequeue", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    q.dequeue();
    expect(q.size()).toBe(0);
  });

  it("decrements after markSuccess", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;
    q.markSuccess(id);
    expect(q.size()).toBe(0);
  });

  it("does NOT decrement after markFailed (scan stays in queue)", () => {
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    const id = q.getAll()[0].id;
    q.markFailed(id, "error");
    expect(q.size()).toBe(1);
  });
});

// ─── Persistence across instances ────────────────────────────────────────────

describe("persistence across instances", () => {
  it("restores scans from localStorage on construction", () => {
    const q1 = new ScanQueue();
    q1.enqueue(makeScanInput("LOT-2024-00001"));
    q1.enqueue(makeScanInput("LOT-2024-00002"));

    // A new instance should read the same data.
    const q2 = new ScanQueue();
    expect(q2.size()).toBe(2);
    expect(q2.getAll()[0].lot_id).toBe("LOT-2024-00001");
  });

  it("starts empty when localStorage has no data", () => {
    const q = new ScanQueue();
    expect(q.size()).toBe(0);
  });

  it("starts empty when localStorage contains invalid JSON", () => {
    localStorageMock.getItem.mockReturnValueOnce("not-valid-json{{{");
    const q = new ScanQueue();
    expect(q.size()).toBe(0);
  });
});

// ─── SSR / no-localStorage environment ───────────────────────────────────────

describe("SSR / no-localStorage environment", () => {
  it("does not throw when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(() => new ScanQueue()).not.toThrow();
  });

  it("operates in-memory when localStorage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const q = new ScanQueue();
    q.enqueue(makeScanInput());
    expect(q.size()).toBe(1);
  });
});
