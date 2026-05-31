/**
 * Location Service
 *
 * Provides business logic for warehouse zone (location) management
 * using direct PostgreSQL queries via the `postgres` package.
 *
 * Requirements: 14.1–14.6
 */

import { getDb } from "@/lib/db";
import { validateLocationInput } from "@/lib/validation";
import type { Location, LocationType } from "@/types";

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details: Record<string, string>;
}

export interface NotFoundError {
  code: "NOT_FOUND";
  message: string;
}

export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

export type LocationServiceError =
  | ValidationError
  | NotFoundError
  | InternalError;

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

export async function listLocations(): Promise<Location[]> {
  const sql = getDb();
  const rows = await sql<
    {
      zone_id: string;
      name: string;
      type: string;
      temperature_target: number | null;
      capacity: number;
      current_count: number;
    }[]
  >`
    SELECT zone_id, name, type, temperature_target, capacity, current_count
    FROM location_counts
  `;

  return rows.map((row) => ({
    zone_id: row.zone_id,
    name: row.name,
    type: row.type as LocationType,
    temperature_target:
      row.temperature_target != null
        ? Number(row.temperature_target)
        : undefined,
    capacity: Number(row.capacity),
    current_count: Number(row.current_count),
  }));
}

export async function createLocation(
  input: CreateLocationInput,
  userId: string,
): Promise<Location> {
  const validation = validateLocationInput({
    name: input.name,
    type: input.type,
    temperature_target: input.temperature_target,
    capacity: input.capacity,
  });
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Location input validation failed",
      details: validation.details ?? {},
    } as ValidationError;
  }

  const sql = getDb();
  const rows = await sql<
    {
      zone_id: string;
      name: string;
      type: string;
      temperature_target: number | null;
      capacity: number;
    }[]
  >`
    INSERT INTO locations (zone_id, name, type, temperature_target, capacity)
    VALUES (
      ${input.zone_id},
      ${input.name},
      ${input.type},
      ${input.temperature_target ?? null},
      ${input.capacity}
    )
    RETURNING zone_id, name, type, temperature_target, capacity
  `;

  if (rows.length === 0) {
    throw {
      code: "INTERNAL_ERROR",
      message: "Failed to create location: no data returned",
    } as InternalError;
  }

  void userId;
  const row = rows[0];
  return {
    zone_id: row.zone_id,
    name: row.name,
    type: row.type as LocationType,
    temperature_target:
      row.temperature_target != null
        ? Number(row.temperature_target)
        : undefined,
    capacity: Number(row.capacity),
    current_count: 0,
  };
}

export async function updateLocation(
  zoneId: string,
  input: UpdateLocationInput,
  userId: string,
): Promise<Location> {
  const sql = getDb();

  const existingRows = await sql<
    {
      zone_id: string;
      name: string;
      type: string;
      temperature_target: number | null;
      capacity: number;
    }[]
  >`
    SELECT zone_id, name, type, temperature_target, capacity FROM locations WHERE zone_id = ${zoneId} LIMIT 1
  `;

  if (existingRows.length === 0) {
    throw { code: "NOT_FOUND", message: "Location not found" } as NotFoundError;
  }

  const existing = existingRows[0];
  const merged = {
    name: input.name !== undefined ? input.name : existing.name,
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

  const validation = validateLocationInput(merged);
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Location input validation failed",
      details: validation.details ?? {},
    } as ValidationError;
  }

  const temperatureTarget =
    merged.type === "cold" && merged.temperature_target !== undefined
      ? merged.temperature_target
      : null;

  const updateRows = await sql<
    {
      zone_id: string;
      name: string;
      type: string;
      temperature_target: number | null;
      capacity: number;
    }[]
  >`
    UPDATE locations
    SET name = ${merged.name}, type = ${merged.type}, capacity = ${merged.capacity}, temperature_target = ${temperatureTarget}, updated_at = NOW()
    WHERE zone_id = ${zoneId}
    RETURNING zone_id, name, type, temperature_target, capacity
  `;

  if (updateRows.length === 0) {
    throw {
      code: "INTERNAL_ERROR",
      message: "Failed to update location: no data returned",
    } as InternalError;
  }

  const countRows = await sql<{ current_count: number }[]>`
    SELECT current_count FROM location_counts WHERE zone_id = ${zoneId} LIMIT 1
  `;
  const currentCount =
    countRows.length > 0 ? Number(countRows[0].current_count) : 0;

  void userId;
  const row = updateRows[0];
  return {
    zone_id: row.zone_id,
    name: row.name,
    type: row.type as LocationType,
    temperature_target:
      row.temperature_target != null
        ? Number(row.temperature_target)
        : undefined,
    capacity: Number(row.capacity),
    current_count: currentCount,
  };
}
