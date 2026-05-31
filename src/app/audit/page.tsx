"use client";

/**
 * Audit Log Viewer Page — `/audit`
 *
 * Admin-only page for browsing and exporting the immutable audit log.
 *
 * Features:
 *  - Date range filters (date_from / date_to)
 *  - Paginated table of AuditEntry records (50 per page)
 *  - CSV export button that triggers GET /api/audit-logs/export?format=csv
 *
 * Requirements: 10.4, 10.5, 10.6, 10.7
 */

import { useAuth } from "@/lib/auth-context";
import type { AuditAction, AuditEntry, PaginationMeta } from "@/types";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#f8fafc",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#0f172a",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "20px 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap" as const,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "#0f172a",
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: "#64748b",
  },
  exportBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 18px",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    transition: "background-color 0.15s",
    flexShrink: 0,
  },
  exportBtnDisabled: {
    backgroundColor: "#94a3b8",
    cursor: "not-allowed",
  },
  body: {
    padding: "24px 32px",
    maxWidth: 1400,
    margin: "0 auto",
  },
  filterCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 24,
  },
  filterTitle: {
    margin: "0 0 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  filterRow: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    flex: "1 1 200px",
    minWidth: 180,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  filterInput: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  filterActions: {
    display: "flex",
    gap: 10,
    alignItems: "flex-end",
    flexShrink: 0,
  },
  applyBtn: {
    padding: "8px 20px",
    borderRadius: 8,
    border: "none",
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  clearBtn: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontWeight: 500,
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
} as const;

// ─── Helper: format ISO timestamp ────────────────────────────────────────────

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

// ─── Helper: truncate long strings ───────────────────────────────────────────

function truncate(str: string | null | undefined, max = 40): string {
  if (!str) return "—";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

// ─── Action Badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: AuditAction }) {
  const colors = ACTION_COLORS[action] ?? { bg: "#f1f5f9", text: "#475569" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        backgroundColor: colors.bg,
        color: colors.text,
        whiteSpace: "nowrap",
      }}
    >
      {ACTION_LABELS[action] ?? action}
    </span>
  );
}

// ─── Empty / Error / Loading states ──────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <tr>
      <td
        colSpan={8}
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 14,
        }}
      >
        {message}
      </td>
    </tr>
  );
}

// ─── Pagination Controls ──────────────────────────────────────────────────────

interface PaginationProps {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
}

function Pagination({ pagination, onPageChange }: PaginationProps) {
  const { page, pages, total, limit } = pagination;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        borderTop: "1px solid #e2e8f0",
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 13, color: "#64748b" }}>
        {total === 0
          ? "No entries"
          : `Showing ${start}–${end} of ${total} entries`}
      </span>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="First page"
          style={paginationBtnStyle(page <= 1)}
        >
          «
        </button>
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          style={paginationBtnStyle(page <= 1)}
        >
          ‹
        </button>

        <span
          style={{
            fontSize: 13,
            color: "#475569",
            padding: "0 8px",
            fontWeight: 500,
          }}
        >
          Page {page} of {pages || 1}
        </span>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          style={paginationBtnStyle(page >= pages)}
        >
          ›
        </button>
        <button
          onClick={() => onPageChange(pages)}
          disabled={page >= pages}
          aria-label="Last page"
          style={paginationBtnStyle(page >= pages)}
        >
          »
        </button>
      </div>
    </div>
  );
}

function paginationBtnStyle(disabled: boolean) {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    backgroundColor: disabled ? "#f8fafc" : "#ffffff",
    color: disabled ? "#cbd5e1" : "#475569",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1,
  };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AuditPage() {
  // ── Filter state ───────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterState>({
    date_from: "",
    date_to: "",
    user_id: "",
  });
  // Applied filters (only updated when user clicks Apply)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    date_from: "",
    date_to: "",
    user_id: "",
  });

  // ── Data state ─────────────────────────────────────────────────────────────
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

  // ── Export state ───────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { token } = useAuth();

  // ── Fetch audit log entries ────────────────────────────────────────────────
  const fetchEntries = useCallback(async (page: number, f: FilterState) => {
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
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchEntries(1, appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Apply filters ──────────────────────────────────────────────────────────
  const handleApply = useCallback(() => {
    setCurrentPage(1);
    setAppliedFilters(filters);
    fetchEntries(1, filters);
  }, [filters, fetchEntries]);

  // ── Clear filters ──────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    const empty: FilterState = { date_from: "", date_to: "", user_id: "" };
    setFilters(empty);
    setAppliedFilters(empty);
    setCurrentPage(1);
    fetchEntries(1, empty);
  }, [fetchEntries]);

  // ── Page change ────────────────────────────────────────────────────────────
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      fetchEntries(page, appliedFilters);
    },
    [appliedFilters, fetchEntries],
  );

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      params.set("format", "csv");
      if (appliedFilters.date_from)
        params.set("date_from", appliedFilters.date_from);
      if (appliedFilters.date_to) params.set("date_to", appliedFilters.date_to);
      if (appliedFilters.user_id.trim())
        params.set("user_id", appliedFilters.user_id.trim());

      const res = await fetch(`/api/audit-logs/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        // Try to parse JSON error body
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

      // Trigger browser download
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
  }, [appliedFilters]);

  // ── Handle Enter key in filter inputs ─────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleApply();
    },
    [handleApply],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <main style={styles.page} aria-label="Audit Log Viewer">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Audit Log</h1>
          <p style={styles.subtitle}>
            Immutable record of all system events — admin access only
          </p>
        </div>

        {/* CSV Export Button */}
        <button
          style={{
            ...styles.exportBtn,
            ...(exporting ? styles.exportBtnDisabled : {}),
          }}
          onClick={handleExport}
          disabled={exporting}
          aria-label="Export audit log as CSV"
          aria-busy={exporting}
        >
          {/* Download icon */}
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </header>

      <div style={styles.body}>
        {/* ── Export Error ────────────────────────────────────────────────── */}
        {exportError && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {exportError}
            <button
              onClick={() => setExportError(null)}
              aria-label="Dismiss export error"
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#b91c1c",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* ── Filter Card ─────────────────────────────────────────────────── */}
        <section style={styles.filterCard} aria-label="Filter audit log">
          <h2 style={styles.filterTitle}>Filters</h2>
          <div style={styles.filterRow}>
            {/* Date From */}
            <div style={styles.filterGroup}>
              <label htmlFor="date-from" style={styles.filterLabel}>
                Date From
              </label>
              <input
                id="date-from"
                type="datetime-local"
                value={filters.date_from}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, date_from: e.target.value }))
                }
                onKeyDown={handleKeyDown}
                style={styles.filterInput}
                aria-label="Filter from date"
              />
            </div>

            {/* Date To */}
            <div style={styles.filterGroup}>
              <label htmlFor="date-to" style={styles.filterLabel}>
                Date To
              </label>
              <input
                id="date-to"
                type="datetime-local"
                value={filters.date_to}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, date_to: e.target.value }))
                }
                onKeyDown={handleKeyDown}
                style={styles.filterInput}
                aria-label="Filter to date"
              />
            </div>

            {/* User ID */}
            <div style={styles.filterGroup}>
              <label htmlFor="user-id" style={styles.filterLabel}>
                User ID
              </label>
              <input
                id="user-id"
                type="text"
                placeholder="UUID (optional)"
                value={filters.user_id}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, user_id: e.target.value }))
                }
                onKeyDown={handleKeyDown}
                style={styles.filterInput}
                aria-label="Filter by user ID"
              />
            </div>

            {/* Action buttons */}
            <div style={styles.filterActions}>
              <button
                onClick={handleApply}
                style={styles.applyBtn}
                aria-label="Apply filters"
              >
                Apply
              </button>
              <button
                onClick={handleClear}
                style={styles.clearBtn}
                aria-label="Clear all filters"
              >
                Clear
              </button>
            </div>
          </div>
        </section>

        {/* ── Query Error ─────────────────────────────────────────────────── */}
        {error && (
          <div
            role="alert"
            aria-live="polite"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: 8,
              color: "#b91c1c",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* ── Audit Table ─────────────────────────────────────────────────── */}
        <section
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            overflow: "hidden",
          }}
          aria-label="Audit log entries"
          aria-busy={loading}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
              aria-label="Audit log table"
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
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
                      style={{
                        padding: "10px 16px",
                        textAlign: "left",
                        fontWeight: 600,
                        color: "#475569",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        whiteSpace: "nowrap",
                      }}
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
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        backgroundColor: idx % 2 === 0 ? "#ffffff" : "#fafafa",
                      }}
                    >
                      {/* Timestamp */}
                      <td
                        style={{
                          padding: "10px 16px",
                          whiteSpace: "nowrap",
                          color: "#334155",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {formatTimestamp(entry.timestamp)}
                      </td>

                      {/* Action */}
                      <td
                        style={{ padding: "10px 16px", whiteSpace: "nowrap" }}
                      >
                        <ActionBadge action={entry.action} />
                      </td>

                      {/* User Email */}
                      <td
                        style={{
                          padding: "10px 16px",
                          color: "#334155",
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.user_email}
                      >
                        {entry.user_email}
                      </td>

                      {/* Item ID */}
                      <td
                        style={{
                          padding: "10px 16px",
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: "#64748b",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.item_id ?? ""}
                      >
                        {entry.item_id ? truncate(entry.item_id, 12) : "—"}
                      </td>

                      {/* Previous State */}
                      <td
                        style={{
                          padding: "10px 16px",
                          color: "#64748b",
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "monospace",
                          fontSize: 11,
                        }}
                        title={entry.previous_state ?? ""}
                      >
                        {truncate(entry.previous_state, 30)}
                      </td>

                      {/* New State */}
                      <td
                        style={{
                          padding: "10px 16px",
                          color: "#334155",
                          maxWidth: 160,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "monospace",
                          fontSize: 11,
                        }}
                        title={entry.new_state ?? ""}
                      >
                        {truncate(entry.new_state, 30)}
                      </td>

                      {/* IP Address */}
                      <td
                        style={{
                          padding: "10px 16px",
                          color: "#64748b",
                          fontFamily: "monospace",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {entry.ip_address}
                      </td>

                      {/* Entry ID */}
                      <td
                        style={{
                          padding: "10px 16px",
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: "#94a3b8",
                          whiteSpace: "nowrap",
                        }}
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

          {/* ── Pagination ─────────────────────────────────────────────────── */}
          {!loading && pagination.total > 0 && (
            <Pagination
              pagination={{ ...pagination, page: currentPage }}
              onPageChange={handlePageChange}
            />
          )}
        </section>
      </div>
    </main>
  );
}
