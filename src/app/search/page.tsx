"use client";

/**
 * Global Search Page — `/search`
 *
 * Allows any authenticated staff member to search for a drum by its Lot ID
 * or internal UUID and view its full lifecycle history in reverse chronological
 * order.
 *
 * - Search input calls `GET /api/search?q=`
 * - Displays item details: lot_id, material_type, supplier, intake_date,
 *   current_status, location_zone
 * - Displays full history array (action, previous_state, new_state, user_id,
 *   timestamp) in reverse chronological order (Req 9.5)
 *
 * Requirements: 9.1, 9.5
 */

import type { AuditAction, Item, ItemHistoryEntry, ItemStatus } from "@/types";
import { useAuth } from "@/lib/auth-context";
import { useCallback, useRef, useState } from "react";

// ─── Status badge colours ─────────────────────────────────────────────────────

const STATUS_COLOURS: Record<ItemStatus, { bg: string; text: string }> = {
  received: { bg: "#1e3a5f", text: "#93c5fd" },
  qc_pending: { bg: "#3b2f00", text: "#fde68a" },
  qc_pass: { bg: "#14532d", text: "#86efac" },
  qc_fail: { bg: "#450a0a", text: "#fca5a5" },
  in_production: { bg: "#312e81", text: "#c4b5fd" },
  finished: { bg: "#064e3b", text: "#6ee7b7" },
  cold_storage: { bg: "#0c4a6e", text: "#7dd3fc" },
  dispatched: { bg: "#1c1917", text: "#d6d3d1" },
  archived: { bg: "#1c1917", text: "#78716c" },
};

// ─── Action label map ─────────────────────────────────────────────────────────

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

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    padding: "20px 24px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 4px",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    fontSize: 13,
    color: "#94a3b8",
    margin: 0,
  },
  body: {
    flex: 1,
    padding: "24px",
    maxWidth: 800,
    width: "100%",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column" as const,
    gap: 24,
  },
  searchRow: {
    display: "flex",
    gap: 10,
    alignItems: "stretch",
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    backgroundColor: "#1e293b",
    color: "#f1f5f9",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  },
  searchBtn: (loading: boolean) => ({
    padding: "12px 22px",
    borderRadius: 10,
    border: "none",
    backgroundColor: loading ? "#1e40af" : "#3b82f6",
    color: "#fff",
    fontWeight: 600,
    fontSize: 15,
    cursor: loading ? "not-allowed" : "pointer",
    flexShrink: 0,
    opacity: loading ? 0.7 : 1,
    transition: "background-color 0.15s",
  }),
  // Error banner
  errorBanner: {
    backgroundColor: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: 10,
    padding: "12px 16px",
    color: "#fca5a5",
    fontSize: 14,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  },
  // Item card
  itemCard: {
    backgroundColor: "#1e293b",
    borderRadius: 14,
    overflow: "hidden" as const,
    border: "1px solid rgba(255,255,255,0.07)",
  },
  itemCardHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap" as const,
    gap: 10,
  },
  lotId: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "0.02em",
    fontFamily: "monospace",
  },
  statusBadge: (status: ItemStatus) => ({
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: STATUS_COLOURS[status]?.bg ?? "#1e293b",
    color: STATUS_COLOURS[status]?.text ?? "#f1f5f9",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  }),
  itemDetails: {
    padding: "16px 20px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "12px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  },
  detailItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  detailLabel: {
    fontSize: 11,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    fontWeight: 600,
  },
  detailValue: {
    fontSize: 14,
    color: "#e2e8f0",
    fontWeight: 500,
  },
  // History section
  historySection: {
    padding: "16px 20px",
  },
  historySectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: 14,
  },
  historyEmpty: {
    fontSize: 13,
    color: "#475569",
    fontStyle: "italic" as const,
  },
  historyList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
  },
  historyEntry: (isLast: boolean) => ({
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0 14px",
    paddingBottom: isLast ? 0 : 16,
    marginBottom: isLast ? 0 : 16,
    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
  }),
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: "#3b82f6",
    marginTop: 4,
    flexShrink: 0,
  },
  historyContent: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  historyAction: {
    fontSize: 13,
    fontWeight: 600,
    color: "#e2e8f0",
  },
  historyTimestamp: {
    fontSize: 11,
    color: "#64748b",
  },
  historyStates: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap" as const,
    marginTop: 2,
  },
  historyState: (variant: "prev" | "next") => ({
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    backgroundColor:
      variant === "prev" ? "rgba(100,116,139,0.2)" : "rgba(59,130,246,0.15)",
    color: variant === "prev" ? "#94a3b8" : "#93c5fd",
    fontFamily: "monospace",
    maxWidth: 220,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
  }),
  historyArrow: {
    fontSize: 11,
    color: "#475569",
  },
  historyUser: {
    fontSize: 11,
    color: "#475569",
  },
  // Empty / initial state
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 24px",
    gap: 12,
    color: "#475569",
    textAlign: "center" as const,
  },
  emptyIcon: {
    opacity: 0.4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "#64748b",
    margin: 0,
  },
  emptySubtitle: {
    fontSize: 13,
    margin: 0,
  },
} as const;

// ─── Helper: format ISO timestamp ─────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface HistoryEntryRowProps {
  entry: ItemHistoryEntry;
  isLast: boolean;
}

function HistoryEntryRow({ entry, isLast }: HistoryEntryRowProps) {
  const label = ACTION_LABELS[entry.action] ?? entry.action;

  return (
    <div style={styles.historyEntry(isLast)}>
      {/* Timeline dot */}
      <div style={styles.historyDot} aria-hidden="true" />

      {/* Content */}
      <div style={styles.historyContent}>
        <span style={styles.historyAction}>{label}</span>
        <span style={styles.historyTimestamp}>
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* State transition */}
        {(entry.previous_state !== null || entry.new_state) && (
          <div style={styles.historyStates}>
            {entry.previous_state !== null && (
              <>
                <span
                  style={styles.historyState("prev")}
                  title={entry.previous_state}
                >
                  {entry.previous_state}
                </span>
                <span style={styles.historyArrow} aria-hidden="true">
                  →
                </span>
              </>
            )}
            <span style={styles.historyState("next")} title={entry.new_state}>
              {entry.new_state}
            </span>
          </div>
        )}

        <span style={styles.historyUser}>by {entry.user_email}</span>
      </div>
    </div>
  );
}

interface ItemResultCardProps {
  item: Item;
}

function ItemResultCard({ item }: ItemResultCardProps) {
  // History is already returned in reverse chronological order from the API
  // (Req 9.5 — display in reverse chronological order)
  const history: ItemHistoryEntry[] = item.history ?? [];

  return (
    <article style={styles.itemCard} aria-label={`Item ${item.lot_id}`}>
      {/* ── Card header: Lot ID + status badge ─────────────────────────────── */}
      <div style={styles.itemCardHeader}>
        <span style={styles.lotId} aria-label={`Lot ID: ${item.lot_id}`}>
          {item.lot_id}
        </span>
        <span
          style={styles.statusBadge(item.current_status)}
          aria-label={`Status: ${item.current_status}`}
        >
          {item.current_status.replace(/_/g, " ")}
        </span>
      </div>

      {/* ── Item details grid ───────────────────────────────────────────────── */}
      <dl style={styles.itemDetails}>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Material Type</dt>
          <dd style={styles.detailValue}>{item.material_type}</dd>
        </div>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Supplier</dt>
          <dd style={styles.detailValue}>{item.supplier}</dd>
        </div>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Intake Date</dt>
          <dd style={styles.detailValue}>{item.intake_date}</dd>
        </div>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Location Zone</dt>
          <dd style={styles.detailValue}>{item.location_zone}</dd>
        </div>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Created At</dt>
          <dd style={styles.detailValue}>{formatTimestamp(item.created_at)}</dd>
        </div>
        <div style={styles.detailItem}>
          <dt style={styles.detailLabel}>Last Updated</dt>
          <dd style={styles.detailValue}>{formatTimestamp(item.updated_at)}</dd>
        </div>
      </dl>

      {/* ── History timeline ────────────────────────────────────────────────── */}
      <section style={styles.historySection} aria-label="Item history">
        <h2 style={styles.historySectionTitle}>
          History ({history.length} event{history.length !== 1 ? "s" : ""})
        </h2>

        {history.length === 0 ? (
          <p style={styles.historyEmpty}>No history entries found.</p>
        ) : (
          <ol
            style={styles.historyList}
            aria-label="Lifecycle history in reverse chronological order"
          >
            {history.map((entry, idx) => (
              <li
                key={`${entry.timestamp}-${idx}`}
                style={{ listStyle: "none" }}
              >
                <HistoryEntryRow
                  entry={entry}
                  isLast={idx === history.length - 1}
                />
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; item: Item }
  | { status: "error"; message: string; code?: string };

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<SearchState>({
    status: "idle",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const { token } = useAuth();

  // ── Submit search ──────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }

    setSearchState({ status: "loading" });

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      const json = await response.json();

      if (json.success) {
        setSearchState({ status: "success", item: json.data as Item });
      } else {
        const code: string = json.error?.code ?? "UNKNOWN";
        const message: string =
          json.error?.message ?? "An unexpected error occurred.";
        setSearchState({ status: "error", message, code });
      }
    } catch {
      setSearchState({
        status: "error",
        message: "Network error — please check your connection and try again.",
        code: "NETWORK_ERROR",
      });
    }
  }, [query]);

  // ── Handle Enter key in input ──────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch],
  );

  const isLoading = searchState.status === "loading";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page} aria-label="Global Search">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <h1 style={styles.title}>Global Search</h1>
        <p style={styles.subtitle}>
          Search by Lot ID (e.g. LOT-2026-00001) or item UUID
        </p>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={styles.body}>
        {/* Search input row */}
        <div
          style={styles.searchRow}
          role="search"
          aria-label="Search for a drum"
        >
          <input
            ref={inputRef}
            id="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="LOT-2026-00001 or UUID…"
            style={styles.input}
            aria-label="Search query — enter a Lot ID or item UUID"
            autoComplete="off"
            spellCheck={false}
            disabled={isLoading}
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            style={styles.searchBtn(isLoading)}
            aria-label={isLoading ? "Searching…" : "Search"}
            aria-busy={isLoading}
          >
            {isLoading ? "Searching…" : "Search"}
          </button>
        </div>

        {/* ── Error banner ──────────────────────────────────────────────────── */}
        {searchState.status === "error" && (
          <div role="alert" aria-live="assertive" style={styles.errorBanner}>
            {/* Error icon */}
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
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              {searchState.code === "NOT_FOUND"
                ? `No item found matching "${query}".`
                : searchState.message}
            </span>
          </div>
        )}

        {/* ── Search result ──────────────────────────────────────────────────── */}
        {searchState.status === "success" && (
          <ItemResultCard item={searchState.item} />
        )}

        {/* ── Idle / empty state ─────────────────────────────────────────────── */}
        {searchState.status === "idle" && (
          <div style={styles.emptyState} aria-hidden="true">
            {/* Search icon */}
            <svg
              style={styles.emptyIcon}
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p style={styles.emptyTitle}>Search for a drum</p>
            <p style={styles.emptySubtitle}>
              Enter a Lot ID or UUID above to view item details and full history
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
