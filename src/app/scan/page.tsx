"use client";

/**
 * Scan Mode Page — `/scan`
 *
 * Provides the mobile operator interface for bulk QR scanning:
 *  - Target status selector (operator picks which status to transition items to)
 *  - QrScanner component (camera stays open throughout the session)
 *  - Session summary counter (total / succeeded / failed)
 *  - Duplicate scan warning (Req 6.9)
 *  - Offline queue count indicator (Req 7.5)
 *  - "Finish" button that exits Scan Mode and shows a session summary modal
 *
 * Requirements: 6.1–6.3, 6.7, 6.9, 7.5
 */

import QrScanner, { type QrScannerHandle } from "@/components/QrScanner";
import { useAuth, useRequireAuth } from "@/lib/auth-context";
import { ScanQueue } from "@/lib/scan-queue";
import { SyncManager, checkDuplicate } from "@/lib/sync-manager";
import type { ItemStatus } from "@/types/index";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Status options the operator can select as the scan target. */
const TARGET_STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: "qc_pending", label: "QC Pending" },
  { value: "qc_pass", label: "QC Pass" },
  { value: "qc_fail", label: "QC Fail" },
  { value: "in_production", label: "In Production" },
  { value: "finished", label: "Finished" },
  { value: "cold_storage", label: "Cold Storage" },
  { value: "dispatched", label: "Dispatched" },
  { value: "archived", label: "Archived" },
];

// ─── Session state ────────────────────────────────────────────────────────────

interface SessionStats {
  total: number;
  succeeded: number;
  failed: number;
}

// ─── Styles (inline — no Tailwind dependency assumed) ─────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
    padding: "0 0 env(safe-area-inset-bottom)",
  },
  header: {
    padding: "16px 20px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.01em",
  },
  finishBtn: {
    padding: "8px 18px",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "16px 20px",
    gap: 16,
    overflowY: "auto" as const,
  },
  selectorLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: 6,
    display: "block",
  },
  selectorWrapper: {
    width: "100%",
    maxWidth: 480,
  },
  select: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.15)",
    backgroundColor: "#1e293b",
    color: "#f1f5f9",
    fontSize: 15,
    fontWeight: 500,
    appearance: "none" as const,
    cursor: "pointer",
    outline: "none",
  },
  statsRow: {
    width: "100%",
    maxWidth: 480,
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },
  statCard: (color: string) => ({
    backgroundColor: "#1e293b",
    borderRadius: 10,
    padding: "10px 12px",
    textAlign: "center" as const,
    borderTop: `3px solid ${color}`,
  }),
  statValue: {
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  statLabel: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  offlineBadge: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#fbbf24",
    border: "1px solid rgba(251,191,36,0.25)",
  },
  duplicateWarning: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "rgba(234,179,8,0.12)",
    border: "1px solid rgba(234,179,8,0.4)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#fde047",
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  // Modal overlay
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 28,
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 20,
    textAlign: "center" as const,
  },
  modalStatsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
    marginBottom: 24,
  },
  modalStatCard: (color: string) => ({
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: "14px 10px",
    textAlign: "center" as const,
    borderTop: `3px solid ${color}`,
  }),
  modalStatValue: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1,
  },
  modalStatLabel: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  modalCloseBtn: {
    width: "100%",
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  },
} as const;

// ─── Session Summary Modal ────────────────────────────────────────────────────

interface SummaryModalProps {
  stats: SessionStats;
  onClose: () => void;
}

function SummaryModal({ stats, onClose }: SummaryModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-title"
      style={styles.modalOverlay}
    >
      <div style={styles.modalCard}>
        <h2 id="summary-title" style={styles.modalTitle}>
          Session Complete
        </h2>

        <div style={styles.modalStatsGrid}>
          <div style={styles.modalStatCard("#64748b")}>
            <div style={styles.modalStatValue}>{stats.total}</div>
            <div style={styles.modalStatLabel}>Total</div>
          </div>
          <div style={styles.modalStatCard("#22c55e")}>
            <div style={{ ...styles.modalStatValue, color: "#4ade80" }}>
              {stats.succeeded}
            </div>
            <div style={styles.modalStatLabel}>OK</div>
          </div>
          <div style={styles.modalStatCard("#ef4444")}>
            <div style={{ ...styles.modalStatValue, color: "#f87171" }}>
              {stats.failed}
            </div>
            <div style={styles.modalStatLabel}>Failed</div>
          </div>
        </div>

        <button
          style={styles.modalCloseBtn}
          onClick={onClose}
          aria-label="Close session summary"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ScanPage() {
  // ── Auth guard — redirects to /login if not authenticated ─────────────────
  useRequireAuth();
  const { token } = useAuth();

  // ── Target status ──────────────────────────────────────────────────────────
  const [targetStatus, setTargetStatus] = useState<ItemStatus>("qc_pending");

  // ── Session stats ──────────────────────────────────────────────────────────
  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    succeeded: 0,
    failed: 0,
  });

  // ── Duplicate warning ──────────────────────────────────────────────────────
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // ── Offline queue count ────────────────────────────────────────────────────
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  // ── Finish / summary modal ─────────────────────────────────────────────────
  const [showSummary, setShowSummary] = useState(false);
  const [scanActive, setScanActive] = useState(true);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const scannerRef = useRef<QrScannerHandle>(null);
  /** In-memory set of lot_ids successfully processed in this session. */
  const processedInSession = useRef<Set<string>>(new Set());
  const scanQueueRef = useRef<ScanQueue | null>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  /** Keep a stable ref to the current auth token for use inside callbacks. */
  const tokenRef = useRef<string | null>(null);

  // Keep tokenRef in sync with the context token
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // ── Initialise ScanQueue + SyncManager (client-side only) ─────────────────
  useEffect(() => {
    const queue = new ScanQueue();
    scanQueueRef.current = queue;

    const manager = new SyncManager(queue);
    syncManagerRef.current = manager;
    manager.start();

    // Seed initial offline count
    setOfflineQueueCount(queue.getPending().length);

    return () => {
      manager.destroy();
    };
  }, []);

  // ── Refresh offline queue count whenever it might change ──────────────────
  const refreshQueueCount = useCallback(() => {
    if (scanQueueRef.current) {
      setOfflineQueueCount(scanQueueRef.current.getPending().length);
    }
  }, []);

  // ── Handle a decoded QR scan ───────────────────────────────────────────────
  const handleScan = useCallback(
    async (lotId: string) => {
      // ── Duplicate detection (Req 6.9) ──────────────────────────────────────
      const isDuplicate = checkDuplicate(lotId, processedInSession.current);
      if (isDuplicate) {
        setDuplicateWarning(
          `"${lotId}" was already scanned in this session. Duplicate ignored.`,
        );
        // Auto-clear warning after 3 s
        setTimeout(() => setDuplicateWarning(null), 3000);
        // Report error to scanner overlay so operator gets visual/audio feedback
        scannerRef.current?.reportResult(
          false,
          "Already scanned in this session",
        );
        return;
      }

      // Clear any previous duplicate warning
      setDuplicateWarning(null);

      // Increment total immediately so the counter updates before the request
      setStats((prev) => ({ ...prev, total: prev.total + 1 }));

      // ── Submit to API ──────────────────────────────────────────────────────
      try {
        const response = await fetch("/api/items/bulk-scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(tokenRef.current
              ? { Authorization: `Bearer ${tokenRef.current}` }
              : {}),
          },
          body: JSON.stringify({
            items: [
              {
                lot_id: lotId,
                target_status: targetStatus,
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        });

        if (!response.ok) {
          // Non-2xx — treat as failure
          const errorText = await response.text().catch(() => "Server error");
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const json = await response.json();
        const result = json?.data?.results?.[0];

        if (result?.success) {
          // ── Success path ─────────────────────────────────────────────────
          setStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
          scannerRef.current?.reportResult(true);
        } else {
          // ── Business-rule failure ────────────────────────────────────────
          const errorMsg = result?.error ?? "Scan rejected";
          setStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
          scannerRef.current?.reportResult(false, errorMsg);
          // Remove from session set so operator can retry after fixing the issue
          processedInSession.current.delete(lotId);
        }
      } catch {
        // ── Network / offline path — queue the scan ────────────────────────
        if (scanQueueRef.current) {
          scanQueueRef.current.enqueue({
            lot_id: lotId,
            target_status: targetStatus,
            timestamp: new Date().toISOString(),
          });
          refreshQueueCount();
        }
        setStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
        scannerRef.current?.reportResult(false, "Offline — scan queued");
        // Remove from session set so it can be retried when online
        processedInSession.current.delete(lotId);
      }
    },
    [targetStatus, refreshQueueCount],
  );

  // ── Finish button handler (Req 6.7) ───────────────────────────────────────
  const handleFinish = useCallback(() => {
    setScanActive(false);
    setShowSummary(true);
  }, []);

  // ── Close summary and reset session ───────────────────────────────────────
  const handleCloseSummary = useCallback(() => {
    setShowSummary(false);
    setScanActive(true);
    setStats({ total: 0, succeeded: 0, failed: 0 });
    processedInSession.current.clear();
    setDuplicateWarning(null);
    refreshQueueCount();
  }, [refreshQueueCount]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page} aria-label="Scan Mode">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <h1 style={styles.title}>Scan Mode</h1>
        <button
          style={styles.finishBtn}
          onClick={handleFinish}
          aria-label="Finish scan session and view summary"
        >
          Finish
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={styles.body}>
        {/* Target status selector */}
        <div style={styles.selectorWrapper}>
          <label htmlFor="target-status" style={styles.selectorLabel}>
            Target Status
          </label>
          <select
            id="target-status"
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as ItemStatus)}
            style={styles.select}
            aria-label="Select target status for scanned items"
          >
            {TARGET_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* QR Scanner */}
        <QrScanner
          ref={scannerRef}
          onScan={handleScan}
          active={scanActive}
          aria-label="QR code scanner"
        />

        {/* Session stats */}
        <div style={styles.statsRow} role="region" aria-label="Session summary">
          <div style={styles.statCard("#64748b")}>
            <div
              style={styles.statValue}
              aria-label={`Total scans: ${stats.total}`}
            >
              {stats.total}
            </div>
            <div style={styles.statLabel}>Total</div>
          </div>
          <div style={styles.statCard("#22c55e")}>
            <div
              style={{ ...styles.statValue, color: "#4ade80" }}
              aria-label={`Succeeded: ${stats.succeeded}`}
            >
              {stats.succeeded}
            </div>
            <div style={styles.statLabel}>OK</div>
          </div>
          <div style={styles.statCard("#ef4444")}>
            <div
              style={{ ...styles.statValue, color: "#f87171" }}
              aria-label={`Failed: ${stats.failed}`}
            >
              {stats.failed}
            </div>
            <div style={styles.statLabel}>Failed</div>
          </div>
        </div>

        {/* Offline queue count indicator (Req 7.5) */}
        {offlineQueueCount > 0 && (
          <div
            style={styles.offlineBadge}
            role="status"
            aria-live="polite"
            aria-label={`${offlineQueueCount} scan${offlineQueueCount !== 1 ? "s" : ""} pending offline sync`}
          >
            {/* Cloud-offline icon */}
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A5 5 0 1 0 18 10h-1.26A8 8 0 0 0 3.11 7.11" />
            </svg>
            <span>
              <strong>{offlineQueueCount}</strong> scan
              {offlineQueueCount !== 1 ? "s" : ""} queued offline — will sync
              when connected
            </span>
          </div>
        )}

        {/* Duplicate scan warning (Req 6.9) */}
        {duplicateWarning && (
          <div
            style={styles.duplicateWarning}
            role="alert"
            aria-live="assertive"
          >
            {/* Warning icon */}
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{duplicateWarning}</span>
          </div>
        )}
      </div>

      {/* ── Session Summary Modal (Req 6.7) ────────────────────────────────── */}
      {showSummary && (
        <SummaryModal stats={stats} onClose={handleCloseSummary} />
      )}
    </main>
  );
}
