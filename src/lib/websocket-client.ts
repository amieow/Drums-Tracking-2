/**
 * WebSocket Client Utility
 *
 * Connects to the DaaS WebSocket server, handles incoming events,
 * and auto-reconnects up to 5 times at 1-second intervals on connection drop.
 */

import type { WsServerEvent } from "@/types/index";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL_MS = 1000;

export interface WsClient {
  /** Register a handler to receive server-to-client events. */
  onEvent(handler: (event: WsServerEvent) => void): void;
  /** Close the connection and stop any pending reconnection attempts. */
  disconnect(): void;
}

/**
 * Creates a WebSocket client that connects to the DaaS WebSocket server.
 * Returns null if no WebSocket URL is configured.
 *
 * @param token - A valid JWT token used to authenticate the connection.
 * @returns A WsClient with `onEvent` and `disconnect` methods, or null if disabled.
 */
export function createWsClient(token: string): WsClient | null {
  const baseUrl =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_DAAS_WS_URL ?? "")
      : "";

  // No WebSocket URL configured — return a no-op client
  if (!baseUrl) {
    return null;
  }

  // Ensure the base URL does not have a trailing slash before appending query
  const wsUrl = `${baseUrl.replace(/\/$/, "")}?token=${encodeURIComponent(token)}`;

  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const handlers: Array<(event: WsServerEvent) => void> = [];

  function dispatch(event: WsServerEvent): void {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[WsClient] Event handler threw an error:", err);
      }
    }
  }

  function connect(): void {
    if (stopped) return;

    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      console.log("[WsClient] Connected.");
    });

    ws.addEventListener("message", (messageEvent: MessageEvent) => {
      let parsed: WsServerEvent;
      try {
        parsed = JSON.parse(messageEvent.data as string) as WsServerEvent;
      } catch {
        console.warn(
          "[WsClient] Received non-JSON message:",
          messageEvent.data,
        );
        return;
      }

      // Handle error events specially
      if (parsed.event === "error") {
        const code = parsed.data.code;

        if (code === "TOKEN_EXPIRED" || code === "UNAUTHORIZED") {
          // Do not reconnect — token is invalid
          console.warn(
            `[WsClient] Received error event (${code}). Closing without reconnect.`,
          );
          stopped = true;
          ws?.close();
          dispatch(parsed);
          return;
        }

        if (code === "CONNECTION_CLOSED") {
          // Server is closing — attempt reconnect
          console.warn(
            "[WsClient] Received CONNECTION_CLOSED. Will attempt reconnect.",
          );
          dispatch(parsed);
          // The 'close' event will trigger the reconnect logic
          return;
        }
      }

      // Dispatch item_updated and item_created events (and any other events)
      if (parsed.event === "item_updated" || parsed.event === "item_created") {
        dispatch(parsed);
      }
    });

    ws.addEventListener("error", (event) => {
      console.error("[WsClient] WebSocket error:", event);
    });

    ws.addEventListener("close", () => {
      if (stopped) {
        console.log("[WsClient] Connection closed (intentional).");
        return;
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(
          `[WsClient] Connection dropped. Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${RECONNECT_INTERVAL_MS}ms...`,
        );
        reconnectTimer = setTimeout(() => {
          connect();
        }, RECONNECT_INTERVAL_MS);
      } else {
        console.warn(
          `[WsClient] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`,
        );
      }
    });
  }

  // Initiate the first connection
  connect();

  return {
    onEvent(handler: (event: WsServerEvent) => void): void {
      handlers.push(handler);
    },

    disconnect(): void {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws !== null) {
        ws.close();
        ws = null;
      }
    },
  };
}
