/**
 * Item Service
 *
 * Provides business logic for item lifecycle management:
 * - Item registration (lot ID generation, initial state, audit trail)
 * - Item status update (state machine enforcement, audit trail, WebSocket event)
 * - Item location update (zone validation, capacity check, audit trail, WebSocket event)
 * - Bulk scan processing (batch status updates with per-item results)
 * - Global search (exact match on lot_id or id, with full audit history)
 *
 * All database operations use the server-side Supabase client (service role),
 * which bypasses RLS for trusted server-side writes.
 *
 * Requirements: 3.1–3.7, 4.1–4.5, 5.1–5.6, 6.4–6.6, 6.8, 9.1–9.7, 10.1, 11.1, 13.1, 13.2, 13.3, 13.4, 13.5, 14.3, 14.5
 */

import { generateLotId } from "@/lib/lot-id-generator";
import { validateTransition } from "@/lib/state-machine";
import { getSupabaseClient } from "@/lib/supabase";
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

/** DaaS backend base URL — prefer env var, fall back to hardcoded value. */
const DAAS_BASE_URL = process.env.NEXT_PUBLIC_DAAS_URL ?? "";

// ─── Error Types ──────────────────────────────────────────────────────────────

/** Thrown when input validation fails (Requirement 13.1, 13.2). */
export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details: Record<string, string>;
}

/** Thrown when a database or unexpected server error occurs. */
export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

/** Thrown when the requested item does not exist (Requirement 5.2). */
export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

/**
 * Thrown when a status transition is not permitted by the state machine
 * (Requirements 5.2, 5.3, 5.6).
 */
export interface InvalidTransitionError {
  code: "INVALID_TRANSITION";
  message: string;
  current_status: ItemStatus;
  target_status: ItemStatus;
  allowed: ItemStatus[];
}

/**
 * Thrown when a bulk scan batch exceeds the maximum allowed size of 50 items
 * (Requirements 6.4, 13.5).
 */
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

/**
 * Publishes a WebSocket event to all connected clients via the DaaS broadcaster.
 *
 * POSTs the event payload to `{DAAS_BASE_URL}/ws/broadcast`. On failure the
 * error is logged with `console.error` but is NOT re-thrown — the caller's
 * item update is already committed and must not be rolled back (Req 11.1).
 *
 * @param event - The typed server-to-client WebSocket event to broadcast.
 *
 * Validates: Requirements 11.1, 11.2
 */
export async function publishWsEvent(event: WsServerEvent): Promise<void> {
  try {
    const response = await fetch(`${DAAS_BASE_URL}/ws/broadcast`, {
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
    // Network or other fetch error — log but do NOT throw (Req 11.1)
    console.error(
      `[item-service] WebSocket broadcast error for event '${event.event}':`,
      err,
    );
  }
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Registers a new drum item in the system.
 *
 * Steps:
 * 1. Validates the input fields (material_type, supplier, intake_date).
 * 2. Generates a collision-safe Lot ID via the `lot_id_sequences` table.
 * 3. Inserts the item into the `items` table with `current_status = "received"`
 *    and `location_zone = "RECEIVING"`.
 * 4. Writes an `item_created` AuditEntry to `audit_logs`.
 *    If the audit write fails, the item is retained (no rollback) per Req 3.6.
 * 5. Returns the registration response with lot_id, qr_code URL, created_at,
 *    current_status, and location_zone.
 *
 * @param input     - The registration request payload.
 * @param userId    - The authenticated user's UUID (from JWT `sub`).
 * @param userEmail - The authenticated user's email (from JWT `email`).
 * @param ip        - The client IP address for audit logging.
 * @returns A promise resolving to the registration response.
 * @throws  `{ code: "VALIDATION_ERROR", message, details }` for invalid input.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 3.1–3.7, 4.1–4.5, 13.1, 13.2
 */
export async function registerItem(
  input: RegisterItemRequest,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<RegisterItemResponse> {
  // Step 1: Validate input fields (Req 3.4, 3.5, 13.1, 13.2)
  const validation = validateRegistrationInput(input);
  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Registration input validation failed",
      details: validation.details ?? {},
    };
    throw err;
  }

  const supabase = getSupabaseClient();

  // Step 2: Generate a collision-safe Lot ID (Req 3.2, 3.3, 4.1–4.5)
  let lotId: string;
  try {
    lotId = await generateLotId(input.intake_date, supabase);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate Lot ID";
    const internalErr: InternalError = {
      code: "INTERNAL_ERROR",
      message,
    };
    throw internalErr;
  }

  // Step 3: Insert the item into the `items` table (Req 3.1, 3.6, 3.7)
  const { data: itemData, error: itemError } = await supabase
    .from("items")
    .insert({
      lot_id: lotId,
      material_type: input.material_type,
      supplier: input.supplier,
      intake_date: input.intake_date,
      current_status: "received",
      location_zone: "RECEIVING",
      created_by: userId,
    })
    .select("id, lot_id, created_at, current_status, location_zone")
    .single();

  if (itemError || !itemData) {
    const internalErr: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to insert item into database: ${itemError?.message ?? "no data returned"}`,
    };
    throw internalErr;
  }

  // Step 4: Write the `item_created` AuditEntry (Req 3.6, 10.1)
  // Per Requirement 3.6: if audit write fails, retain the item (no rollback).
  const auditError = await writeItemCreatedAudit({
    itemId: itemData.id as string,
    lotId,
    userId,
    userEmail,
    ip,
  });

  if (auditError) {
    // Log the failure but do NOT throw — item is retained per Req 3.6.
    console.error(
      `[item-service] Audit write failed for item ${lotId}: ${auditError}`,
    );
  }

  // Step 5: Publish item_created WebSocket event (Req 11.1, 11.2)
  await publishWsEvent({
    event: "item_created",
    data: {
      lot_id: itemData.lot_id as string,
      material_type: input.material_type,
      current_status: "received",
      created_at: itemData.created_at as string,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  // Step 6: Return the registration response (Req 3.7)
  return {
    lot_id: itemData.lot_id as string,
    qr_code: `/api/qr/${itemData.lot_id}`,
    created_at: itemData.created_at as string,
    current_status: "received",
    location_zone: "RECEIVING",
  };
}

/**
 * Updates the status of an existing item, enforcing the state machine.
 *
 * Steps:
 * 1. Fetches the item by `lot_id` from the `items` table.
 * 2. Validates the transition via `validateTransition`.
 * 3. Atomically updates `current_status` and `updated_at` in the `items` table.
 * 4. Writes an `item_status_changed` AuditEntry to `audit_logs`.
 * 5. Publishes an `item_updated` WebSocket event (placeholder until task 15.2).
 * 6. Returns the updated item.
 *
 * @param lotId     - The item's lot ID (LOT-YYYY-NNNNN).
 * @param targetStatus - The desired new status.
 * @param userId    - The authenticated user's UUID (from JWT `sub`).
 * @param userEmail - The authenticated user's email (from JWT `email`).
 * @param ip        - The client IP address for audit logging.
 * @returns A promise resolving to the updated Item record.
 * @throws  `{ code: "NOT_FOUND", message }` if the item does not exist.
 * @throws  `{ code: "INVALID_TRANSITION", message, current_status, target_status, allowed }` for invalid transitions.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 5.1–5.6, 10.1, 11.1
 */
export async function updateItemStatus(
  lotId: string,
  targetStatus: ItemStatus,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<Item> {
  const supabase = getSupabaseClient();

  // Step 1: Fetch the item by lot_id (Req 5.2)
  const { data: itemData, error: fetchError } = await supabase
    .from("items")
    .select("*")
    .eq("lot_id", lotId)
    .single();

  if (fetchError || !itemData) {
    const err: NotFoundError = {
      code: "NOT_FOUND",
      message: "Item not found",
    };
    throw err;
  }

  const currentStatus = itemData.current_status as ItemStatus;

  // Step 2: Validate the transition (Req 5.1, 5.2, 5.3, 5.6)
  const { valid, allowed } = validateTransition(currentStatus, targetStatus);

  if (!valid) {
    const err: InvalidTransitionError = {
      code: "INVALID_TRANSITION",
      message: `Transition from '${currentStatus}' to '${targetStatus}' is not allowed. Allowed transitions: [${allowed.join(", ")}]`,
      current_status: currentStatus,
      target_status: targetStatus,
      allowed,
    };
    throw err;
  }

  // Step 3: Atomically update current_status and updated_at (Req 5.4)
  const updatedAt = new Date().toISOString();
  const { data: updatedItem, error: updateError } = await supabase
    .from("items")
    .update({
      current_status: targetStatus,
      updated_at: updatedAt,
    })
    .eq("lot_id", lotId)
    .select("*")
    .single();

  if (updateError || !updatedItem) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to update item status: ${updateError?.message ?? "no data returned"}`,
    };
    throw err;
  }

  // Step 4: Write item_status_changed AuditEntry (Req 5.4, 10.1)
  const auditError = await writeItemStatusChangedAudit({
    itemId: updatedItem.id as string,
    currentStatus,
    targetStatus,
    userId,
    userEmail,
    ip,
  });

  if (auditError) {
    // Log the failure but do NOT throw — item update is retained per Req 5.4
    console.error(
      `[item-service] Audit write failed for status change on ${lotId}: ${auditError}`,
    );
  }

  // Step 5: Publish item_updated WebSocket event (Req 11.1, 11.2)
  await publishWsEvent({
    event: "item_updated",
    data: {
      lot_id: updatedItem.lot_id as string,
      current_status: targetStatus,
      location_zone: updatedItem.location_zone as string,
      updated_at: updatedAt,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  // Step 6: Return the updated item (Req 5.4, 5.5)
  return updatedItem as Item;
}

/**
 * Updates the location zone of an existing item.
 *
 * Steps:
 * 1. Fetches the item by `lot_id` from the `items` table.
 * 2. Validates that `targetZone` exists in the `locations` table.
 * 3. Checks zone capacity: if `current_count >= capacity > 0`, rejects the move.
 * 4. Atomically updates `location_zone` and `updated_at` in the `items` table.
 * 5. Writes an `item_location_changed` AuditEntry to `audit_logs`.
 * 6. Publishes an `item_updated` WebSocket event with the new `location_zone`.
 * 7. Returns the updated item.
 *
 * @param lotId      - The item's lot ID (LOT-YYYY-NNNNN).
 * @param targetZone - The desired new location zone ID.
 * @param userId     - The authenticated user's UUID (from JWT `sub`).
 * @param userEmail  - The authenticated user's email (from JWT `email`).
 * @param ip         - The client IP address for audit logging.
 * @returns A promise resolving to the updated Item record.
 * @throws  `{ code: "NOT_FOUND", message }` if the item does not exist.
 * @throws  `{ code: "VALIDATION_ERROR", message, details }` if the zone does not exist or is at capacity.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 13.3, 14.3, 14.5, 10.1, 11.1
 */
export async function updateItemLocation(
  lotId: string,
  targetZone: string,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<Item> {
  const supabase = getSupabaseClient();

  // Step 1: Fetch the item by lot_id (Req 13.3)
  const { data: itemData, error: fetchError } = await supabase
    .from("items")
    .select("*")
    .eq("lot_id", lotId)
    .single();

  if (fetchError || !itemData) {
    const err: NotFoundError = {
      code: "NOT_FOUND",
      message: "Item not found",
    };
    throw err;
  }

  const oldZone = itemData.location_zone as string;

  // Step 2: Validate that targetZone exists in the locations table (Req 13.3, 14.3)
  const { data: locationData, error: locationFetchError } = await supabase
    .from("location_counts")
    .select("zone_id, capacity, current_count")
    .eq("zone_id", targetZone)
    .maybeSingle();

  if (locationFetchError || !locationData) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: `Zone '${targetZone}' does not exist`,
      details: { location_zone: "INVALID_ZONE" },
    };
    throw err;
  }

  // Step 3: Check zone capacity (Req 14.5)
  const capacity = Number(locationData.capacity);
  const currentCount = Number(locationData.current_count);

  if (capacity > 0 && currentCount >= capacity) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: `Zone '${targetZone}' is at capacity (${currentCount}/${capacity})`,
      details: { location_zone: "ZONE_AT_CAPACITY" },
    };
    throw err;
  }

  // Step 4: Atomically update location_zone and updated_at (Req 14.3)
  const updatedAt = new Date().toISOString();
  const { data: updatedItem, error: updateError } = await supabase
    .from("items")
    .update({
      location_zone: targetZone,
      updated_at: updatedAt,
    })
    .eq("lot_id", lotId)
    .select("*")
    .single();

  if (updateError || !updatedItem) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to update item location: ${updateError?.message ?? "no data returned"}`,
    };
    throw err;
  }

  // Step 5: Write item_location_changed AuditEntry (Req 10.1)
  const auditError = await writeItemLocationChangedAudit({
    itemId: updatedItem.id as string,
    oldZone,
    targetZone,
    userId,
    userEmail,
    ip,
  });

  if (auditError) {
    // Log the failure but do NOT throw — item update is retained per Req 11.1
    console.error(
      `[item-service] Audit write failed for location change on ${lotId}: ${auditError}`,
    );
  }

  // Step 6: Publish item_updated WebSocket event (Req 11.1)
  await publishWsEvent({
    event: "item_updated",
    data: {
      lot_id: updatedItem.lot_id as string,
      current_status: updatedItem.current_status as ItemStatus,
      location_zone: targetZone,
      updated_at: updatedAt,
    },
    meta: { timestamp: new Date().toISOString() },
  });

  // Step 7: Return the updated item
  return updatedItem as Item;
}

/**
 * Processes a batch of scan requests, updating each item's status independently.
 *
 * Steps:
 * 1. Validates that the batch does not exceed 50 items.
 * 2. Processes each item independently by calling `updateItemStatus`.
 * 3. Collects per-item results (success or failure).
 * 4. Writes one `item_bulk_updated` AuditEntry per successfully processed item.
 * 5. Returns the batch response with `processed_at` and `results` array.
 *
 * @param batch     - The scan batch request payload.
 * @param userId    - The authenticated user's UUID (from JWT `sub`).
 * @param userEmail - The authenticated user's email (from JWT `email`).
 * @param ip        - The client IP address for audit logging.
 * @returns A promise resolving to the scan batch response.
 * @throws  `{ code: "BATCH_TOO_LARGE", message }` if batch exceeds 50 items.
 *
 * Validates: Requirements 6.4–6.6, 6.8, 13.4, 13.5
 */
export async function processScanBatch(
  batch: ScanBatchRequest,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<ScanBatchResponse> {
  // Step 1: Validate batch size (Req 6.4, 13.5)
  if (batch.items.length > 50) {
    const err: BatchTooLargeError = {
      code: "BATCH_TOO_LARGE",
      message: "Batch exceeds maximum of 50 items",
    };
    throw err;
  }

  // Step 2 & 3: Process each item independently, collect results (Req 6.5, 6.6)
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

        // Step 4: Write one item_bulk_updated AuditEntry per successful item (Req 6.8, 10.1)
        const auditError = await writeItemBulkUpdatedAudit({
          itemId: updatedItem.id,
          lotId: scanItem.lot_id,
          targetStatus: scanItem.target_status,
          userId,
          userEmail,
          ip,
        });

        if (auditError) {
          console.error(
            `[item-service] Bulk audit write failed for item ${scanItem.lot_id}: ${auditError}`,
          );
        }

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

  // Step 5: Return the batch response (Req 6.6)
  return {
    processed_at: new Date().toISOString(),
    results,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Writes an `item_created` AuditEntry to the `audit_logs` table.
 *
 * Returns an error message string on failure, or `null` on success.
 * The caller decides whether to surface or swallow the error.
 *
 * @param params - Audit entry parameters.
 * @returns `null` on success, or an error message string on failure.
 */
async function writeItemCreatedAudit(params: {
  itemId: string;
  lotId: string;
  userId: string;
  userEmail: string;
  ip: string;
}): Promise<string | null> {
  const { itemId, lotId, userId, userEmail, ip } = params;
  const supabase = getSupabaseClient();

  const newState = JSON.stringify({
    lot_id: lotId,
    current_status: "received",
    location_zone: "RECEIVING",
  });

  const { error } = await supabase.from("audit_logs").insert({
    item_id: itemId,
    action: "item_created",
    previous_state: null,
    new_state: newState,
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    return error.message;
  }

  return null;
}

/**
 * Writes an `item_status_changed` AuditEntry to the `audit_logs` table.
 *
 * Returns an error message string on failure, or `null` on success.
 * The caller decides whether to surface or swallow the error.
 *
 * @param params - Audit entry parameters.
 * @returns `null` on success, or an error message string on failure.
 */
async function writeItemStatusChangedAudit(params: {
  itemId: string;
  currentStatus: ItemStatus;
  targetStatus: ItemStatus;
  userId: string;
  userEmail: string;
  ip: string;
}): Promise<string | null> {
  const { itemId, currentStatus, targetStatus, userId, userEmail, ip } = params;
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("audit_logs").insert({
    item_id: itemId,
    action: "item_status_changed",
    previous_state: JSON.stringify({ status: currentStatus }),
    new_state: JSON.stringify({ status: targetStatus }),
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    return error.message;
  }

  return null;
}

/**
 * Writes an `item_bulk_updated` AuditEntry to the `audit_logs` table.
 *
 * Returns an error message string on failure, or `null` on success.
 * The caller decides whether to surface or swallow the error.
 *
 * @param params - Audit entry parameters.
 * @returns `null` on success, or an error message string on failure.
 */
async function writeItemBulkUpdatedAudit(params: {
  itemId: string;
  lotId: string;
  targetStatus: ItemStatus;
  userId: string;
  userEmail: string;
  ip: string;
}): Promise<string | null> {
  const { itemId, lotId, targetStatus, userId, userEmail, ip } = params;
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("audit_logs").insert({
    item_id: itemId,
    action: "item_bulk_updated",
    previous_state: null,
    new_state: JSON.stringify({ lot_id: lotId, status: targetStatus }),
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    return error.message;
  }

  return null;
}

/**
 * Writes an `item_location_changed` AuditEntry to the `audit_logs` table.
 *
 * Returns an error message string on failure, or `null` on success.
 * The caller decides whether to surface or swallow the error.
 *
 * @param params - Audit entry parameters.
 * @returns `null` on success, or an error message string on failure.
 */
async function writeItemLocationChangedAudit(params: {
  itemId: string;
  oldZone: string;
  targetZone: string;
  userId: string;
  userEmail: string;
  ip: string;
}): Promise<string | null> {
  const { itemId, oldZone, targetZone, userId, userEmail, ip } = params;
  const supabase = getSupabaseClient();

  const { error } = await supabase.from("audit_logs").insert({
    item_id: itemId,
    action: "item_location_changed",
    previous_state: JSON.stringify({ location_zone: oldZone }),
    new_state: JSON.stringify({ location_zone: targetZone }),
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    timestamp: new Date().toISOString(),
  });

  if (error) {
    return error.message;
  }

  return null;
}

/**
 * Searches for an item by its `lot_id` or `id` (UUID), returning the full
 * item record with its complete audit history.
 *
 * Steps:
 * 1. Validates the query using `validateSearchQuery` — must be a Lot ID or UUID.
 * 2. Determines whether the query is a Lot ID or UUID.
 * 3. Queries the `items` table with an exact match on the appropriate field.
 * 4. If no item is found, throws `NOT_FOUND`.
 * 5. Fetches all `audit_logs` entries for the item, ordered by `timestamp DESC`.
 * 6. Maps audit log rows to `ItemHistoryEntry[]`.
 * 7. Returns the item with the `history` array attached.
 *
 * @param query  - The search query: a Lot ID (`LOT-YYYY-NNNNN`) or a UUID.
 * @param userId - The authenticated user's UUID (from JWT `sub`). Reserved for
 *                 future audit logging of search events.
 * @returns A promise resolving to the matching `Item` with `history` populated.
 * @throws  `{ code: "VALIDATION_ERROR", message, details }` for invalid queries.
 * @throws  `{ code: "NOT_FOUND", message }` when no item matches the query.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for unexpected DB errors.
 *
 * Validates: Requirements 9.1–9.7
 */
export async function searchItem(query: string, userId: string): Promise<Item> {
  // Step 1: Validate the query (Req 9.3, 9.7)
  const validation = validateSearchQuery({ query });
  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Invalid search query",
      details: validation.details ?? {
        query:
          "query must match the Lot ID format (LOT-YYYY-NNNNN) or be a valid UUID",
      },
    };
    throw err;
  }

  const supabase = getSupabaseClient();

  // Step 2: Determine query type — Lot ID or UUID (Req 9.7)
  const isLotId = LOT_ID_REGEX.test(query);

  // Step 3: Exact-match query on the appropriate field (Req 9.7)
  const dbQuery = supabase.from("items").select("*");
  const { data: itemData, error: fetchError } = await (
    isLotId ? dbQuery.eq("lot_id", query) : dbQuery.eq("id", query)
  ).maybeSingle();

  if (fetchError) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to query items: ${fetchError.message}`,
    };
    throw err;
  }

  // Step 4: Return NOT_FOUND if no match (Req 9.2)
  if (!itemData) {
    const err: NotFoundError = {
      code: "NOT_FOUND",
      message: "Item not found",
    };
    throw err;
  }

  // Step 5: Fetch audit history for the item (Req 9.1, 9.5)
  const { data: auditRows, error: auditError } = await supabase
    .from("audit_logs")
    .select("action, previous_state, new_state, user_id, user_email, timestamp")
    .eq("item_id", itemData.id)
    .order("timestamp", { ascending: false });

  if (auditError) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to fetch item history: ${auditError.message}`,
    };
    throw err;
  }

  // Step 6: Map audit log rows to ItemHistoryEntry[] (Req 9.1)
  const history: ItemHistoryEntry[] = (auditRows ?? []).map((row) => ({
    action: row.action as AuditAction,
    previous_state: row.previous_state as string | null,
    new_state: row.new_state as string,
    user_id: row.user_id as string,
    user_email: row.user_email as string,
    timestamp: row.timestamp as string,
  }));

  // Step 7: Return item with history attached (Req 9.1)
  // userId is accepted for future audit logging of search events (Req 9.1)
  void userId;

  return {
    ...(itemData as Item),
    history,
  };
}
