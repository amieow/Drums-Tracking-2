/**
 * Audit Service
 *
 * Provides business logic for querying and exporting the immutable audit log
 * using direct PostgreSQL queries via the `postgres` package.
 *
 * Requirements: 10.1–10.9
 */

import { getDb } from "@/lib/db";
import { validateAuditLogQuery } from "@/lib/validation";
import type { AuditEntry, AuditLogQuery, PaginationMeta } from "@/types";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const MAX_EXPORT_ENTRIES = 10_000;

export interface ValidationError {
  code: "VALIDATION_ERROR";
  message: string;
  details?: Record<string, string>;
}

export interface InternalError {
  code: "INTERNAL_ERROR";
  message: string;
}

export type AuditServiceError = ValidationError | InternalError;

export async function queryAuditLogs(
  query: AuditLogQuery,
  userId: string,
): Promise<{ entries: AuditEntry[]; pagination: PaginationMeta }> {
  const validation = validateAuditLogQuery(query);
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Audit log query validation failed",
      details: validation.details,
    } as ValidationError;
  }

  const page = Math.max(DEFAULT_PAGE, Number(query.page) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(query.limit) || DEFAULT_LIMIT),
  );
  const offset = (page - 1) * limit;

  const sql = getDb();

  // Build dynamic WHERE conditions
  const conditions: string[] = [];
  if (query.date_from) conditions.push(`timestamp >= '${query.date_from}'`);
  if (query.date_to) conditions.push(`timestamp <= '${query.date_to}'`);
  if (query.user_id) conditions.push(`user_id = '${query.user_id}'::uuid`);
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRows = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*) AS count FROM audit_logs ${where}`,
  );
  const total = parseInt(countRows[0]?.count ?? "0", 10);

  const dataRows = await sql.unsafe<AuditEntry[]>(
    `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`,
  );

  void userId;

  return {
    entries: dataRows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export async function exportAuditLogsCsv(
  query: AuditLogQuery,
  userId: string,
  userEmail: string,
  ip: string,
): Promise<string> {
  const validation = validateAuditLogQuery(query);
  if (!validation.valid) {
    throw {
      code: "VALIDATION_ERROR",
      message: "Audit log query validation failed",
      details: validation.details,
    } as ValidationError;
  }

  const sql = getDb();

  const conditions: string[] = [];
  if (query.date_from) conditions.push(`timestamp >= '${query.date_from}'`);
  if (query.date_to) conditions.push(`timestamp <= '${query.date_to}'`);
  if (query.user_id) conditions.push(`user_id = '${query.user_id}'::uuid`);
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await sql.unsafe<AuditEntry[]>(
    `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT ${MAX_EXPORT_ENTRIES + 1}`,
  );

  if (rows.length > MAX_EXPORT_ENTRIES) {
    throw {
      code: "VALIDATION_ERROR",
      message:
        "Result set exceeds 10,000 entries. Please narrow the date range.",
    } as ValidationError;
  }

  const csv = buildCsv(rows);

  const newState = JSON.stringify({
    date_from: query.date_from ?? null,
    date_to: query.date_to ?? null,
    format: "csv",
    count: rows.length,
  });

  await sql`
    INSERT INTO audit_logs (item_id, action, previous_state, new_state, user_id, user_email, ip_address, timestamp)
    VALUES (NULL, 'audit_exported', NULL, ${newState}, ${userId}::uuid, ${userEmail}, ${ip}, ${new Date().toISOString()})
  `.catch((e) =>
    console.error("[audit-service] Failed to write audit_exported entry:", e),
  );

  return csv;
}

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
  const dataRows = entries.map((entry) =>
    [
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
      .join(","),
  );
  return [headerRow, ...dataRows].join("\n");
}

function csvField(value: string | null | undefined): string {
  const str = value == null ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}
