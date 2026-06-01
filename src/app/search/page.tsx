"use client";

import NavBar from "@/components/NavBar";
import { useAuth } from "@/lib/auth-context";
import type { AuditAction, Item, ItemHistoryEntry, ItemStatus } from "@/types";
import { useCallback, useRef, useState } from "react";
import { AlertCircle, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

interface HistoryEntryRowProps {
  entry: ItemHistoryEntry;
  isLast: boolean;
}

function HistoryEntryRow({ entry, isLast }: HistoryEntryRowProps) {
  const label = ACTION_LABELS[entry.action] ?? entry.action;

  return (
    <div
      className={cn(
        "grid grid-cols-[10px_1fr] gap-3 pb-4 mb-4 border-b border-white/5",
        isLast && "border-b-0 pb-0 mb-0"
      )}
    >
      <div
        className="size-2.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"
        aria-hidden="true"
      />

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-slate-200">{label}</span>
        <span className="text-xs text-slate-500">
          {formatTimestamp(entry.timestamp)}
        </span>

        {(entry.previous_state !== null || entry.new_state) && (
          <div className="flex gap-2 items-center flex-wrap mt-0.5">
            {entry.previous_state !== null && (
              <>
                <span
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-600/30 text-slate-400 font-mono max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap"
                  title={entry.previous_state}
                >
                  {entry.previous_state}
                </span>
                <span className="text-xs text-slate-600" aria-hidden="true">
                  →
                </span>
              </>
            )}
            <span
              className="text-[11px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap"
              title={entry.new_state}
            >
              {entry.new_state}
            </span>
          </div>
        )}

        <span className="text-xs text-slate-600">by {entry.user_email}</span>
      </div>
    </div>
  );
}

interface ItemResultCardProps {
  item: Item;
}

function ItemResultCard({ item }: ItemResultCardProps) {
  const history: ItemHistoryEntry[] = item.history ?? [];

  return (
    <Card
      className="bg-slate-800 border-slate-700 overflow-hidden"
      aria-label={`Item ${item.lot_id}`}
    >
      <CardHeader className="p-5 pb-4 border-b border-white/7 flex flex-row items-center justify-between gap-3 flex-wrap">
        <span
          className="text-lg font-bold font-mono tracking-wide text-slate-100"
          aria-label={`Lot ID: ${item.lot_id}`}
        >
          {item.lot_id}
        </span>
        <span
          className="px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: STATUS_COLOURS[item.current_status]?.bg ?? "#1e293b",
            color: STATUS_COLOURS[item.current_status]?.text ?? "#f1f5f9",
          }}
          aria-label={`Status: ${item.current_status}`}
        >
          {item.current_status.replace(/_/g, " ")}
        </span>
      </CardHeader>

      <CardContent className="p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
          {[
            { label: "Material Type", value: item.material_type },
            { label: "Supplier", value: item.supplier },
            { label: "Intake Date", value: item.intake_date },
            { label: "Location Zone", value: item.location_zone },
            { label: "Created At", value: formatTimestamp(item.created_at) },
            { label: "Last Updated", value: formatTimestamp(item.updated_at) },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                {label}
              </dt>
              <dd className="text-sm text-slate-300 font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            History ({history.length} event{history.length !== 1 ? "s" : ""})
          </h2>

          {history.length === 0 ? (
            <p className="text-sm text-slate-600 italic">
              No history entries found.
            </p>
          ) : (
            <ol aria-label="Lifecycle history in reverse chronological order">
              {history.map((entry, idx) => (
                <li key={`${entry.timestamp}-${idx}`} className="list-none">
                  <HistoryEntryRow
                    entry={entry}
                    isLast={idx === history.length - 1}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

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

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }

    setSearchState({ status: "loading" });

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(q)}`,
        {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

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
        message:
          "Network error — please check your connection and try again.",
        code: "NETWORK_ERROR",
      });
    }
  }, [query, token]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch],
  );

  const isLoading = searchState.status === "loading";

  return (
    <main className="min-h-dvh bg-slate-900 text-slate-100 flex flex-col">
      <NavBar title="Search" />

      <header className="px-6 py-5 border-b border-white/8 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-100 tracking-tight m-0 mb-1">
          Global Search
        </h1>
        <p className="text-sm text-slate-500 m-0">
          Search by Lot ID (e.g. LOT-2026-00001) or item UUID
        </p>
      </header>

      <div className="flex-1 px-6 py-6 max-w-3xl mx-auto w-full flex flex-col gap-6 pb-24 md:pb-6">
        <div
          className="flex gap-3"
          role="search"
          aria-label="Search for a drum"
        >
          <Input
            ref={inputRef}
            id="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="LOT-2026-00001 or UUID…"
            className="flex-1 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
            aria-label="Search query — enter a Lot ID or item UUID"
            autoComplete="off"
            spellCheck={false}
            disabled={isLoading}
          />
          <Button
            onClick={handleSearch}
            disabled={isLoading}
            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold"
            aria-label={isLoading ? "Searching…" : "Search"}
            aria-busy={isLoading}
          >
            {isLoading ? "Searching…" : "Search"}
          </Button>
        </div>

        {searchState.status === "error" && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400"
          >
            <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
            <span>
              {searchState.code === "NOT_FOUND"
                ? `No item found matching "${query}".`
                : searchState.message}
            </span>
          </div>
        )}

        {searchState.status === "success" && (
          <ItemResultCard item={searchState.item} />
        )}

        {searchState.status === "idle" && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <SearchIcon
              className="size-14 text-slate-600 opacity-40"
              aria-hidden="true"
            />
            <p className="text-base font-semibold text-slate-500 m-0">
              Search for a drum
            </p>
            <p className="text-sm text-slate-600 m-0">
              Enter a Lot ID or UUID above to view item details and full history
            </p>
          </div>
        )}
      </div>
    </main>
  );
}