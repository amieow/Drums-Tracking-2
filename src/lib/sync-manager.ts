/**
 * SyncManager — offline-to-online sync orchestrator for the mobile PWA.
 *
 * Listens for the browser `online` event and, on reconnection, submits all
 * pending scans from the ScanQueue to `POST /api/items/bulk-scan` in FIFO
 * order — one scan per request. Each failed scan is retried up to 3 times
 * (4 total attempts) at 5-second intervals before being permanently marked
 * as failed.
 *
 * Duplicate scan detection is handled via an in-memory `Set<string>` that
 * tracks every `lot_id` successfully processed in the current Scan Mode
 * session. Before submitting a scan, `checkDuplicate` is called; if the
 * `lot_id` is already in the set the scan is skipped with a warning and is
 * NOT submitted to the server.
 *
 * Handles SSR environments gracefully by skipping event listener registration
 * when `window` is not available.
 *
 * Validates: Requirements 6.9, 7.2, 7.3, 7.4, 7.6
 */

import type { QueuedScan } from "@/types/index";
import { ScanQueue } from "./scan-queue";

// ─── Constants ────────────────────────────────────────────────────────────────

const BULK_SCAN_ENDPOINT = "/api/items/bulk-scan";
/** Maximum number of retry attempts after the initial submission. */
const MAX_RETRIES = 3;
const RETRY_INTERVAL_MS = 5_000;

// ─── API response shapes ──────────────────────────────────────────────────────

interface BulkScanResultItem {
  lot_id: string;
  success: boolean;
  error?: string;
}

interface BulkScanApiResponse {
  success: true;
  data: {
    processed_at?: string;
    results: BulkScanResultItem[];
  };
}

// ─── Standalone helper ────────────────────────────────────────────────────────

/**
 * Check whether `lot_id` has already been processed in the current session.
 *
 * - If `lot_id` is **not** in `processedSet`: adds it and returns `false`.
 * - If `lot_id` **is** already in `processedSet`: logs a warning and returns `true`.
 *
 * @param lot_id       The lot ID to check.
 * @param processedSet The in-memory set of already-processed lot IDs.
 * @returns `true` if this is a duplicate, `false` if it is new.
 */
export function checkDuplicate(
  lot_id: string,
  processedSet: Set<string>,
): boolean {
  if (processedSet.has(lot_id)) {
    console.warn(
      `[SyncManager] Duplicate scan detected for lot_id "${lot_id}" — skipping.`,
    );
    return true;
  }
  processedSet.add(lot_id);
  return false;
}

// ─── SyncManager ─────────────────────────────────────────────────────────────

export class SyncManager {
  private readonly queue: ScanQueue;
  private readonly authToken: string | undefined;
  private readonly onlineHandler: () => void;
  /** Tracks lot_ids successfully processed in the current Scan Mode session. */
  private readonly processedInSession: Set<string> = new Set();
  private isSyncing = false;

  /**
   * @param queue      The ScanQueue instance to read pending scans from.
   * @param authToken  Optional Bearer token forwarded in the Authorization header.
   */
  constructor(queue: ScanQueue, authToken?: string) {
    this.queue = queue;
    this.authToken = authToken;
    // Bind once so the same reference can be removed in stop() / destroy().
    this.onlineHandler = () => {
      this.sync().catch((err) => {
        console.error("[SyncManager] Unhandled error during sync:", err);
      });
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start listening for the browser `online` event. No-op in SSR. */
  start(): void {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.onlineHandler);
  }

  /** Stop listening for the browser `online` event. No-op in SSR. */
  stop(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.onlineHandler);
  }

  /**
   * Alias for `stop()` — removes event listeners and cleans up resources.
   * Provided for components that prefer a `destroy` lifecycle method.
   */
  destroy(): void {
    this.stop();
  }

  // ─── Session helpers ────────────────────────────────────────────────────────

  /**
   * Returns `true` if `lot_id` was successfully processed in the current
   * Scan Mode session.
   */
  isProcessedInSession(lot_id: string): boolean {
    return this.processedInSession.has(lot_id);
  }

  /**
   * Clears the in-memory session set so the next Scan Mode session starts
   * with a clean slate.
   */
  clearSession(): void {
    this.processedInSession.clear();
  }

  // ─── Sync ───────────────────────────────────────────────────────────────────

  /**
   * Manually trigger a sync cycle.
   *
   * Dequeues all pending scans in FIFO order and submits each one
   * individually to `POST /api/items/bulk-scan`. Duplicate lot_ids (already
   * processed in this session) are skipped and removed from the queue.
   * Failed submissions are retried up to MAX_RETRIES times at
   * RETRY_INTERVAL_MS intervals; scans that exhaust retries are permanently
   * marked as failed.
   *
   * Concurrent calls are coalesced — if a sync is already in progress the
   * second call returns immediately.
   */
  async sync(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      await this.runSyncCycle();
    } finally {
      this.isSyncing = false;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Core sync loop — processes each pending scan one at a time in FIFO order.
   */
  private async runSyncCycle(): Promise<void> {
    // Snapshot the pending scans at the start of the cycle.
    const pending = this.queue.getPending();
    if (pending.length === 0) return;

    for (const scan of pending) {
      // ── Duplicate check ──────────────────────────────────────────────────
      if (checkDuplicate(scan.lot_id, this.processedInSession)) {
        // Already processed in this session — skip without submitting.
        // Remove from queue so it doesn't block future syncs.
        this.queue.markSuccess(scan.id);
        // lot_id was already added to processedInSession by checkDuplicate
        // (it returned false, meaning it was new and has been added).
        continue;
      }

      // ── Submit with retries ──────────────────────────────────────────────
      const submitted = await this.submitWithRetries(scan);

      if (submitted) {
        this.queue.markSuccess(scan.id);
        // lot_id was already added to processedInSession by checkDuplicate
        // (it returned false, meaning it was new and has been added).
      }
      // If not submitted, markFailed was already called inside submitWithRetries.
    }
  }

  /**
   * Submit a single scan to the API, retrying on transient failures.
   *
   * Returns `true` if the scan was accepted by the server, `false` if it
   * was permanently rejected (business-rule error or exhausted retries).
   */
  private async submitWithRetries(scan: QueuedScan): Promise<boolean> {
    let lastError = "Unknown error";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.delay(RETRY_INTERVAL_MS);
      }

      try {
        const result = await this.submitScan(scan);

        if (result.success) {
          return true;
        }

        // Business-rule failure — permanent, do not retry.
        const error = result.error ?? "Scan rejected by server";
        this.queue.markFailed(scan.id, error);
        return false;
      } catch (networkError) {
        lastError =
          networkError instanceof Error
            ? networkError.message
            : "Network error";
        // Transient failure — continue to next attempt.
      }
    }

    // Exhausted all retries.
    this.queue.markFailed(scan.id, lastError);
    return false;
  }

  /**
   * Perform a single HTTP POST for one scan.
   *
   * Returns the per-item result from the API response.
   * Throws on network errors or non-2xx HTTP responses.
   */
  private async submitScan(
    scan: QueuedScan,
  ): Promise<{ success: boolean; error?: string }> {
    const body = {
      items: [
        {
          lot_id: scan.lot_id,
          target_status: scan.target_status,
          timestamp: scan.timestamp,
        },
      ],
    };

    const response = await fetch(BULK_SCAN_ENDPOINT, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "HTTP error");
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const json = (await response.json()) as BulkScanApiResponse;
    const result = json.data?.results?.[0];

    if (!result) {
      throw new Error("Empty results from server");
    }

    return { success: result.success, error: result.error };
  }

  /** Build the HTTP headers for the bulk-scan request. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /** Promise-based delay helper. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
