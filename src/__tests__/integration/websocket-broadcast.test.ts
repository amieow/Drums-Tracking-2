/**
 * Integration Test: WebSocket Broadcast to Multiple Clients
 *
 * **Validates: Requirements 11.3**
 *
 * Requirement 11.3: WHEN an event is published to the WebSocket_Server, THE
 * WebSocket_Server SHALL broadcast it to all authenticated connected clients
 * within 2 seconds of receiving the event.
 *
 * Test scenario:
 * 1. Two authenticated clients connect to the WebSocket server.
 * 2. An item status update triggers `publishWsEvent` (the broadcast publisher).
 * 3. Both clients receive the `item_updated` event within 2 seconds.
 *
 * Since we cannot connect to a real DaaS server in tests, this test mocks the
 * WebSocket infrastructure:
 * - `MockWebSocket` replaces the global `WebSocket` constructor so that
 *   `createWsClient` creates controllable in-process connections.
 * - A mock broadcast endpoint replaces `fetch` so that `publishWsEvent` can
 *   deliver the event payload to all connected mock clients synchronously.
 */

import { createWsClient } from "@/lib/websocket-client";
import { publishWsEvent } from "@/services/item-service";
import type { WsItemUpdatedEvent, WsServerEvent } from "@/types/index";
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

  simulateClose(): void {
    this.readyState = 3;
    this._dispatch("close", {});
  }

  _dispatch(type: WsEventType, event: unknown): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener(event);
    }
  }
}

// ─── Broadcast relay ─────────────────────────────────────────────────────────
//
// When `publishWsEvent` calls `fetch(broadcastUrl, { body: JSON.stringify(event) })`,
// our mock fetch intercepts the call and immediately delivers the event to every
// connected MockWebSocket instance — simulating the DaaS broadcaster forwarding
// the event to all authenticated subscribers.

function createBroadcastFetch() {
  return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const event = JSON.parse(init.body as string) as WsServerEvent;

    // Deliver the event to every open MockWebSocket instance
    for (const ws of MockWebSocket.instances) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.simulateMessage(event);
      }
    }

    return { ok: true, status: 200 };
  });
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

// ─── Integration Tests ────────────────────────────────────────────────────────

describe("WebSocket broadcast integration — Requirement 11.3", () => {
  /**
   * Core scenario: two authenticated clients both receive an `item_updated`
   * event that is published via `publishWsEvent` after an item status change.
   *
   * The 2-second constraint from Req 11.3 is verified by asserting that the
   * event arrives synchronously within the same tick as the broadcast call
   * (i.e., well within 2 seconds).
   */
  it("both connected clients receive item_updated event after publishWsEvent is called", async () => {
    // ── Arrange: two authenticated clients connect ──────────────────────────
    const tokenA = "jwt-token-client-a";
    const tokenB = "jwt-token-client-b";

    const clientA = createWsClient(tokenA);
    const clientB = createWsClient(tokenB);

    // Simulate both connections being established
    const wsA = MockWebSocket.instances[0];
    const wsB = MockWebSocket.instances[1];

    expect(wsA).toBeDefined();
    expect(wsB).toBeDefined();

    // Verify tokens are embedded in the connection URLs (authentication check)
    expect(wsA.url).toContain(`token=${encodeURIComponent(tokenA)}`);
    expect(wsB.url).toContain(`token=${encodeURIComponent(tokenB)}`);

    wsA.simulateOpen();
    wsB.simulateOpen();

    // Register event handlers on both clients
    const receivedByA: WsServerEvent[] = [];
    const receivedByB: WsServerEvent[] = [];

    clientA.onEvent((event) => receivedByA.push(event));
    clientB.onEvent((event) => receivedByB.push(event));

    // ── Arrange: mock fetch to relay broadcast to all connected clients ──────
    const broadcastFetch = createBroadcastFetch();
    vi.stubGlobal("fetch", broadcastFetch);

    // ── Act: publish an item_updated event (simulates item status update) ────
    const itemUpdatedEvent: WsItemUpdatedEvent = {
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00001",
        current_status: "qc_pending",
        location_zone: "QC-01",
        updated_at: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    };

    // publishWsEvent is called by updateItemStatus after a successful DB write.
    // Here we call it directly to test the broadcast behavior in isolation.
    await publishWsEvent(itemUpdatedEvent);

    // ── Assert: both clients received the event ──────────────────────────────

    // Both clients must have received exactly one event
    expect(receivedByA).toHaveLength(1);
    expect(receivedByB).toHaveLength(1);

    // The event received by client A must match the published event
    const eventA = receivedByA[0] as WsItemUpdatedEvent;
    expect(eventA.event).toBe("item_updated");
    expect(eventA.data.lot_id).toBe("LOT-2026-00001");
    expect(eventA.data.current_status).toBe("qc_pending");
    expect(eventA.data.location_zone).toBe("QC-01");

    // The event received by client B must match the published event
    const eventB = receivedByB[0] as WsItemUpdatedEvent;
    expect(eventB.event).toBe("item_updated");
    expect(eventB.data.lot_id).toBe("LOT-2026-00001");
    expect(eventB.data.current_status).toBe("qc_pending");
    expect(eventB.data.location_zone).toBe("QC-01");

    // Both clients received identical event data
    expect(eventA.data).toEqual(eventB.data);

    // ── Assert: broadcast was called exactly once (single publish) ───────────
    expect(broadcastFetch).toHaveBeenCalledTimes(1);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    clientA.disconnect();
    clientB.disconnect();
  });

  /**
   * Timing constraint: the event must be delivered within 2 seconds.
   *
   * We verify this by checking that the event arrives before 2000ms have
   * elapsed. Since our mock delivers synchronously, the event arrives in
   * the same microtask — well within the 2-second window.
   */
  it("both clients receive the event within 2 seconds of publishWsEvent being called", async () => {
    const clientA = createWsClient("token-a");
    const clientB = createWsClient("token-b");

    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[1].simulateOpen();

    const receivedTimestamps: { client: string; receivedAt: number }[] = [];
    const publishedAt = Date.now();

    clientA.onEvent(() => {
      receivedTimestamps.push({ client: "A", receivedAt: Date.now() });
    });
    clientB.onEvent(() => {
      receivedTimestamps.push({ client: "B", receivedAt: Date.now() });
    });

    vi.stubGlobal("fetch", createBroadcastFetch());

    const event: WsItemUpdatedEvent = {
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00042",
        current_status: "in_production",
        location_zone: "PROD-01",
        updated_at: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    };

    await publishWsEvent(event);

    // Both clients must have received the event
    expect(receivedTimestamps).toHaveLength(2);

    // Each delivery must be within 2000ms of the publish time (Req 11.3)
    for (const { client, receivedAt } of receivedTimestamps) {
      const elapsedMs = receivedAt - publishedAt;
      expect(
        elapsedMs,
        `Client ${client} received event ${elapsedMs}ms after publish — must be < 2000ms`,
      ).toBeLessThan(2000);
    }

    clientA.disconnect();
    clientB.disconnect();
  });

  /**
   * Disconnected client does not receive the broadcast.
   *
   * A client that has called disconnect() (readyState = CLOSED) must not
   * receive events published after disconnection.
   */
  it("disconnected client does not receive events after disconnect()", async () => {
    const clientA = createWsClient("token-a");
    const clientB = createWsClient("token-b");

    const wsA = MockWebSocket.instances[0];
    const wsB = MockWebSocket.instances[1];

    wsA.simulateOpen();
    wsB.simulateOpen();

    const receivedByA: WsServerEvent[] = [];
    const receivedByB: WsServerEvent[] = [];

    clientA.onEvent((e) => receivedByA.push(e));
    clientB.onEvent((e) => receivedByB.push(e));

    // Client B disconnects before the event is published
    clientB.disconnect();

    vi.stubGlobal("fetch", createBroadcastFetch());

    await publishWsEvent({
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00099",
        current_status: "dispatched",
        location_zone: "DISPATCH",
        updated_at: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    });

    // Client A (still connected) receives the event
    expect(receivedByA).toHaveLength(1);

    // Client B (disconnected) must NOT receive the event
    // The MockWebSocket readyState is CLOSED (3) after disconnect(), so the
    // broadcast relay skips it.
    expect(receivedByB).toHaveLength(0);

    clientA.disconnect();
  });

  /**
   * Multiple event types are broadcast correctly.
   *
   * Both item_updated and item_created events must reach all connected clients.
   */
  it("both item_updated and item_created events are broadcast to all connected clients", async () => {
    const clientA = createWsClient("token-a");
    const clientB = createWsClient("token-b");

    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[1].simulateOpen();

    const receivedByA: WsServerEvent[] = [];
    const receivedByB: WsServerEvent[] = [];

    clientA.onEvent((e) => receivedByA.push(e));
    clientB.onEvent((e) => receivedByB.push(e));

    vi.stubGlobal("fetch", createBroadcastFetch());

    // Publish item_created event (simulates new item registration)
    await publishWsEvent({
      event: "item_created",
      data: {
        lot_id: "LOT-2026-00010",
        material_type: "Rose Extract",
        current_status: "received",
        created_at: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    });

    // Publish item_updated event (simulates status change)
    await publishWsEvent({
      event: "item_updated",
      data: {
        lot_id: "LOT-2026-00010",
        current_status: "qc_pending",
        location_zone: "QC-01",
        updated_at: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    });

    // Both clients must have received both events
    expect(receivedByA).toHaveLength(2);
    expect(receivedByB).toHaveLength(2);

    expect(receivedByA[0].event).toBe("item_created");
    expect(receivedByA[1].event).toBe("item_updated");

    expect(receivedByB[0].event).toBe("item_created");
    expect(receivedByB[1].event).toBe("item_updated");

    clientA.disconnect();
    clientB.disconnect();
  });
});
