/**
 * Audit Service
 *
 * Provides business logic for querying and exporting the immutable audit log:
 * - `queryAuditLogs`: paginated query with optional date/user filters
 * - `exportAuditLogsCsv`: full CSV export (max 10,000 entries) with self-audit
 *
 * All database operations use the server-side Supabase client (service role),
 * which bypasses RLS for trusted server-side reads and writes.
 *
 * Requirements: 10.1–10.9
 */

import { getSupabaseClient } from "@/lib/supabase";
import { validateAuditLogQuery } from "@/lib/validation";
import type { AuditEntry, AuditLogQuery, PaginationMeta } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const MAX_EXPORT_ENTRIES = 10_000;

// ─── Error Types ──────────────────────────────────────────────────────────────

/** Thrown when query parameter validation fails (Requirement 10.4). */
export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details?: Record<string, string>;
}

/** Thrown when a database or unexpected server error occurs (Requirement 10.9). */
export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

export type AuditServiceError = ValidationError | InternalError;

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Queries the audit log with optional date range and user filters, returning
 * a paginated result set.
 *
 * Steps:
 * 1. Validates `date_from`, `date_to`, `page`, and `limit` via
 *    `validateAuditLogQuery`.
 * 2. Builds a Supabase query against `audit_logs` with optional filters.
 * 3. Orders results by `timestamp DESC` and applies pagination.
 * 4. Returns `{ entries, pagination }`.
 *
 * @param query  - The audit log query parameters.
 * @param userId - The authenticated admin's UUID (used for access context).
 * @returns A promise resolving to paginated audit entries and pagination meta.
 * @throws `{ code: "VALIDATION_ERROR", message, details }` for invalid params.
 * @throws `{ code: "INTERNAL_ERROR", message }` for database errors.
 *
 * Validates: Requirements 10.4, 10.5
 */
export async function queryAuditLogs(
  query: AuditLogQuery,
  userId: string,
): Promise<{ entries: AuditEntry[]; pagination: PaginationMeta }> {
  // Step 1: Validate query parameters (Req 10.4)
  const validation = validateAuditLogQuery(query);
  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Audit log query validation failed",
      details: validation.details,
    };
    throw err;
  }

  // Resolve pagination values with defaults and caps
  const page = Math.max(DEFAULT_PAGE, Number(query.page) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(query.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  const supabase = getSupabaseClient();

  // Step 2: Build the count query for pagination metadata
  let countQuery = supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true });

  if (query.date_from) {
    countQuery = countQuery.gte("timestamp", query.date_from);
  }
  if (query.date_to) {
    countQuery = countQuery.lte("timestamp", query.date_to);
  }
  if (query.user_id) {
    countQuery = countQuery.eq("user_id", query.user_id);
  }

  const { count, error: countError } = await countQuery;

  if (countError) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to count audit log entries: ${countError.message}`,
    };
    throw err;
  }

  const total = count ?? 0;

  // Step 3: Build the data query with filters, ordering, and pagination (Req 10.4)
  let dataQuery = supabase
    .from("audit_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.date_from) {
    dataQuery = dataQuery.gte("timestamp", query.date_from);
  }
  if (query.date_to) {
    dataQuery = dataQuery.lte("timestamp", query.date_to);
  }
  if (query.user_id) {
    dataQuery = dataQuery.eq("user_id", query.user_id);
  }

  const { data, error: dataError } = await dataQuery;

  if (dataError) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to query audit log entries: ${dataError.message}`,
    };
    throw err;
  }

  const entries = (data ?? []) as AuditEntry[];
  const pages = Math.ceil(total / limit);

  // Step 4: Return entries and pagination metadata
  return {
    entries,
    pagination: {
      page,
      limit,
      total,
      pages,
    },
  };
}

/**
 * Exports all matching audit log entries as a CSV string (max 10,000 entries).
 *
 * Steps:
 * 1. Validates query parameters via `validateAuditLogQuery`.
 * 2. Queries ALL matching audit logs (no pagination, but capped at 10,001 to
 *    detect overflow).
 * 3. If result count > 10,000: throws a VALIDATION_ERROR.
 * 4. Converts entries to CSV format with headers.
 * 5. Writes an `audit_exported` AuditEntry recording the export parameters.
 * 6. Returns the CSV string.
 *
 * CSV columns: id, item_id, action, previous_state, new_state, user_id,
 *              user_email, ip_address, timestamp
 *
 * @param query     - The audit log query parameters (date range, user filter).
 * @param userId    - The exporting admin's UUID.
 * @param userEmail - The exporting admin's email.
 * @param ip        - The client IP address for the self-audit entry.
 * @returns A promise resolving to the CSV string.
 * @throws `{ code: "VALIDATION_ERROR", message, details? }` for invalid params
 *         or result set exceeding 10,000 entries.
 * @throws `{ code: "INTERNAL_ERROR", message }` for database errors.
 *
 * Validates: Requirements 10.6, 10.7
 */
export async function exportAuditLogsCsv(
  query: AuditLogQuery,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<string> {
  // Step 1: Validate query parameters (Req 10.4)
  const validation = validateAuditLogQuery(query);
  if (!validation.valid) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message: "Audit log query validation failed",
      details: validation.details,
    };
    throw err;
  }

  const supabase = getSupabaseClient();

  // Step 2: Query ALL matching entries, fetching up to MAX_EXPORT_ENTRIES + 1
  // to detect overflow without pulling the entire dataset (Req 10.6)
  let dataQuery = supabase
    .from("audit_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(MAX_EXPORT_ENTRIES + 1);

  if (query.date_from) {
    dataQuery = dataQuery.gte("timestamp", query.date_from);
  }
  if (query.date_to) {
    dataQuery = dataQuery.lte("timestamp", query.date_to);
  }
  if (query.user_id) {
    dataQuery = dataQuery.eq("user_id", query.user_id);
  }

  const { data, error: dataError } = await dataQuery;

  if (dataError) {
    const err: InternalError = {
      code: "INTERNAL_ERROR",
      message: `Failed to query audit log entries for export: ${dataError.message}`,
    };
    throw err;
  }

  const rows = (data ?? []) as AuditEntry[];

  // Step 3: Reject if result set exceeds 10,000 entries (Req 10.6)
  if (rows.length > MAX_EXPORT_ENTRIES) {
    const err: ValidationError = {
      code: "VALIDATION_ERROR",
      message:
        "Result set exceeds 10,000 entries. Please narrow the date range.",
    };
    throw err;
  }

  // Step 4: Convert entries to CSV format (Req 10.6)
  const csv = buildCsv(rows);

  // Step 5: Write `audit_exported` AuditEntry (Req 10.7)
  const exportAuditError = await writeAuditExportedEntry({
    userId,
    userEmail,
    ip,
    dateFrom: query.date_from,
    dateTo: query.date_to,
    count: rows.length,
  });

  if (exportAuditError) {
    // Log the failure but do NOT suppress the export — the CSV is still returned.
    // Per Req 10.9: audit write failures must not be silently discarded, but
    // the export itself is a read operation that has already succeeded.
    console.error(
      `[audit-service] Failed to write audit_exported entry: ${exportAuditError}`,
    );
  }

  // Step 6: Return the CSV string
  return csv;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Converts an array of AuditEntry records into a CSV string.
 *
 * Headers: id, item_id, action, previous_state, new_state, user_id,
 *          user_email, ip_address, timestamp
 *
 * Each field is wrapped in double quotes. Internal double quotes are escaped
 * by doubling them ("").
 *
 * @param entries - The audit entries to serialize.
 * @returns A CSV string with a header row followed by one row per entry.
 */
function buildCsv(entries: AuditEntry[]): string {
  const headers = [
    "id",
    "item_id",
    "action",
    "previous_state",
    "new_state",
    "user_id",
    "user_email",
    "ip_address",
    "timestamp",
  ];

  const headerRow = headers.map(csvField).join(",");

  const dataRows = entries.map((entry) => {
    return [
      entry.id,
      entry.item_id ?? "",
      entry.action,
      entry.previous_state ?? "",
      entry.new_state ?? "",
      entry.user_id,
      entry.user_email,
      entry.ip_address,
      entry.timestamp,
    ]
      .map(csvField)
      .join(",");
  });

  return [headerRow, ...dataRows].join("\n");
}

/**
 * Wraps a value in double quotes and escapes any internal double quotes by
 * doubling them, per RFC 4180 CSV conventions.
 *
 * @param value - The raw field value (coerced to string).
 * @returns The quoted CSV field string.
 */
function csvField(value: string | null | undefined): string {
  const str = value == null ? "" : String(value);
  // Escape internal double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Writes an `audit_exported` AuditEntry to the `audit_logs` table.
 *
 * Returns an error message string on failure, or `null` on success.
 * The caller decides whether to surface or swallow the error.
 *
 * @param params - Export audit parameters.
 * @returns `null` on success, or an error message string on failure.
 */
async function writeAuditExportedEntry(params: {
  userId: string;
  userEmail: string;
  ip: string;
  dateFrom?: string;
  dateTo?: string;
  count: number;
}): Promise<string | null> {
  const { userId, userEmail, ip, dateFrom, dateTo, count } = params;
  const supabase = getSupabaseClient();

  const newState = JSON.stringify({
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    format: "csv",
    count,
  });

  const { error } = await supabase.from("audit_logs").insert({
    item_id: null,
    action: "audit_exported",
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
