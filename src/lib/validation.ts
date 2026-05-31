/**
 * Input Validation Utilities
 *
 * Provides validators for all major API input shapes used across the system.
 * Each validator returns `{ valid: boolean, details?: Record<string, string> }`
 * where `details` maps field names to human-readable error messages.
 *
 * Requirements: 3.4, 3.5, 6.4, 6.5, 9.3, 10.4, 13.1–13.7, 14.4
 */

import type { ItemStatus, LocationType } from "@/types";

// ─── Return Type ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  details?: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** All valid ItemStatus values (mirrors the union type). */
const VALID_ITEM_STATUSES: ItemStatus[] = [
  "received",
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
];

/** All valid LocationType values (mirrors the union type). */
const VALID_LOCATION_TYPES: LocationType[] = [
  "standard",
  "cold",
  "hazard",
  "qc",
  "production",
];

/** Lot ID format: LOT-YYYY-NNNNN */
const LOT_ID_REGEX = /^LOT-\d{4}-\d{5}$/;

/**
 * UUID v4 pattern — non-empty alphanumeric UUID format.
 * Accepts both hyphenated (8-4-4-4-12) and non-hyphenated forms.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO 8601 date: YYYY-MM-DD */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** ISO 8601 datetime (with time component and optional timezone). */
const ISO_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if `value` is a valid ISO 8601 date string (YYYY-MM-DD) that
 * represents a real calendar date.
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * Returns true if `value` is a valid ISO 8601 datetime string with a time
 * component (e.g., "2024-01-15T10:30:00Z").
 */
function isValidIsoDatetime(value: string): boolean {
  if (!ISO_DATETIME_REGEX.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * Returns true if `date` (YYYY-MM-DD) is not in the future relative to the
 * current UTC date.
 */
function isNotFutureDate(date: string): boolean {
  const today = new Date();
  // Compare only the date portion in UTC
  const todayStr = today.toISOString().split("T")[0];
  return date <= todayStr;
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Validates a drum registration request payload.
 *
 * Rules:
 * - `material_type`: non-empty string, 1–100 characters
 * - `supplier`: non-empty string, 1–100 characters
 * - `intake_date`: valid ISO 8601 date (YYYY-MM-DD), not in the future
 *
 * Requirements: 3.4, 3.5, 13.1, 13.2
 */
export function validateRegistrationInput(input: {
  material_type?: unknown;
  supplier?: unknown;
  intake_date?: unknown;
}): ValidationResult {
  const details: Record<string, string> = {};

  // Validate material_type
  if (
    typeof input.material_type !== "string" ||
    input.material_type.trim().length === 0
  ) {
    details.material_type = "material_type is required and must be non-empty";
  } else if (input.material_type.length > 100) {
    details.material_type = "material_type must be 100 characters or fewer";
  }

  // Validate supplier
  if (
    typeof input.supplier !== "string" ||
    input.supplier.trim().length === 0
  ) {
    details.supplier = "supplier is required and must be non-empty";
  } else if (input.supplier.length > 100) {
    details.supplier = "supplier must be 100 characters or fewer";
  }

  // Validate intake_date
  if (
    typeof input.intake_date !== "string" ||
    input.intake_date.trim().length === 0
  ) {
    details.intake_date = "intake_date is required";
  } else if (!isValidIsoDate(input.intake_date)) {
    details.intake_date =
      "intake_date must be a valid ISO 8601 date (YYYY-MM-DD)";
  } else if (!isNotFutureDate(input.intake_date)) {
    details.intake_date = "intake_date must not be in the future";
  }

  if (Object.keys(details).length > 0) {
    return { valid: false, details };
  }
  return { valid: true };
}

/**
 * Validates a bulk scan batch request payload.
 *
 * Rules:
 * - `items`: array with 1–50 elements
 * - Each item must have:
 *   - `lot_id`: non-empty string
 *   - `target_status`: valid `ItemStatus` enum member
 *   - `timestamp`: non-empty string (ISO 8601 client capture time)
 *
 * Requirements: 6.4, 6.5, 13.4, 13.5
 */
export function validateScanBatch(input: {
  items?: unknown;
}): ValidationResult {
  const details: Record<string, string> = {};

  if (!Array.isArray(input.items)) {
    details.items = "items must be an array";
    return { valid: false, details };
  }

  if (input.items.length === 0) {
    details.items = "items array must contain at least 1 item";
    return { valid: false, details };
  }

  if (input.items.length > 50) {
    details.items = "items array must not exceed 50 items";
    return { valid: false, details };
  }

  // Validate each item
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i] as Record<string, unknown>;

    if (typeof item !== "object" || item === null) {
      details[`items[${i}]`] = "each item must be an object";
      continue;
    }

    if (typeof item.lot_id !== "string" || item.lot_id.trim().length === 0) {
      details[`items[${i}].lot_id`] =
        "lot_id is required and must be non-empty";
    }

    if (
      typeof item.target_status !== "string" ||
      !VALID_ITEM_STATUSES.includes(item.target_status as ItemStatus)
    ) {
      details[`items[${i}].target_status`] =
        `target_status must be a valid ItemStatus (${VALID_ITEM_STATUSES.join(", ")})`;
    }

    if (
      typeof item.timestamp !== "string" ||
      item.timestamp.trim().length === 0
    ) {
      details[`items[${i}].timestamp`] =
        "timestamp is required and must be non-empty";
    }
  }

  if (Object.keys(details).length > 0) {
    return { valid: false, details };
  }
  return { valid: true };
}

/**
 * Validates an audit log query parameter object.
 *
 * Rules:
 * - `date_from` (optional): valid ISO 8601 datetime string
 * - `date_to` (optional): valid ISO 8601 datetime string
 * - `page` (optional): integer >= 1
 * - `limit` (optional): integer in range 1–50
 *
 * Requirements: 10.4
 */
export function validateAuditLogQuery(input: {
  date_from?: unknown;
  date_to?: unknown;
  page?: unknown;
  limit?: unknown;
}): ValidationResult {
  const details: Record<string, string> = {};

  if (input.date_from !== undefined && input.date_from !== null) {
    if (
      typeof input.date_from !== "string" ||
      !isValidIsoDatetime(input.date_from)
    ) {
      details.date_from =
        "date_from must be a valid ISO 8601 datetime string (e.g., 2024-01-15T10:30:00Z)";
    }
  }

  if (input.date_to !== undefined && input.date_to !== null) {
    if (
      typeof input.date_to !== "string" ||
      !isValidIsoDatetime(input.date_to)
    ) {
      details.date_to =
        "date_to must be a valid ISO 8601 datetime string (e.g., 2024-01-15T10:30:00Z)";
    }
  }

  if (input.page !== undefined && input.page !== null) {
    const page = Number(input.page);
    if (!Number.isInteger(page) || page < 1) {
      details.page = "page must be an integer >= 1";
    }
  }

  if (input.limit !== undefined && input.limit !== null) {
    const limit = Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      details.limit = "limit must be an integer between 1 and 50";
    }
  }

  if (Object.keys(details).length > 0) {
    return { valid: false, details };
  }
  return { valid: true };
}

/**
 * Validates a global search query string.
 *
 * Rules:
 * - Must be non-empty and non-whitespace
 * - Must match either:
 *   - The Lot ID format: `^LOT-\d{4}-\d{5}$`
 *   - A valid UUID (hyphenated 8-4-4-4-12 hex format)
 *
 * Requirements: 9.3
 */
export function validateSearchQuery(input: {
  query?: unknown;
}): ValidationResult {
  const details: Record<string, string> = {};

  if (typeof input.query !== "string" || input.query.trim().length === 0) {
    details.query = "query must be a non-empty, non-whitespace string";
    return { valid: false, details };
  }

  const isLotId = LOT_ID_REGEX.test(input.query);
  const isUuid = UUID_REGEX.test(input.query);

  if (!isLotId && !isUuid) {
    details.query =
      "query must match the Lot ID format (LOT-YYYY-NNNNN) or be a valid UUID";
    return { valid: false, details };
  }

  return { valid: true };
}

/**
 * Validates a location zone creation/update payload.
 *
 * Rules:
 * - `name`: non-empty string
 * - `type`: valid `LocationType` enum member
 * - If `type === "cold"`: `temperature_target` must be provided and in range −30 to 10
 * - `capacity`: number >= 0
 *
 * Requirements: 14.4
 */
export function validateLocationInput(input: {
  name?: unknown;
  type?: unknown;
  temperature_target?: unknown;
  capacity?: unknown;
}): ValidationResult {
  const details: Record<string, string> = {};

  // Validate name
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    details.name = "name is required and must be non-empty";
  }

  // Validate type
  if (
    typeof input.type !== "string" ||
    !VALID_LOCATION_TYPES.includes(input.type as LocationType)
  ) {
    details.type = `type must be one of: ${VALID_LOCATION_TYPES.join(", ")}`;
  } else if (input.type === "cold") {
    // Cold zones require a valid temperature_target
    if (
      input.temperature_target === undefined ||
      input.temperature_target === null
    ) {
      details.temperature_target =
        "temperature_target is required for cold zones";
    } else {
      const temp = Number(input.temperature_target);
      if (isNaN(temp) || temp < -30 || temp > 10) {
        details.temperature_target =
          "temperature_target must be a number between -30 and 10 (°C) for cold zones";
      }
    }
  }

  // Validate capacity
  if (input.capacity !== undefined && input.capacity !== null) {
    const cap = Number(input.capacity);
    if (isNaN(cap) || cap < 0 || !Number.isInteger(cap)) {
      details.capacity = "capacity must be a non-negative integer";
    }
  } else {
    // capacity is required
    details.capacity =
      "capacity is required and must be a non-negative integer";
  }

  if (Object.keys(details).length > 0) {
    return { valid: false, details };
  }
  return { valid: true };
}
