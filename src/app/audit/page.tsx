"use client";

import NavBar from "@/components/NavBar";
import { useAuth } from "@/lib/auth-context";
import type { AuditAction, AuditEntry, PaginationMeta } from "@/types";
import { useCallback, useEffect, useState } from "react";
import { Download, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuditLogResponse {
  success: boolean;
  data: AuditEntry[];
  pagination?: PaginationMeta;
  error?: { code: string; message: string };
}

interface FilterState {
  date_from: string;
  date_to: string;
  user_id: string;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  item_created: "Item Created",
  item_status_changed: "Status Changed",
  item_location_changed: "Location Changed",
  item_bulk_updated: "Bulk Updated",
  user_login: "User Login",
  user_logout: "User Logout",
  audit_exported: "Audit Exported",
  forbidden_attempt: "Forbidden Attempt",
};

const ACTION_COLORS: Record<AuditAction, { bg: string; text: string }> = {
  item_created: { bg: "#dcfce7", text: "#166534" },
  item_status_changed: { bg: "#dbeafe", text: "#1e40af" },
  item_location_changed: { bg: "#e0e7ff", text: "#3730a3" },
  item_bulk_updated: { bg: "#fef9c3", text: "#854d0e" },
  user_login: { bg: "#f0fdf4", text: "#15803d" },
  user_logout: { bg: "#fef2f2", text: "#991b1b" },
  audit_exported: { bg: "#fdf4ff", text: "#7e22ce" },
  forbidden_attempt: { bg: "#fef2f2", text: "#b91c1c" },
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function truncate(str: string | null | undefined, max = 40): string {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function ActionBadge({ action }: { action: AuditAction }) {
  const colors = ACTION_COLORS[action] ?? { bg: "#f1f5f9", text: "#475569" };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold tracking-wider whitespace-nowrap"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
      }}
    >
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td
        colSpan={8}
        className="px-6 py-12 text-center text-slate-400 text-sm"
      >
        {message}
      </td>
    </tr>
  );
}

interface PaginationProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

function Pagination({ pagination, onPageChange }: PaginationProps) {
  const { page, pages, total, limit } = pagination;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 flex-wrap gap-3">
      <span className="text-sm text-slate-500">
        {total === 0
          ? "No entries"
          : `Showing ${start}–${end} of ${total} entries`}
      </span>

      <div className="flex gap-1.5 items-center">
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="First page"
          className={cn(
            "px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors",
            page <= 1
              ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          «
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className={cn(
            "px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors",
            page <= 1
              ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          ‹
        </button>

        <span className="px-3 py-1.5 text-sm text-slate-600 font-medium">
          Page {page} of {pages || 1}
        </span>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          className={cn(
            "px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors",
            page >= pages
              ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          ›
        </button>
        <button
          onClick={() => onPageChange(pages)}
          disabled={page >= pages}
          aria-label="Last page"
          className={cn(
            "px-3 py-1.5 rounded-md border text-sm font-semibold transition-colors",
            page >= pages
              ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          »
        </button>
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [filters, setFilters] = useState<FilterState>({
    date_from: "",
    date_to: "",
    user_id: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    date_from: "",
    date_to: "",
    user_id: "",
  });

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0,
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { token } = useAuth();

  const fetchEntries = useCallback(
    async (page: number, f: FilterState) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "50");
        if (f.date_from) params.set("date_from", f.date_from);
        if (f.date_to) params.set("date_to", f.date_to);
        if (f.user_id.trim()) params.set("user_id", f.user_id.trim());

        const res = await fetch(`/api/audit-logs?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const json: AuditLogResponse = await res.json();

        if (!json.success) {
          setError(json.error?.message ?? "Failed to load audit logs.");
          setEntries([]);
          return;
        }

        setEntries(json.data ?? []);
        if (json.pagination) {
          setPagination(json.pagination);
        }
      } catch {
        setError("Network error — could not load audit logs.");
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchEntries(1, appliedFilters);
  }, []);

  const handleApply = useCallback(() => {
    setCurrentPage(1);
    setAppliedFilters(filters);
    fetchEntries(1, filters);
  }, [filters, fetchEntries]);

  const handleClear = useCallback(() => {
    const empty: FilterState = { date_from: "", date_to: "", user_id: "" };
    setFilters(empty);
    setAppliedFilters(empty);
    setCurrentPage(1);
    fetchEntries(1, empty);
  }, [fetchEntries]);

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      fetchEntries(page, appliedFilters);
    },
    [appliedFilters, fetchEntries],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      params.set("format", "csv");
      if (appliedFilters.date_from)
        params.set("date_from", appliedFilters.date_from);
      if (appliedFilters.date_to)
        params.set("date_to", appliedFilters.date_to);
      if (appliedFilters.user_id.trim())
        params.set("user_id", appliedFilters.user_id.trim());

      const res = await fetch(`/api/audit-logs/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const json = await res.json();
          setExportError(
            json?.error?.message ?? `Export failed (HTTP ${res.status}).`,
          );
        } else {
          setExportError(`Export failed (HTTP ${res.status}).`);
        }
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Network error — export failed.");
    } finally {
      setExporting(false);
    }
  }, [appliedFilters, token]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleApply();
    },
    [handleApply],
  );

  return (
    <main className="min-h-dvh bg-slate-50 text-slate-900">
      <NavBar title="Audit Log" />

      <header className="bg-white border-b px-8 py-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight m-0">
            Audit Log
          </h1>
          <p className="text-sm text-slate-500 m-0 mt-1">
            Immutable record of all system events — admin access only
          </p>
        </div>

        <Button
          onClick={handleExport}
          disabled={exporting}
          className="bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          aria-label="Export audit log as CSV"
          aria-busy={exporting}
        >
          <Download className="size-4 mr-2" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </header>

      <div className="max-w-6xl mx-auto px-8 py-6">
        {exportError && (
          <div
            className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2"
            role="alert"
            aria-live="assertive"
          >
            <XCircle className="size-4 flex-shrink-0" />
            {exportError}
            <button
              onClick={() => setExportError(null)}
              aria-label="Dismiss export error"
              className="ml-auto bg-none border-none cursor-pointer text-red-700 text-lg leading-none p-0"
            >
              ×
            </button>
          </div>
        )}

        <Card className="mb-6 border-slate-200">
          <div className="p-5">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 m-0">
              Filters
            </h2>
            <div className="flex gap-4 flex-wrap items-end">
              <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
                <label
                  htmlFor="date-from"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Date From
                </label>
                <Input
                  id="date-from"
                  type="datetime-local"
                  value={filters.date_from}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      date_from: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  className="border-slate-300"
                  aria-label="Filter from date"
                />
              </div>

              <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
                <label
                  htmlFor="date-to"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  Date To
                </label>
                <Input
                  id="date-to"
                  type="datetime-local"
                  value={filters.date_to}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      date_to: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  className="border-slate-300"
                  aria-label="Filter to date"
                />
              </div>

              <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
                <label
                  htmlFor="user-id"
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wider"
                >
                  User ID
                </label>
                <Input
                  id="user-id"
                  type="text"
                  placeholder="UUID (optional)"
                  value={filters.user_id}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      user_id: e.target.value,
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  className="border-slate-300"
                  aria-label="Filter by user ID"
                />
              </div>

              <div className="flex gap-2.5 shrink-0">
                <Button
                  onClick={handleApply}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-semibold"
                >
                  Apply
                </Button>
                <Button
                  variant="outline"
                  onClick={handleClear}
                  className="border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {error && (
          <div
            className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
            role="alert"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        <Card
          className="border-slate-200 overflow-hidden"
          aria-label="Audit log entries"
          aria-busy={loading}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {[
                    "Timestamp",
                    "Action",
                    "User Email",
                    "Item ID",
                    "Previous State",
                    "New State",
                    "IP Address",
                    "Entry ID",
                  ].map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <EmptyState message="Loading audit entries…" />
                ) : entries.length === 0 ? (
                  <EmptyState message="No audit entries found for the selected filters." />
                ) : (
                  entries.map((entry, idx) => (
                    <tr
                      key={entry.id}
                      className={cn(
                        "border-b border-slate-100",
                        idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      )}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap text-slate-700 font-mono text-xs">
                        {formatTimestamp(entry.timestamp)}
                      </td>

                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <ActionBadge action={entry.action} />
                      </td>

                      <td
                        className="px-4 py-2.5 text-slate-700 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
                        title={entry.user_email}
                      >
                        {entry.user_email}
                      </td>

                      <td
                        className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap"
                        title={entry.item_id ?? ""}
                      >
                        {entry.item_id ? truncate(entry.item_id, 12) : "—"}
                      </td>

                      <td
                        className="px-4 py-2.5 text-slate-500 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]"
                        title={entry.previous_state ?? ""}
                      >
                        {truncate(entry.previous_state, 30)}
                      </td>

                      <td
                        className="px-4 py-2.5 text-slate-700 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]"
                        title={entry.new_state ?? ""}
                      >
                        {truncate(entry.new_state, 30)}
                      </td>

                      <td className="px-4 py-2.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {entry.ip_address}
                      </td>

                      <td
                        className="px-4 py-2.5 text-slate-400 font-mono text-[11px] whitespace-nowrap"
                        title={entry.id}
                      >
                        {truncate(entry.id, 12)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && pagination.total > 0 && (
            <Pagination
              pagination={{ ...pagination, page: currentPage }}
              onPageChange={handlePageChange}
            />
          )}
        </Card>
      </div>
    </main>
  );
}