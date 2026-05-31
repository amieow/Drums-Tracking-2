/**
 * Location Service
 *
 * Provides business logic for warehouse zone (location) management:
 * - Listing all locations with computed current_count (via `location_counts` view)
 * - Creating new location zones with validation
 * - Updating existing location zones with validation
 *
 * All database operations use the server-side Supabase client (service role),
 * which bypasses RLS for trusted server-side writes.
 *
 * Requirements: 14.1–14.6
 */

import { getSupabaseClient } from "@/lib/supabase";
import { validateLocationInput } from "@/lib/validation";
import type { Location, LocationType } from "@/types";

// ─── Error Types ──────────────────────────────────────────────────────────────

/** Thrown when input validation fails (Requirement 14.4). */
export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details: Record<string, string>;
}

/** Thrown when the requested location does not exist. */
export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

/** Thrown when a database or unexpected server error occurs. */
export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

export type LocationServiceError =
  | ValidationError
  | NotFoundError
  | InternalError;

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateLocationInput {
  zone_id: string;
  name: string;
  type: LocationType;
  temperature_target?: number;
  capacity: number;
}

export interface UpdateLocationInput {
  name?: string;
  type?: LocationType;
  temperature_target?: number;
  capacity?: number;
}

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Lists all warehouse locations with their computed current drum count.
 *
 * Queries the `location_counts` view which joins `locations` with `items`
 * to compute `current_count` for each zone.
 *
 * @returns A promise resolving to an array of Location records.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 14.1, 14.2
 */
export async function listLocations(): Promise<Location[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("location_counts")
    .select("zone_id, name, type, temperature_target, capacity, current_count");

  if (error) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to fetch locations: ${error.message}`,
    };
    throw err;
  }

  return (data ?? []).map((row) => ({
    zone_id: row.zone_id as string,
    name: row.name as string,
    type: row.type as LocationType,
    temperature_target:
      row.temperature_target != null
        ? Number(row.temperature_target)
        : undefined,
    capacity: Number(row.capacity),
    current_count: Number(row.current_count),
  }));
}

/**
 * Creates a new warehouse location zone.
 *
 * Steps:
 * 1. Validates the input using `validateLocationInput` (enforces cold zone
 *    temperature requirement and capacity constraints per Req 14.4).
 * 2. Inserts the new location into the `locations` table.
 * 3. Returns the created location with `current_count: 0`.
 *
 * @param input  - The location creation payload.
 * @param userId - The authenticated user's UUID (from JWT `sub`).
 * @returns A promise resolving to the created Location record.
 * @throws  `{ code: "VALIDATION_ERROR", message, details }` for invalid input.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 14.1, 14.3, 14.4
 */
export async function createLocation(
  input: CreateLocationInput,
  userId: string,
): Promise<Location> {
  // Step 1: Validate input (Req 14.4)
  const validation = validateLocationInput({
    name: input.name,
    type: input.type,
    temperature_target: input.temperature_target,
    capacity: input.capacity,
  });

  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Location input validation failed",
      details: validation.details ?? {},
    };
    throw err;
  }

  const supabase = getSupabaseClient();

  // Step 2: Insert the location into the `locations` table (Req 14.1)
  const insertPayload: Record<string, unknown> = {
    zone_id: input.zone_id,
    name: input.name,
    type: input.type,
    capacity: input.capacity,
  };

  if (input.temperature_target !== undefined) {
    insertPayload.temperature_target = input.temperature_target;
  }

  const { data, error } = await supabase
    .from("locations")
    .insert(insertPayload)
    .select("zone_id, name, type, temperature_target, capacity")
    .single();

  if (error || !data) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to create location: ${error?.message ?? "no data returned"}`,
    };
    throw err;
  }

  // Step 3: Return the created location with current_count: 0 (Req 14.2)
  return {
    zone_id: data.zone_id as string,
    name: data.name as string,
    type: data.type as LocationType,
    temperature_target:
      data.temperature_target != null
        ? Number(data.temperature_target)
        : undefined,
    capacity: Number(data.capacity),
    current_count: 0,
  };
}

/**
 * Updates an existing warehouse location zone.
 *
 * Steps:
 * 1. Fetches the existing location by `zoneId`.
 * 2. If not found: throws `{ code: "NOT_FOUND", message: "Location not found" }`.
 * 3. Merges the input with existing values (partial update).
 * 4. Validates the merged values using `validateLocationInput`.
 * 5. If invalid: throws `{ code: "VALIDATION_ERROR", message, details }`.
 * 6. Updates the location in the `locations` table.
 * 7. Returns the updated location with the current `current_count` from the
 *    `location_counts` view.
 *
 * @param zoneId - The zone's unique identifier.
 * @param input  - The partial update payload.
 * @param userId - The authenticated user's UUID (from JWT `sub`).
 * @returns A promise resolving to the updated Location record.
 * @throws  `{ code: "NOT_FOUND", message }` if the location does not exist.
 * @throws  `{ code: "VALIDATION_ERROR", message, details }` for invalid merged values.
 * @throws  `{ code: "INTERNAL_ERROR", message }` for DB errors.
 *
 * Validates: Requirements 14.1, 14.3, 14.4
 */
export async function updateLocation(
  zoneId: string,
  input: UpdateLocationInput,
  userId: string,
): Promise<Location> {
  const supabase = getSupabaseClient();

  // Step 1: Fetch the existing location (Req 14.1)
  const { data: existing, error: fetchError } = await supabase
    .from("locations")
    .select("zone_id, name, type, temperature_target, capacity")
    .eq("zone_id", zoneId)
    .single();

  // Step 2: Not found check
  if (fetchError || !existing) {
    const err: NotFoundError = {
      code: "NOT_FOUND",
      message: "Location not found",
    };
    throw err;
  }

  // Step 3: Merge input with existing values
  const merged = {
    name: input.name !== undefined ? input.name : (existing.name as string),
    type:
      input.type !== undefined ? input.type : (existing.type as LocationType),
    temperature_target:
      input.temperature_target !== undefined
        ? input.temperature_target
        : existing.temperature_target != null
          ? Number(existing.temperature_target)
          : undefined,
    capacity:
      input.capacity !== undefined ? input.capacity : Number(existing.capacity),
  };

  // Step 4: Validate merged values (Req 14.4)
  const validation = validateLocationInput({
    name: merged.name,
    type: merged.type,
    temperature_target: merged.temperature_target,
    capacity: merged.capacity,
  });

  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Location input validation failed",
      details: validation.details ?? {},
    };
    throw err;
  }

  // Step 5: Build update payload
  const updatePayload: Record<string, unknown> = {
    name: merged.name,
    type: merged.type,
    capacity: merged.capacity,
    updated_at: new Date().toISOString(),
  };

  // Only include temperature_target if it has a value; set to null if not cold
  if (merged.type === "cold" && merged.temperature_target !== undefined) {
    updatePayload.temperature_target = merged.temperature_target;
  } else if (merged.type !== "cold") {
    updatePayload.temperature_target = null;
  }

  // Step 6: Update the location in the `locations` table (Req 14.1)
  const { data: updatedData, error: updateError } = await supabase
    .from("locations")
    .update(updatePayload)
    .eq("zone_id", zoneId)
    .select("zone_id, name, type, temperature_target, capacity")
    .single();

  if (updateError || !updatedData) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to update location: ${updateError?.message ?? "no data returned"}`,
    };
    throw err;
  }

  // Step 7: Fetch current_count from location_counts view (Req 14.2)
  const { data: countData, error: countError } = await supabase
    .from("location_counts")
    .select("current_count")
    .eq("zone_id", zoneId)
    .single();

  const currentCount =
    countError || !countData ? 0 : Number(countData.current_count);

  return {
    zone_id: updatedData.zone_id as string,
    name: updatedData.name as string,
    type: updatedData.type as LocationType,
    temperature_target:
      updatedData.temperature_target != null
        ? Number(updatedData.temperature_target)
        : undefined,
    capacity: Number(updatedData.capacity),
    current_count: currentCount,
  };
}
