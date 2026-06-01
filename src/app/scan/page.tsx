"use client";

import NavBar from "@/components/NavBar";
import QrScanner, { type QrScannerHandle } from "@/components/QrScanner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth, useRequireAuth } from "@/lib/auth-context";
import { getAllowedTargetStatuses } from "@/lib/rbac";
import { ScanQueue } from "@/lib/scan-queue";
import { SyncManager, checkDuplicate } from "@/lib/sync-manager";
import type { ItemStatus } from "@/types/index";
import { AlertTriangle, CloudOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Label lookup derived from the existing options (value → label) so the
 * role-filtered dropdown keeps the exact same labels it had before.
 */
const TARGET_STATUS_LABELS: Record<ItemStatus, string> =
  TARGET_STATUS_OPTIONS.reduce(
    (acc, opt) => {
      acc[opt.value] = opt.label;
      return acc;
    },
    {} as Record<ItemStatus, string>,
  );

interface SessionStats {
  total: number;
  succeeded: number;
  failed: number;
}

function SummaryModal({
  stats,
  onClose,
}: {
  stats: SessionStats;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[380px] bg-slate-800 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 text-center text-xl font-bold">
            Session Complete
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 my-4">
          <div className="bg-slate-900 rounded-lg p-4 text-center border-t-2 border-slate-500">
            <div className="text-3xl font-bold text-slate-100">
              {stats.total}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">
              Total
            </div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 text-center border-t-2 border-green-500">
            <div className="text-3xl font-bold text-green-400">
              {stats.succeeded}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">
              OK
            </div>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 text-center border-t-2 border-red-500">
            <div className="text-3xl font-bold text-red-400">
              {stats.failed}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider mt-1">
              Failed
            </div>
          </div>
        </div>

        <Button
          onClick={onClose}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold"
        >
          Done
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default function ScanPage() {
  useRequireAuth();
  const { user, token } = useAuth();

  // Derive the target-status options from the caller's role so operators and
  // QC see different, role-appropriate lists (admin still sees all 8). Falls
  // back to an empty list when there is no user yet or the role grants none
  // (e.g. ppic), which renders a disabled, empty selection without crashing.
  const allowedStatuses = useMemo<ItemStatus[]>(
    () => (user ? getAllowedTargetStatuses(user.role) : []),
    [user],
  );

  const targetStatusOptions = useMemo(
    () =>
      allowedStatuses.map((value) => ({
        value,
        label: TARGET_STATUS_LABELS[value],
      })),
    [allowedStatuses],
  );

  // Empty string represents "no valid selection" until the role/options
  // resolve (or when the role has no allowed statuses).
  const [targetStatus, setTargetStatus] = useState<ItemStatus | "">("");

  // Guard: whenever the allowed list changes or the current selection is not in
  // the allowed list, reset to the first allowed status. This prevents a stale
  // default from submitting an out-of-list status. When the list is empty the
  // selection is cleared.
  useEffect(() => {
    if (allowedStatuses.length === 0) {
      if (targetStatus !== "") {
        setTargetStatus("");
      }
      return;
    }
    if (!allowedStatuses.includes(targetStatus as ItemStatus)) {
      setTargetStatus(allowedStatuses[0]);
    }
  }, [allowedStatuses, targetStatus]);

  const [stats, setStats] = useState<SessionStats>({
    total: 0,
    succeeded: 0,
    failed: 0,
  });

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const [showSummary, setShowSummary] = useState(false);
  const [scanActive, setScanActive] = useState(true);

  const scannerRef = useRef<QrScannerHandle>(null);
  const processedInSession = useRef<Set<string>>(new Set());
  const scanQueueRef = useRef<ScanQueue | null>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    const queue = new ScanQueue();
    scanQueueRef.current = queue;

    const manager = new SyncManager(queue);
    syncManagerRef.current = manager;
    manager.start();

    setOfflineQueueCount(queue.getPending().length);

    return () => {
      manager.destroy();
    };
  }, []);

  const refreshQueueCount = useCallback(() => {
    if (scanQueueRef.current) {
      setOfflineQueueCount(scanQueueRef.current.getPending().length);
    }
  }, []);

  const handleScan = useCallback(
    async (lotId: string) => {
      // No valid target status for this role/user — do not submit.
      if (targetStatus === "") {
        scannerRef.current?.reportResult(
          false,
          "No target status available for your role",
        );
        return;
      }

      const isDuplicate = checkDuplicate(lotId, processedInSession.current);
      if (isDuplicate) {
        setDuplicateWarning(
          `"${lotId}" was already scanned in this session. Duplicate ignored.`,
        );
        setTimeout(() => setDuplicateWarning(null), 3000);
        scannerRef.current?.reportResult(
          false,
          "Already scanned in this session",
        );
        return;
      }

      setDuplicateWarning(null);

      setStats((prev) => ({ ...prev, total: prev.total + 1 }));

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
          const errorText = await response.text().catch(() => "Server error");
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const json = await response.json();
        const result = json?.data?.results?.[0];

        if (result?.success) {
          setStats((prev) => ({ ...prev, succeeded: prev.succeeded + 1 }));
          scannerRef.current?.reportResult(true);
        } else {
          const errorMsg = result?.error ?? "Scan rejected";
          setStats((prev) => ({ ...prev, failed: prev.failed + 1 }));
          scannerRef.current?.reportResult(false, errorMsg);
          processedInSession.current.delete(lotId);
        }
      } catch {
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
        processedInSession.current.delete(lotId);
      }
    },
    [targetStatus, refreshQueueCount],
  );

  const handleFinish = useCallback(() => {
    setScanActive(false);
    setShowSummary(true);
  }, []);

  const handleCloseSummary = useCallback(() => {
    setShowSummary(false);
    setScanActive(true);
    setStats({ total: 0, succeeded: 0, failed: 0 });
    processedInSession.current.clear();
    setDuplicateWarning(null);
    refreshQueueCount();
  }, [refreshQueueCount]);

  return (
    <main className="min-h-dvh bg-slate-900 text-slate-100 flex flex-col">
      <NavBar title="Scan Mode" />

      <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold m-0 tracking-tight">Scan Mode</h1>
        <Button
          onClick={handleFinish}
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm px-4 py-2"
        >
          Finish
        </Button>
      </header>

      <div className="flex-1 flex flex-col items-center p-5 gap-4 overflow-y-auto">
        <div className="w-full max-w-md space-y-1.5">
          <label
            htmlFor="target-status"
            className="text-xs font-semibold text-slate-400 uppercase tracking-wider"
          >
            Target Status
          </label>
          <select
            id="target-status"
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as ItemStatus)}
            disabled={targetStatusOptions.length === 0}
            className="w-full px-4 py-2.5 rounded-lg border border-white/15 bg-slate-800 text-slate-100 text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Select target status for scanned items"
          >
            {targetStatusOptions.length === 0 ? (
              <option value="" disabled>
                No statuses available
              </option>
            ) : (
              targetStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>
        </div>

        <QrScanner
          ref={scannerRef}
          onScan={handleScan}
          active={scanActive}
          aria-label="QR code scanner"
        />

        <div
          className="w-full max-w-md grid grid-cols-3 gap-2.5"
          role="region"
          aria-label="Session summary"
        >
          <div className="bg-slate-800 rounded-lg p-3 text-center border-t-2 border-slate-500">
            <div
              className="text-[26px] font-bold leading-none text-slate-100"
              aria-label={`Total scans: ${stats.total}`}
            >
              {stats.total}
            </div>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">
              Total
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center border-t-2 border-green-500">
            <div
              className="text-[26px] font-bold leading-none text-green-400"
              aria-label={`Succeeded: ${stats.succeeded}`}
            >
              {stats.succeeded}
            </div>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">
              OK
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-3 text-center border-t-2 border-red-500">
            <div
              className="text-[26px] font-bold leading-none text-red-400"
              aria-label={`Failed: ${stats.failed}`}
            >
              {stats.failed}
            </div>
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mt-0.5">
              Failed
            </div>
          </div>
        </div>

        {offlineQueueCount > 0 && (
          <div
            className="w-full max-w-md bg-slate-800 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm text-yellow-400 border border-yellow-500/25"
            role="status"
            aria-live="polite"
            aria-label={`${offlineQueueCount} scan${offlineQueueCount !== 1 ? "s" : ""} pending offline sync`}
          >
            <CloudOff className="size-4 flex-shrink-0" />
            <span>
              <strong>{offlineQueueCount}</strong> scan
              {offlineQueueCount !== 1 ? "s" : ""} queued offline — will sync
              when connected
            </span>
          </div>
        )}

        {duplicateWarning && (
          <div
            className="w-full max-w-md bg-yellow-500/10 border border-yellow-500/40 rounded-lg px-4 py-2.5 flex items-start gap-2 text-sm text-yellow-300"
            role="alert"
            aria-live="assertive"
          >
            <AlertTriangle className="size-4 flex-shrink-0 mt-0.5" />
            <span>{duplicateWarning}</span>
          </div>
        )}
      </div>

      {showSummary && (
        <SummaryModal stats={stats} onClose={handleCloseSummary} />
      )}
    </main>
  );
}
