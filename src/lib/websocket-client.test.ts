/**
 * Unit tests for WebSocket client utility
 *
 * Tests Requirements 11.3 and 11.7:
 * - 11.3: WebSocket_Server broadcasts events to all authenticated connected clients
 * - 11.7: Web_Dashboard auto-reconnects up to 5 times at 1-second intervals on drop
 */

import { createWsClient } from "@/lib/websocket-client";
import type { WsServerEvent } from "@/types/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── MockWebSocket ────────────────────────────────────────────────────────────

type WsEventType = "open" | "message" | "close" | "error";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = 1; // OPEN
  listeners: Map<WsEventType, Array<(event: unknown) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(
    type: WsEventType,
    listener: (event: unknown) => void,
  ): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(
    type: WsEventType,
    listener: (event: unknown) => void,
  ): void {
    const arr = this.listeners.get(type);
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx !== -1) arr.splice(idx, 1);
    }
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }

  // ── Simulation helpers ──────────────────────────────────────────────────────

  simulateOpen(): void {
    this._dispatch("open", {});
  }

  simulateMessage(data: unknown): void {
    this._dispatch("message", { data: JSON.stringify(data) });
  }

  simulateRawMessage(rawData: string): void {
    this._dispatch("message", { data: rawData });
  }

  simulateClose(): void {
    this.readyState = 3;
    this._dispatch("close", {});
  }

  simulateError(): void {
    this._dispatch("error", new Event("error"));
  }

  _dispatch(type: WsEventType, event: unknown): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function latestInstance(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  MockWebSocket.instances = [];
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createWsClient", () => {
  // ── Test 1: Successful connection with valid token ──────────────────────────

  it("creates a WebSocket with the correct URL including the token", () => {
    const token = "test-jwt-token";
    const client = createWsClient(token);

    const ws = latestInstance();
    expect(ws).toBeDefined();
    expect(ws.url).toContain(`token=${encodeURIComponent(token)}`);
    expect(ws.url).toMatch(/^wss?:\/\//);

    client!.disconnect();
  });

  // ── Test 2: item_updated event triggers onEvent handler ────────────────────

  it("calls onEvent handler with correct payload for item_updated event", () => {
    const client = createWsClient("token");
    const ws = latestInstance();

    const handler = vi.fn();
    client!.onEvent(handler);

    const payload: WsServerEvent = {
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00001",
        current_status: "qc_pending",
        location_zone: "QC-01",
        updated_at: "2026-01-01T10:00:00.000Z",
      },
      meta: { timestamp: "2026-01-01T10:00:00.000Z" },
    };

    ws.simulateOpen();
    ws.simulateMessage(payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);

    client!.disconnect();
  });

  // ── Test 3: item_created event triggers onEvent handler ────────────────────

  it("calls onEvent handler with correct payload for item_created event", () => {
    const client = createWsClient("token");
    const ws = latestInstance();

    const handler = vi.fn();
    client!.onEvent(handler);

    const payload: WsServerEvent = {
      event: "item_created",
      data: {
        lot_id: "LOT-2026-00002",
        material_type: "Rose Extract",
        current_status: "received",
        created_at: "2026-01-01T11:00:00.000Z",
      },
      meta: { timestamp: "2026-01-01T11:00:00.000Z" },
    };

    ws.simulateOpen();
    ws.simulateMessage(payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);

    client!.disconnect();
  });

  // ── Test 4: Auto-reconnect — 3 drops → 3 reconnect attempts at 1s intervals

  it("attempts to reconnect after each connection drop (3 drops → 3 reconnect attempts)", () => {
    createWsClient("token");

    // Initial connection is the first instance
    expect(MockWebSocket.instances).toHaveLength(1);

    // Drop 1
    latestInstance().simulateOpen();
    latestInstance().simulateClose();
    expect(MockWebSocket.instances).toHaveLength(1); // reconnect not yet fired

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2); // reconnect attempt 1

    // Drop 2
    latestInstance().simulateOpen();
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3); // reconnect attempt 2

    // Drop 3
    latestInstance().simulateOpen();
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(4); // reconnect attempt 3

    // Clean up — open the last connection so disconnect works cleanly
    latestInstance().simulateOpen();
  });

  it("reconnect attempts happen at 1-second intervals (not immediately)", () => {
    createWsClient("token");

    latestInstance().simulateOpen();
    latestInstance().simulateClose();

    // No reconnect before 1 second
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);

    // Reconnect fires at exactly 1 second
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    latestInstance().simulateOpen();
  });

  // ── Test 5: Max 5 reconnect attempts then stops ─────────────────────────────

  it("stops reconnecting after 5 failed attempts and does not attempt a 6th", () => {
    createWsClient("token");

    // Drop the initial connection without ever opening (no open → counter never resets).
    // Each close increments reconnectAttempts; each timer tick spawns a new WebSocket.
    // We do NOT call simulateOpen() so the counter keeps incrementing.

    // Drop 1 (reconnectAttempts goes 0→1, schedules reconnect)
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 1 → 2 total instances

    // Drop 2
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 2 → 3 total instances

    // Drop 3
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 3 → 4 total instances

    // Drop 4
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 4 → 5 total instances

    // Drop 5
    latestInstance().simulateClose();
    vi.advanceTimersByTime(1000); // reconnect attempt 5 → 6 total instances

    expect(MockWebSocket.instances).toHaveLength(6);

    // Drop the 5th reconnect — reconnectAttempts is now at MAX (5), so no 6th attempt
    latestInstance().simulateClose();
    vi.advanceTimersByTime(5000); // advance well past 1 second

    // Still 6 instances — no 6th reconnect
    expect(MockWebSocket.instances).toHaveLength(6);
  });

  // ── Test 6: disconnect() closes connection and stops reconnection ───────────

  it("disconnect() closes the WebSocket and prevents further reconnection", () => {
    const client = createWsClient("token");
    const ws = latestInstance();

    ws.simulateOpen();
    client!.disconnect();

    // Simulate a close event after disconnect (e.g., server-side close)
    ws.simulateClose();

    // Advance timers — no new WebSocket should be created
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("disconnect() cancels a pending reconnect timer", () => {
    const client = createWsClient("token");

    latestInstance().simulateOpen();
    latestInstance().simulateClose();

    // Reconnect timer is now pending — disconnect before it fires
    client!.disconnect();

    vi.advanceTimersByTime(2000);

    // No new WebSocket should have been created
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  // ── Additional: multiple onEvent handlers all receive events ────────────────

  it("dispatches events to all registered onEvent handlers", () => {
    const client = createWsClient("token");
    const ws = latestInstance();

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client!.onEvent(handler1);
    client!.onEvent(handler2);

    const payload: WsServerEvent = {
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00003",
        current_status: "in_production",
        location_zone: "PROD-01",
        updated_at: "2026-01-02T08:00:00.000Z",
      },
      meta: { timestamp: "2026-01-02T08:00:00.000Z" },
    };

    ws.simulateOpen();
    ws.simulateMessage(payload);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    client!.disconnect();
  });

  // ── Additional: non-JSON messages are silently ignored ──────────────────────

  it("does not call onEvent handler for non-JSON messages", () => {
    const client = createWsClient("token");
    const ws = latestInstance();

    const handler = vi.fn();
    client!.onEvent(handler);

    ws.simulateOpen();
    ws.simulateRawMessage("this is not valid json {{{{");

    expect(handler).not.toHaveBeenCalled();

    client!.disconnect();
  });
});
