/**
 * ScanQueue — localStorage-backed offline scan buffer for the mobile PWA.
 *
 * Persists scans under the key `drums_scan_queue` and provides FIFO access
 * with a hard cap of 500 entries. Handles SSR environments gracefully by
 * treating localStorage as unavailable.
 */

import type { QueuedScan } from "@/types/index";

const STORAGE_KEY = "drums_scan_queue";
const MAX_QUEUE_SIZE = 500;

export class ScanQueue {
  private scans: QueuedScan[];

  constructor() {
    this.scans = this.load();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Returns the localStorage instance if available, or null in SSR/non-browser environments. */
  private getStorage(): Storage | null {
    try {
      // eslint-disable-next-line no-restricted-globals
      if (typeof localStorage !== "undefined" && localStorage !== null) {
        return localStorage;
      }
    } catch {
      // Access to localStorage can throw in some environments (e.g., sandboxed iframes).
    }
    return null;
  }

  /** Read the queue from localStorage. Returns an empty array on any failure. */
  private load(): QueuedScan[] {
    const storage = this.getStorage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedScan[]) : [];
    } catch {
      return [];
    }
  }

  /** Persist the current in-memory queue to localStorage. */
  private save(): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.scans));
    } catch {
      // Quota exceeded or other storage error — silently ignore.
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add a new scan to the end of the queue.
   *
   * Auto-assigns a UUID v4 `id`, sets `retries = 0` and `status = "pending"`.
   * If the queue already holds 500 entries the scan is dropped and a warning
   * is logged to the console.
   */
  enqueue(scan: Omit<QueuedScan, "id" | "retries" | "status">): void {
    if (this.scans.length >= MAX_QUEUE_SIZE) {
      console.warn(
        `[ScanQueue] Queue is full (${MAX_QUEUE_SIZE} items). Scan for lot_id "${scan.lot_id}" was not added.`,
      );
      return;
    }

    const queued: QueuedScan = {
      ...scan,
      id: crypto.randomUUID(),
      retries: 0,
      status: "pending",
    };

    this.scans.push(queued);
    this.save();
  }

  /**
   * Remove and return the first pending scan (FIFO).
   * Returns `undefined` when there are no pending scans.
   */
  dequeue(): QueuedScan | undefined {
    const index = this.scans.findIndex((s) => s.status === "pending");
    if (index === -1) return undefined;

    const [scan] = this.scans.splice(index, 1);
    this.save();
    return scan;
  }

  /**
   * Mark a scan as failed and record the error message.
   * No-op if no scan with the given `id` exists.
   */
  markFailed(id: string, error: string): void {
    const scan = this.scans.find((s) => s.id === id);
    if (!scan) return;

    scan.status = "failed";
    scan.error = error;
    this.save();
  }

  /**
   * Remove a successfully synced scan from the queue.
   * No-op if no scan with the given `id` exists.
   */
  markSuccess(id: string): void {
    const index = this.scans.findIndex((s) => s.id === id);
    if (index === -1) return;

    this.scans.splice(index, 1);
    this.save();
  }

  /** Return all scans with `status === "pending"`. */
  getPending(): QueuedScan[] {
    return this.scans.filter((s) => s.status === "pending");
  }

  /** Return every scan in the queue regardless of status. */
  getAll(): QueuedScan[] {
    return [...this.scans];
  }

  /** Return the total number of scans in the queue. */
  size(): number {
    return this.scans.length;
  }
}
