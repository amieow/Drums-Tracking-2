/**
 * Drums Tracking — Shared TypeScript Type Definitions
 *
 * This file is the single source of truth for all domain types, enums,
 * request/response shapes, and API envelope types used across the application.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

/** The four roles a user can hold in the system. */
export type UserRole = "operator" | "qc" | "ppic" | "admin";

/** All valid lifecycle states for a drum/item. */
export type ItemStatus =
  | "received"
  | "qc_pending"
  | "qc_pass"
  | "qc_fail"
  | "in_production"
  | "finished"
  | "cold_storage"
  | "dispatched"
  | "archived";

/** The physical/functional type of a warehouse zone. */
export type LocationType = "standard" | "cold" | "hazard" | "qc" | "production";

/** Every auditable action the system can record. */
export type AuditAction =
  | "item_created"
  | "item_status_changed"
  | "item_location_changed"
  | "item_bulk_updated"
  | "user_login"
  | "user_logout"
  | "audit_exported"
  | "forbidden_attempt";

// ─── Core Entities ────────────────────────────────────────────────────────────

/** A Sima Arome staff member with an assigned role. */
export interface User {
  id: string; // UUID
  email: string;
  role: UserRole;
  created_at: string; // ISO 8601
}

/** The decoded payload of a Supabase-issued JWT. */
export interface JWTPayload {
  sub: string; // user.id (UUID)
  email: string;
  role: UserRole;
  iat: number; // issued-at (Unix seconds)
  exp: number; // iat + 28800 (8 hours)
}

/** A single drum of raw material or finished extract tracked by the system. */
export interface Item {
  id: string; // UUID (internal primary key)
  lot_id: string; // LOT-YYYY-NNNNN
  material_type: string; // 1–100 chars
  supplier: string; // 1–100 chars
  intake_date: string; // ISO 8601 date (YYYY-MM-DD)
  current_status: ItemStatus;
  location_zone: string; // FK → locations.zone_id
  created_by: string; // FK → users.id
  created_at: string; // ISO 8601 datetime
  updated_at: string; // ISO 8601 datetime
  history?: ItemHistoryEntry[]; // Populated on GET /items/:id and search
}

/** One entry in an item's lifecycle history (derived from audit_logs). */
export interface ItemHistoryEntry {
  action: AuditAction;
  previous_state: string | null;
  new_state: string;
  user_id: string;
  user_email: string;
  timestamp: string; // ISO 8601
}

/** A named warehouse zone with capacity and type information. */
export interface Location {
  zone_id: string; // e.g., "COLD-A", "QC-01", "RECEIVING"
  name: string; // Human-readable label
  type: LocationType;
  /** Required when type === "cold". Range: −30 to 10 °C. */
  temperature_target?: number;
  capacity: number; // 0 = unlimited
  current_count: number; // Computed: COUNT(items WHERE location_zone = zone_id)
}

/** An immutable, append-only record of a system event. */
export interface AuditEntry {
  id: string; // UUID
  item_id: string | null; // null for non-item events (e.g., user_login)
  action: AuditAction;
  previous_state: string | null; // JSON string or null
  new_state: string | null; // JSON string or null
  user_id: string;
  user_email: string;
  ip_address: string;
  timestamp: string; // ISO 8601, server-generated
  metadata?: Record<string, unknown>; // Extra context (e.g., export params)
}

// ─── Offline ScanQueue (localStorage) ────────────────────────────────────────

/** A single scan buffered locally while the device is offline. */
export interface QueuedScan {
  id: string; // Client-generated UUID v4
  lot_id: string;
  target_status: ItemStatus;
  timestamp: string; // ISO 8601 client capture time
  retries: number; // 0–3
  status: "pending" | "failed";
  error?: string;
}

// ─── API Request / Response Shapes ───────────────────────────────────────────

// Auth

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: Pick<User, "id" | "email" | "role">;
}

// Item Registration

export interface RegisterItemRequest {
  material_type: string;
  supplier: string;
  intake_date: string; // ISO 8601 date (YYYY-MM-DD)
}

export interface RegisterItemResponse {
  lot_id: string;
  qr_code: string; // URL: https://{host}/api/qr/{lot_id}
  created_at: string;
  current_status: "received";
  location_zone: "RECEIVING";
}

// Bulk Scan

export interface ScanItem {
  lot_id: string;
  target_status: ItemStatus;
  /** ISO 8601 client capture time; server may override with its own timestamp. */
  timestamp: string;
}

export interface ScanBatchRequest {
  items: ScanItem[]; // 1–50 items
}

export interface ScanResult {
  lot_id: string;
  success: boolean;
  error?: string;
  item?: Pick<Item, "lot_id" | "current_status" | "location_zone">;
}

export interface ScanBatchResponse {
  processed_at: string; // ISO 8601
  results: ScanResult[];
}

// Audit Log

export interface AuditLogQuery {
  date_from?: string; // ISO 8601
  date_to?: string; // ISO 8601
  user_id?: string;
  page?: number; // default: 1
  limit?: number; // default: 50, max: 50
}

// ─── Standard API Envelope ────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
  meta: {
    timestamp: string; // ISO 8601
    request_id: string; // UUID v4
  };
}

export interface ApiError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string>; // Field-level info for VALIDATION_ERROR
  };
  meta: {
    timestamp: string; // ISO 8601
    request_id: string; // UUID v4
  };
}

/** All machine-readable error codes returned by the API. */
export type ErrorCode =
  | "INVALID_INPUT" // 400 — missing or malformed request body/params
  | "VALIDATION_ERROR" // 422 — field-level validation failure
  | "UNAUTHORIZED" // 401 — missing, invalid, or expired JWT
  | "AUTH_FAILED" // 401 — wrong credentials at login
  | "FORBIDDEN" // 403 — valid token but insufficient role
  | "NOT_FOUND" // 404 — resource does not exist
  | "INVALID_TRANSITION" // 422 — state machine violation
  | "BATCH_TOO_LARGE" // 413 — ScanBatch > 50 items
  | "RATE_LIMITED" // 429 — >5 failed logins in 10 min from same IP
  | "INTERNAL_ERROR"; // 500 — unexpected server error

// ─── WebSocket Events (Server → Client) ──────────────────────────────────────

/** Broadcast when an item's status or location changes. */
export interface WsItemUpdatedEvent {
  event: "item_updated";
  data: {
    lot_id: string;
    current_status: ItemStatus;
    location_zone: string;
    updated_at: string; // ISO 8601
  };
  meta: { timestamp: string };
}

/** Broadcast when a new item is registered. */
export interface WsItemCreatedEvent {
  event: "item_created";
  data: {
    lot_id: string;
    material_type: string;
    current_status: "received";
    created_at: string; // ISO 8601
  };
  meta: { timestamp: string };
}

/** Broadcast when the server needs to signal an error to the client. */
export interface WsErrorEvent {
  event: "error";
  data: {
    code: "TOKEN_EXPIRED" | "CONNECTION_CLOSED" | "UNAUTHORIZED";
    message: string;
  };
  meta: { timestamp: string };
}

/** Discriminated union of all server-to-client WebSocket event shapes. */
export type WsServerEvent =
  | WsItemUpdatedEvent
  | WsItemCreatedEvent
  | WsErrorEvent;

// ─── State Machine Constant ───────────────────────────────────────────────────

/**
 * The authoritative map of valid item status transitions.
 * Used by the Item Service to enforce the state machine.
 */
export const VALID_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  received: ["qc_pending"],
  qc_pending: ["qc_pass", "qc_fail"],
  qc_pass: ["in_production", "cold_storage"],
  qc_fail: ["archived"],
  in_production: ["finished"],
  finished: ["cold_storage", "dispatched"],
  cold_storage: ["dispatched"],
  dispatched: ["archived"],
  archived: [],
} as const;

// ─── Error Code → HTTP Status Mapping ────────────────────────────────────────

/** Maps each ErrorCode to its canonical HTTP status code. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 422,
  BATCH_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;
