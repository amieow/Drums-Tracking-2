/**
 * Item Service
 *
 * Provides business logic for item lifecycle management using direct
 * PostgreSQL queries via the `postgres` package.
 *
 * Requirements: 3.1–3.7, 4.1–4.5, 5.1–5.6, 6.4–6.6, 6.8, 9.1–9.7, 10.1, 11.1, 13.1–13.5, 14.3, 14.5
 */

import { getDb } from "@/lib/db";
import { generateLotId } from "@/lib/lot-id-generator";
import { validateTransition } from "@/lib/state-machine";
import {
  validateRegistrationInput,
  validateSearchQuery,
} from "@/lib/validation";
import type {
  AuditAction,
  Item,
  ItemHistoryEntry,
  ItemStatus,
  RegisterItemRequest,
  RegisterItemResponse,
  ScanBatchRequest,
  ScanBatchResponse,
  WsServerEvent,
} from "@/types";

/** Lot ID format: LOT-YYYY-NNNNN */
const LOT_ID_REGEX = /^LOT-\d{4}-\d{5}$/;

/** WebSocket broadcast URL (optional — fire-and-forget). */
const WS_BROADCAST_URL = process.env.DAAS_WS_BROADCAST_URL ?? "";

// ─── Error Types ──────────────────────────────────────────────────────────────

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details: Record<string, string>;
}

export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface InvalidTransitionError {
  code: "INVALID_TRANSITION";
  message: string;
  current_status: ItemStatus;
  target_status: ItemStatus;
  allowed: ItemStatus[];
}

export interface BatchTooLargeError {
  code: "BATCH_TOO_LARGE";
  message: string;
}

export type ItemServiceError =
  | ValidationError
  | InternalError
  | NotFoundError
  | InvalidTransitionError
  | BatchTooLargeError;

// ─── WebSocket Publisher ──────────────────────────────────────────────────────

export async function publishWsEvent(event: WsServerEvent): Promise<void> {
  if (!WS_BROADCAST_URL) return;
  try {
    const response = await fetch(WS_BROADCAST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      console.error(
        `[item-service] WebSocket broadcast failed (HTTP ${response.status}) for event '${event.event}'`,
      );
    }
  } catch (err) {
    console.error(
      `[item-service] WebSocket broadcast error for event '${event.event}':`,
      err,
    );
  }
}

// ─── Service Functions ────────────────────────────────────────────────────────

export async function registerItem(
  input: RegisterItemRequest,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<RegisterItemResponse> {
  const validation = validateRegistrationInput(input);
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Registration input validation failed",
      details: validation.details ?? {},
    } as ValidationError;
  }

  const sql = getDb();

  let lotId: string;
  try {
    lotId = await generateLotId(input.intake_date, sql);
  } catch (err) {
    throw {
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : "Failed to generate Lot ID",
    } as InternalError;
  }

  const rows = await sql<
    {
      id: string;
      lot_id: string;
      created_at: string;
      current_status: string;
      location_zone: string;
    }[]
  >`
    INSERT INTO items (lot_id, material_type, supplier, intake_date, current_status, location_zone, created_by)
    VALUES (${lotId}, ${input.material_type}, ${input.supplier}, ${input.intake_date}, 'received', 'RECEIVING', ${userId})
    RETURNING id, lot_id, created_at, current_status, location_zone
  `;

  if (rows.length === 0) {
    throw {
      code: "INTERNAL_ERROR",
      message: "Failed to insert item into database: no data returned",
    } as InternalError;
  }

  const itemData = rows[0];

  // Write audit entry — failure does not roll back the item (Req 3.6)
  await writeAuditEntry({
    itemId: itemData.id,
    action: "item_created",
    previousState: null,
    newState: JSON.stringify({
      lot_id: lotId,
      current_status: "received",
      location_zone: "RECEIVING",
    }),
    userId,
    userEmail,
    ip,
  }).catch((e) =>
    console.error(`[item-service] Audit write failed for item ${lotId}:`, e),
  );

  await publishWsEvent({
    event: "item_created",
    data: {
      lot_id: itemData.lot_id,
      material_type: input.material_type,
      current_status: "received",
      created_at: itemData.created_at,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  return {
    lot_id: itemData.lot_id,
    qr_code: `/api/qr/${itemData.lot_id}`,
    created_at: itemData.created_at,
    current_status: "received",
    location_zone: "RECEIVING",
  };
}

export async function updateItemStatus(
  lotId: string,
  targetStatus: ItemStatus,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<Item> {
  const sql = getDb();

  const fetchRows = await sql<
    Item[]
  >`SELECT * FROM items WHERE lot_id = ${lotId} LIMIT 1`;
  if (fetchRows.length === 0) {
    throw { code: "NOT_FOUND", message: "Item not found" } as NotFoundError;
  }

  const itemData = fetchRows[0];
  const currentStatus = itemData.current_status as ItemStatus;
  const { valid, allowed } = validateTransition(currentStatus, targetStatus);

  if (!valid) {
    throw {
      code: "INVALID_TRANSITION",
      message: `Transition from '${currentStatus}' to '${targetStatus}' is not allowed. Allowed transitions: [${allowed.join(", ")}]`,
      current_status: currentStatus,
      target_status: targetStatus,
      allowed,
    } as InvalidTransitionError;
  }

  const updatedAt = new Date().toISOString();
  const updateRows = await sql<Item[]>`
    UPDATE items SET current_status = ${targetStatus}, updated_at = ${updatedAt}
    WHERE lot_id = ${lotId}
    RETURNING *
  `;

  if (updateRows.length === 0) {
    throw {
      code: "INTERNAL_ERROR",
      message: "Failed to update item status: no data returned",
    } as InternalError;
  }

  const updatedItem = updateRows[0];

  await writeAuditEntry({
    itemId: updatedItem.id,
    action: "item_status_changed",
    previousState: JSON.stringify({ status: currentStatus }),
    newState: JSON.stringify({ status: targetStatus }),
    userId,
    userEmail,
    ip,
  }).catch((e) =>
    console.error(
      `[item-service] Audit write failed for status change on ${lotId}:`,
      e,
    ),
  );

  await publishWsEvent({
    event: "item_updated",
    data: {
      lot_id: updatedItem.lot_id,
      current_status: targetStatus,
      location_zone: updatedItem.location_zone,
      updated_at: updatedAt,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  return updatedItem;
}

export async function updateItemLocation(
  lotId: string,
  targetZone: string,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<Item> {
  const sql = getDb();

  const fetchRows = await sql<
    Item[]
  >`SELECT * FROM items WHERE lot_id = ${lotId} LIMIT 1`;
  if (fetchRows.length === 0) {
    throw { code: "NOT_FOUND", message: "Item not found" } as NotFoundError;
  }

  const itemData = fetchRows[0];
  const oldZone = itemData.location_zone;

  // Validate zone exists and check capacity
  const locationRows = await sql<
    { zone_id: string; capacity: number; current_count: number }[]
  >`
    SELECT zone_id, capacity, current_count FROM location_counts WHERE zone_id = ${targetZone} LIMIT 1
  `;

  if (locationRows.length === 0) {
    throw {
      code: "VALIDATION_ERROR",
      message: `Zone '${targetZone}' does not exist`,
      details: { location_zone: "INVALID_ZONE" },
    } as ValidationError;
  }

  const { capacity, current_count } = locationRows[0];
  if (capacity > 0 && current_count >= capacity) {
    throw {
      code: "VALIDATION_ERROR",
      message: `Zone '${targetZone}' is at capacity (${current_count}/${capacity})`,
      details: { location_zone: "ZONE_AT_CAPACITY" },
    } as ValidationError;
  }

  const updatedAt = new Date().toISOString();
  const updateRows = await sql<Item[]>`
    UPDATE items SET location_zone = ${targetZone}, updated_at = ${updatedAt}
    WHERE lot_id = ${lotId}
    RETURNING *
  `;

  if (updateRows.length === 0) {
    throw {
      code: "INTERNAL_ERROR",
      message: "Failed to update item location: no data returned",
    } as InternalError;
  }

  const updatedItem = updateRows[0];

  await writeAuditEntry({
    itemId: updatedItem.id,
    action: "item_location_changed",
    previousState: JSON.stringify({ location_zone: oldZone }),
    newState: JSON.stringify({ location_zone: targetZone }),
    userId,
    userEmail,
    ip,
  }).catch((e) =>
    console.error(
      `[item-service] Audit write failed for location change on ${lotId}:`,
      e,
    ),
  );

  await publishWsEvent({
    event: "item_updated",
    data: {
      lot_id: updatedItem.lot_id,
      current_status: updatedItem.current_status as ItemStatus,
      location_zone: targetZone,
      updated_at: updatedAt,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  return updatedItem;
}

export async function processScanBatch(
  batch: ScanBatchRequest,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<ScanBatchResponse> {
  if (batch.items.length > 50) {
    throw {
      code: "BATCH_TOO_LARGE",
      message: "Batch exceeds maximum of 50 items",
    } as BatchTooLargeError;
  }

  const results = await Promise.all(
    batch.items.map(async (scanItem) => {
      try {
        const updatedItem = await updateItemStatus(
          scanItem.lot_id,
          scanItem.target_status,
          userId,
          userEmail,
          ip,
        );

        await writeAuditEntry({
          itemId: updatedItem.id,
          action: "item_bulk_updated",
          previousState: null,
          newState: JSON.stringify({
            lot_id: scanItem.lot_id,
            status: scanItem.target_status,
          }),
          userId,
          userEmail,
          ip,
        }).catch((e) =>
          console.error(
            `[item-service] Bulk audit write failed for item ${scanItem.lot_id}:`,
            e,
          ),
        );

        return {
          lot_id: scanItem.lot_id,
          success: true as const,
          item: {
            lot_id: updatedItem.lot_id,
            current_status: updatedItem.current_status,
            location_zone: updatedItem.location_zone,
          },
        };
      } catch (err) {
        const errorMessage =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Unknown error";
        return {
          lot_id: scanItem.lot_id,
          success: false as const,
          error: errorMessage,
        };
      }
    }),
  );

  return { processed_at: new Date().toISOString(), results };
}

export async function searchItem(query: string, userId: string): Promise<Item> {
  const validation = validateSearchQuery({ query });
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Invalid search query",
      details: validation.details ?? {
        query:
          "query must match the Lot ID format (LOT-YYYY-NNNNN) or be a valid UUID",
      },
    } as ValidationError;
  }

  const sql = getDb();
  const isLotId = LOT_ID_REGEX.test(query);

  const itemRows = await sql<Item[]>`
    SELECT * FROM items WHERE ${isLotId ? sql`lot_id = ${query}` : sql`id = ${query}::uuid`} LIMIT 1
  `;

  if (itemRows.length === 0) {
    throw { code: "NOT_FOUND", message: "Item not found" } as NotFoundError;
  }

  const itemData = itemRows[0];

  const auditRows = await sql<
    {
      action: string;
      previous_state: string | null;
      new_state: string;
      user_id: string;
      user_email: string;
      timestamp: string;
    }[]
  >`
    SELECT action, previous_state, new_state, user_id, user_email, timestamp
    FROM audit_logs
    WHERE item_id = ${itemData.id}::uuid
    ORDER BY timestamp DESC
  `;

  const history: ItemHistoryEntry[] = auditRows.map((row) => ({
    action: row.action as AuditAction,
    previous_state: row.previous_state,
    new_state: row.new_state,
    user_id: row.user_id,
    user_email: row.user_email,
    timestamp: row.timestamp,
  }));

  void userId;
  return { ...itemData, history };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function writeAuditEntry(params: {
  itemId: string | null;
  action: string;
  previousState: string | null;
  newState: string;
  userId: string;
  userEmail: string;
  ip: string;
}): Promise<void> {
  const sql = getDb();
  const { itemId, action, previousState, newState, userId, userEmail, ip } =
    params;
  await sql`
    INSERT INTO audit_logs (item_id, action, previous_state, new_state, user_id, user_email, ip_address, timestamp)
    VALUES (
      ${itemId ? sql`${itemId}::uuid` : sql`NULL`},
      ${action},
      ${previousState},
      ${newState},
      ${userId}::uuid,
      ${userEmail},
      ${ip},
      ${new Date().toISOString()}
    )
  `;
}
