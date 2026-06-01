"use client";

import NavBar from "@/components/NavBar";
import ZoneCard from "@/components/ZoneCard";
import { useAuth } from "@/lib/auth-context";
import { createWsClient, type WsClient } from "@/lib/websocket-client";
import type { Item, Location, WsServerEvent } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  qc_pending: "QC Pending",
  qc_pass: "QC Pass",
  qc_fail: "QC Fail",
  in_production: "In Production",
  finished: "Finished",
  cold_storage: "Cold Storage",
  dispatched: "Dispatched",
  archived: "Archived",
};

const STATUS_COLORS: Record<string, string> = {
  received: "#6b7280",
  qc_pending: "#eab308",
  qc_pass: "#22c55e",
  qc_fail: "#ef4444",
  in_production: "#f97316",
  finished: "#3b82f6",
  cold_storage: "#06b6d4",
  dispatched: "#8b5cf6",
  archived: "#374151",
};

interface ZoneItemsPanelProps {
  zone: Location;
  token: string;
  onClose: () => void;
}

function ZoneItemsPanel({ zone, token, onClose }: ZoneItemsPanelProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchItems() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/items?location_zone=${encodeURIComponent(zone.zone_id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          const data: Item[] = Array.isArray(json?.data) ? json.data : [];
          setItems(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message ?? "Failed to load items");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchItems();
    return () => {
      cancelled = true;
    };
  }, [zone.zone_id, token]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle>{zone.name}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {zone.current_count} drum{zone.current_count !== 1 ? "s" : ""} in
            this zone
          </p>
        </SheetHeader>

        <div className="p-6">
          {loading && (
            <p className="text-center py-10 text-muted-foreground">
              Loading items…
            </p>
          )}

          {!loading && error && (
            <p className="text-center py-10 text-destructive">
              Error: {error}
            </p>
          )}

          {!loading && !error && items.length === 0 && (
            <p className="text-center py-10 text-muted-foreground">
              No items in this zone.
            </p>
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="space-y-3" aria-label={`Items in ${zone.name}`}>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="p-4 rounded-lg bg-muted/50 border"
                >
                  <div className="font-mono font-bold text-sm mb-2">
                    {item.lot_id}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: STATUS_COLORS[item.current_status] ?? "#6b7280",
                        color: "#ffffff",
                      }}
                    >
                      {STATUS_LABELS[item.current_status] ??
                        item.current_status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Updated {formatDateTime(item.updated_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full",
        status === "connected" && "bg-green-100 text-green-800 border-green-200",
        status === "reconnecting" && "bg-yellow-100 text-yellow-800 border-yellow-200 animate-pulse",
        status === "disconnected" && "bg-red-100 text-red-800 border-red-200"
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "connected" && "bg-green-600",
          status === "reconnecting" && "bg-yellow-600",
          status === "disconnected" && "bg-red-600"
        )}
      />
      {status === "connected" && "Live"}
      {status === "reconnecting" && "Reconnecting…"}
      {status === "disconnected" && "Disconnected"}
    </Badge>
  );
}

export default function DashboardPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<Location | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const { token } = useAuth();

  const wsClientRef = useRef<WsClient | null>(null);
  const reconnectCountRef = useRef(0);

  const fetchLocations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/locations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch locations`);
      }
      const json = await res.json();
      const data: Location[] = Array.isArray(json?.data) ? json.data : [];
      setLocations(data);
    } catch (err) {
      setFetchError((err as Error).message ?? "Failed to load floor plan");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (!token) return;

    const client = createWsClient(token);
    wsClientRef.current = client;

    if (!client) {
      return;
    }

    setConnectionStatus("connected");

    client.onEvent((event: WsServerEvent) => {
      if (event.event === "item_updated") {
        const { location_zone } = event.data;
        setLocations((prev) =>
          prev.map((loc) => {
            if (loc.zone_id !== location_zone) return loc;
            void fetch(`/api/locations/${encodeURIComponent(location_zone)}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then((r) => r.json())
              .then((json) => {
                if (json?.data) {
                  setLocations((current) =>
                    current.map((l) =>
                      l.zone_id === location_zone ? (json.data as Location) : l,
                    ),
                  );
                }
              })
              .catch(() => {});
            return loc;
          }),
        );
      }

      if (event.event === "item_created") {
        const receivingZoneId = "RECEIVING";
        void fetch(`/api/locations/${encodeURIComponent(receivingZoneId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.json())
          .then((json) => {
            if (json?.data) {
              setLocations((current) =>
                current.map((l) =>
                  l.zone_id === receivingZoneId ? (json.data as Location) : l,
                ),
              );
            }
          })
          .catch(() => {});
      }

      if (event.event === "error") {
        const code = event.data.code;
        if (code === "CONNECTION_CLOSED") {
          setConnectionStatus("reconnecting");
          reconnectCountRef.current += 1;
        } else if (code === "TOKEN_EXPIRED" || code === "UNAUTHORIZED") {
          setConnectionStatus("disconnected");
        }
      }
    });

    const statusPollInterval = setInterval(() => {}, 1000);

    return () => {
      clearInterval(statusPollInterval);
      client?.disconnect();
      wsClientRef.current = null;
    };
  }, [token]);

  const handleZoneClick = useCallback((location: Location) => {
    setSelectedZone(location);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedZone(null);
  }, []);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <NavBar title="Warehouse Floor Plan" />

      <header className="bg-white border-b px-6 py-4 flex items-center justify-between gap-4 sticky top-14 z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight m-0">
            Warehouse Floor Plan
          </h1>
          <p className="text-sm text-slate-500 m-0 mt-0.5">
            Real-time drum inventory by zone
          </p>
        </div>

        <ConnectionBadge status={connectionStatus} />
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading && (
          <div
            className="flex flex-col items-center justify-center py-20 gap-4"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="size-9 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-slate-500">Loading floor plan…</span>
          </div>
        )}

        {!loading && fetchError && (
          <div
            className="bg-red-50 border border-red-200 rounded-xl p-5 text-red-800"
            role="alert"
          >
            <strong>Failed to load floor plan</strong>
            <p className="text-sm mt-1 mb-3">{fetchError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchLocations()}
              className="border-red-300 text-red-700 hover:bg-red-100"
            >
              Retry
            </Button>
          </div>
        )}

        {!loading && !fetchError && (
          <>
            <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 m-0">
              {locations.length} zone{locations.length !== 1 ? "s" : ""}
            </p>

            {locations.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                No warehouse zones configured.
              </div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                role="list"
                aria-label="Warehouse zones"
              >
                {locations.map((location) => (
                  <div key={location.zone_id} role="listitem">
                    <ZoneCard
                      location={location}
                      onClick={handleZoneClick}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {selectedZone && (
        <ZoneItemsPanel
          zone={selectedZone}
          token={token ?? ""}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}