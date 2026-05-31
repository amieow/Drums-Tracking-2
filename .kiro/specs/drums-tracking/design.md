# Design Document: Drums Tracking

## Overview

Drums Trackers is an enterprise-grade inventory management system for Sima Arome's warehouse and production floor. It replaces fragmented manual processes with a secure, real-time, auditable single source of truth for every drum of raw material and finished extract.

The system is built on a two-tier architecture: a **Next.js 16 (App Router)** frontend acting as both the user-facing application and a server-side API proxy, backed by a **Buildpad DaaS** REST API server that persists data to **Supabase PostgreSQL**. Authentication is handled entirely by **Supabase Auth** (JWT-based). Real-time updates flow over WebSocket. The mobile experience is a PWA with offline scan buffering via `localStorage`.

### Key Design Goals

- **Single source of truth**: Every drum has one authoritative record, updated atomically with an immutable audit trail.
- **Offline resilience**: Operators can scan in dead zones; scans queue locally and sync automatically.
- **Strict state machine**: Invalid lifecycle transitions are rejected at the service layer, not just the UI.
- **WORM compliance**: Audit logs are append-only at the database level — no role can delete or modify them.
- **Sub-500ms scan latency**: End-to-end from scan to confirmed DB update must complete within 500ms.

---

## Architecture

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                          │
│                                                                              │
│  ┌─────────────────────┐          ┌─────────────────────┐                   │
│  │   Mobile PWA        │          │   Web Dashboard     │                   │
│  │  (Next.js PWA)      │          │  (Next.js App)      │                   │
│  │  - Camera scan      │          │  - Floor plan view  │                   │
│  │  - Offline queue    │          │  - Audit viewer     │                   │
│  │  - ScanQueue (LS)   │          │  - Search           │                   │
│  └──────────┬──────────┘          └──────────┬──────────┘                   │
│             │ HTTPS                           │ HTTPS / WSS                  │
└─────────────┼───────────────────────────────┼──────────────────────────────┘
              │                               │
              ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     NEXT.JS API GATEWAY (Server-Side Proxy)                  │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  /api/auth/* │  │ /api/items/* │  │/api/audit-*  │  │ /api/health  │    │
│  │  JWT verify  │  │ RBAC check   │  │ Admin-only   │  │ /readiness   │    │
│  │  Rate limit  │  │ Validation   │  │ Pagination   │  │              │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────┘    │
│         │                 │                  │                               │
└─────────┼─────────────────┼──────────────────┼───────────────────────────────┘
          │                 │                  │
          ▼                 ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     BUILDPAD DaaS BACKEND                                    │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Auth Service │  │ Item Service │  │Audit Service │  │  WebSocket   │    │
│  │ (Supabase)   │  │ State machine│  │ WORM writes  │  │  Broadcaster │    │
│  │ JWT issuance │  │ Lot ID gen   │  │ CSV export   │  │  (wss://)    │    │
│  │ RBAC roles   │  │ QR codes     │  │              │  │              │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                  │                  │            │
└─────────┼─────────────────┼──────────────────┼──────────────────┼────────────┘
          │                 │                  │                  │
          ▼                 ▼                  ▼                  │
┌──────────────────────────────────────────────────────────────┐  │
│                  SUPABASE POSTGRESQL                          │  │
│                                                              │  │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │  │
│  │   items    │  │ locations  │  │      audit_logs        │  │  │
│  │ (RLS)      │  │ (RLS)      │  │  (append-only, RLS)    │  │  │
│  └────────────┘  └────────────┘  └────────────────────────┘  │  │
└──────────────────────────────────────────────────────────────┘  │
                                                                   │
          ┌────────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────┐
│              CONNECTED CLIENTS (WebSocket subscribers)        │
│   Mobile PWA ◄──── item_updated / item_created events        │
│   Web Dashboard ◄── item_updated / item_created events       │
└──────────────────────────────────────────────────────────────┘
```

### Request Flow

1. Client sends HTTPS request to Next.js API route (server-side proxy).
2. API route validates JWT via Supabase Auth, checks RBAC role, applies rate limiting.
3. Validated request is forwarded to Buildpad DaaS backend.
4. DaaS executes business logic (state machine, lot ID generation, validation).
5. DaaS writes to Supabase PostgreSQL (items + audit_logs atomically where possible).
6. DaaS publishes WebSocket event to all authenticated subscribers.
7. API route returns structured response to client.

### Deployment

- **Frontend + API Gateway**: AWS Amplify (Next.js SSR)
- **Backend**: Buildpad DaaS at `https://73fe4e4b-9338-49dc-888b-965ba0f96a7f.daas3.buildpad.ai`
- **Database**: Supabase PostgreSQL at `https://73fe4e4b-9338-49dc-888b-965ba0f96a7f.db3.buildpad.ai`
- **WebSocket**: `wss://73fe4e4b-9338-49dc-888b-965ba0f96a7f.daas3.buildpad.ai/ws?token=JWT`

---

## Components and Interfaces

### 1. API Gateway (Next.js API Routes)

**Responsibility**: Server-side proxy. Validates JWT, enforces RBAC, applies rate limiting, forwards to DaaS.

**Key routes** (all under `src/app/api/`):

| Route                    | Method | Handler file                 |
| ------------------------ | ------ | ---------------------------- |
| `/api/auth/login`        | POST   | `auth/login/route.ts`        |
| `/api/auth/verify`       | POST   | `auth/verify/route.ts`       |
| `/api/items`             | POST   | `items/route.ts`             |
| `/api/items/bulk-scan`   | POST   | `items/bulk-scan/route.ts`   |
| `/api/items/[id]`        | GET    | `items/[id]/route.ts`        |
| `/api/items`             | GET    | `items/route.ts`             |
| `/api/search`            | GET    | `search/route.ts`            |
| `/api/audit-logs`        | GET    | `audit-logs/route.ts`        |
| `/api/audit-logs/export` | GET    | `audit-logs/export/route.ts` |
| `/api/health`            | GET    | `health/route.ts`            |
| `/api/readiness`         | GET    | `readiness/route.ts`         |
| `/api/qr/[lot_id]`       | GET    | `qr/[lot_id]/route.ts`       |

**Middleware** (`src/middleware.ts`):

- Extracts `Authorization: Bearer <token>` header
- Verifies JWT signature and expiry via Supabase Auth
- Injects `x-user-id`, `x-user-role`, `x-user-email` headers for downstream handlers
- Returns `UNAUTHORIZED` (401) for missing/invalid/expired tokens
- Returns `FORBIDDEN` (403) for valid tokens with insufficient role

**Rate Limiting** (in-memory or Redis-backed):

- 5 failed login attempts per IP within 10 minutes → `RATE_LIMITED` (429), 10-minute block

### 2. Auth Service (Supabase Auth)

**Responsibility**: JWT issuance, session management, RBAC role assignment.

**Interface**:

```typescript
// Login
POST / api / auth / login;
Body: {
  email: string;
  password: string;
}
Response: {
  token: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
  }
}

// JWT payload
interface JWTPayload {
  sub: string; // user UUID
  email: string;
  role: UserRole;
  iat: number;
  exp: number; // iat + 8 hours
}
```

**Role assignment**: Stored in Supabase `user_metadata.role`. Validated on every request.

### 3. Item Service (DaaS + custom logic)

**Responsibility**: Item lifecycle management — registration, state machine enforcement, lot ID generation, QR code generation, bulk scan processing.

**State Machine** (enforced server-side):

```
received ──────────────────► qc_pending
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
                 qc_pass                     qc_fail
                    │                           │
          ┌─────────┴──────────┐                ▼
          ▼                    ▼            archived
      in_production       cold_storage
          │                    │
          ▼                    ▼
       finished            dispatched
          │                    │
    ┌─────┴──────┐             ▼
    ▼            ▼          archived
cold_storage  dispatched
                 │
                 ▼
             archived
```

Valid transitions map:

```typescript
const VALID_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  received: ["qc_pending"],
  qc_pending: ["qc_pass", "qc_fail"],
  qc_pass: ["in_production", "cold_storage"],
  qc_fail: ["archived"],
  in_production: ["finished"],
  finished: ["cold_storage", "dispatched"],
  cold_storage: ["dispatched"],
  dispatched: ["archived"],
  archived: [],
};
```

**Lot ID Generation Algorithm**:

1. Extract `year` from `intake_date` (YYYY).
2. Acquire a database-level advisory lock or use a `SELECT ... FOR UPDATE` on a `lot_id_sequences` table row keyed by year.
3. Read `last_sequence` for the year; increment by 1.
4. If `last_sequence` would exceed 99999, return `INTERNAL_ERROR`.
5. Zero-pad to 5 digits: `LOT-{year}-{sequence.toString().padStart(5, '0')}`.
6. Write the new sequence value atomically.
7. On year rollover (new year detected), insert a new row with `sequence = 1`.

This guarantees collision-safety under concurrent requests via database-level locking.

**QR Code Generation**:

- Uses the `qrcode` npm library (server-side) to generate a PNG buffer encoding the bare `Lot_ID` string.
- QR code is served via a dedicated Next.js API route: `GET /api/qr/[lot_id]`.
- The route generates the QR on-the-fly (no storage needed) and returns `Content-Type: image/png`.
- The permanent URL returned in registration responses is: `https://{host}/api/qr/{lot_id}`.

### 4. Audit Service (DaaS append-only collection)

**Responsibility**: Write immutable audit entries for every system event; serve paginated audit queries; export CSV.

**Append-only enforcement**: Supabase RLS policy on `audit_logs` table grants `INSERT` only — no `UPDATE` or `DELETE` for any role including `service_role`.

**Events logged**:

- `item_created`, `item_status_changed`, `item_location_changed`, `item_bulk_updated`
- `user_login`, `user_logout`
- `audit_exported`
- `forbidden_attempt`

### 5. Mobile Client (Next.js PWA)

**Responsibility**: Offline-capable scanning interface for warehouse operators.

**Key features**:

- Camera-based QR scanning via `@zxing/browser` or `html5-qrcode`
- Scan Mode: camera stays open, each scan triggers an immediate API call
- ScanQueue: `localStorage`-backed offline buffer (max 500 scans)
- Auto-sync on network restoration via `navigator.onLine` + `online` event listener
- Duplicate scan detection within a session (in-memory Set of scanned lot_ids)
- PWA manifest + service worker for installability

**ScanQueue data structure** (localStorage key: `drums_scan_queue`):

```typescript
interface QueuedScan {
  id: string; // client-generated UUID
  lot_id: string;
  target_status: ItemStatus;
  timestamp: string; // ISO 8601 client time
  retries: number; // 0–3
  status: "pending" | "failed";
  error?: string;
}
```

### 6. Web Dashboard (Next.js pages)

**Responsibility**: Real-time floor plan visualization, global search, audit log viewer, admin controls.

**Key pages**:

- `/dashboard` — floor plan with zone cards, real-time counts
- `/search` — global item search with full history
- `/audit` — paginated audit log with date/user filters and CSV export
- `/admin` — user management (admin only)

**WebSocket client**: Connects on page load, auto-reconnects up to 5 times at 1-second intervals on drop.

### 7. WebSocket Server

**Connection**: `wss://{daas-host}/ws?token={JWT}`

**Server → Client events**:

```typescript
// Item updated (status or location change)
{ "event": "item_updated", "data": { "lot_id": string, "current_status": ItemStatus, "location_zone": string, "updated_at": string }, "meta": { "timestamp": string } }

// New item registered
{ "event": "item_created", "data": { "lot_id": string, "material_type": string, "current_status": "received", "created_at": string }, "meta": { "timestamp": string } }

// Error events
{ "event": "error", "data": { "code": "TOKEN_EXPIRED" | "CONNECTION_CLOSED" | "UNAUTHORIZED", "message": string }, "meta": { "timestamp": string } }
```

**Client → Server**:

```typescript
{ "event": "ping", "data": {} }
```

**Auth**: JWT validated on handshake. Expired tokens during active connection trigger `TOKEN_EXPIRED` error event + connection close.

---

## Data Models

### TypeScript Interfaces

```typescript
// ─── Enums ───────────────────────────────────────────────────────────────────

type UserRole = "operator" | "qc" | "ppic" | "admin";

type ItemStatus =
  | "received"
  | "qc_pending"
  | "qc_pass"
  | "qc_fail"
  | "in_production"
  | "finished"
  | "cold_storage"
  | "dispatched"
  | "archived";

type LocationType = "standard" | "cold" | "hazard" | "qc" | "production";

type AuditAction =
  | "item_created"
  | "item_status_changed"
  | "item_location_changed"
  | "item_bulk_updated"
  | "user_login"
  | "user_logout"
  | "audit_exported"
  | "forbidden_attempt";

// ─── Core Entities ────────────────────────────────────────────────────────────

interface User {
  id: string; // UUID
  email: string;
  role: UserRole;
  created_at: string; // ISO 8601
}

interface JWTPayload {
  sub: string; // user.id
  email: string;
  role: UserRole;
  iat: number;
  exp: number; // iat + 28800 (8 hours)
}

interface Item {
  id: string; // UUID (internal)
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

interface ItemHistoryEntry {
  action: AuditAction;
  previous_state: string | null;
  new_state: string;
  user_id: string;
  user_email: string;
  timestamp: string; // ISO 8601
}

interface Location {
  zone_id: string; // e.g., "COLD-A", "QC-01", "RECEIVING"
  name: string; // Human-readable label
  type: LocationType;
  temperature_target?: number; // °C, required when type === "cold", range: -30 to 10
  capacity: number; // 0 = unlimited
  current_count: number; // Computed: COUNT(items WHERE location_zone = zone_id)
}

interface AuditEntry {
  id: string; // UUID
  item_id: string | null; // null for non-item events
  action: AuditAction;
  previous_state: string | null; // JSON string or null
  new_state: string | null; // JSON string or null
  user_id: string;
  user_email: string;
  ip_address: string;
  timestamp: string; // ISO 8601, server-generated
  metadata?: Record<string, unknown>; // Extra context (e.g., export params)
}

// ─── API Request/Response Shapes ─────────────────────────────────────────────

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: Pick<User, "id" | "email" | "role">;
}

interface RegisterItemRequest {
  material_type: string;
  supplier: string;
  intake_date: string; // ISO 8601 date
}

interface RegisterItemResponse {
  lot_id: string;
  qr_code: string; // URL: https://{host}/api/qr/{lot_id}
  created_at: string;
  current_status: "received";
  location_zone: "RECEIVING";
}

interface ScanItem {
  lot_id: string;
  target_status: ItemStatus;
  timestamp: string; // ISO 8601 (client time, server may override)
}

interface ScanBatchRequest {
  items: ScanItem[]; // 1–50 items
}

interface ScanResult {
  lot_id: string;
  success: boolean;
  error?: string;
  item?: Pick<Item, "lot_id" | "current_status" | "location_zone">;
}

interface ScanBatchResponse {
  processed_at: string;
  results: ScanResult[];
}

interface AuditLogQuery {
  date_from?: string; // ISO 8601
  date_to?: string; // ISO 8601
  user_id?: string;
  page?: number; // default: 1
  limit?: number; // default: 50, max: 50
}

interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// ─── Standard API Envelope ────────────────────────────────────────────────────

interface ApiSuccess<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
  meta: { timestamp: string; request_id: string };
}

interface ApiError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string>;
  };
  meta: { timestamp: string; request_id: string };
}

type ErrorCode =
  | "INVALID_INPUT" // 400
  | "VALIDATION_ERROR" // 422
  | "UNAUTHORIZED" // 401
  | "AUTH_FAILED" // 401
  | "FORBIDDEN" // 403
  | "NOT_FOUND" // 404
  | "INVALID_TRANSITION" // 422
  | "BATCH_TOO_LARGE" // 413
  | "RATE_LIMITED" // 429
  | "INTERNAL_ERROR"; // 500

// ─── Offline ScanQueue (localStorage) ────────────────────────────────────────

interface QueuedScan {
  id: string; // Client-generated UUID v4
  lot_id: string;
  target_status: ItemStatus;
  timestamp: string; // ISO 8601 client capture time
  retries: number; // 0–3
  status: "pending" | "failed";
  error?: string;
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────

interface WsItemUpdatedEvent {
  event: "item_updated";
  data: {
    lot_id: string;
    current_status: ItemStatus;
    location_zone: string;
    updated_at: string;
  };
  meta: { timestamp: string };
}

interface WsItemCreatedEvent {
  event: "item_created";
  data: {
    lot_id: string;
    material_type: string;
    current_status: "received";
    created_at: string;
  };
  meta: { timestamp: string };
}

interface WsErrorEvent {
  event: "error";
  data: {
    code: "TOKEN_EXPIRED" | "CONNECTION_CLOSED" | "UNAUTHORIZED";
    message: string;
  };
  meta: { timestamp: string };
}

type WsServerEvent = WsItemUpdatedEvent | WsItemCreatedEvent | WsErrorEvent;
```

### Database Schema (SQL DDL)

```sql
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Locations ────────────────────────────────────────────────────────────────
CREATE TABLE locations (
  zone_id            TEXT PRIMARY KEY,                          -- e.g., 'COLD-A', 'QC-01'
  name               TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('standard','cold','hazard','qc','production')),
  temperature_target NUMERIC,                                   -- °C, required when type='cold'
  capacity           INTEGER NOT NULL DEFAULT 0,               -- 0 = unlimited
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cold_zone_requires_temp CHECK (
    type != 'cold' OR (temperature_target IS NOT NULL AND temperature_target BETWEEN -30 AND 10)
  )
);

-- Seed required RECEIVING zone
INSERT INTO locations (zone_id, name, type, capacity)
VALUES ('RECEIVING', 'Receiving Dock', 'standard', 0);

-- ─── Lot ID Sequences (collision-safe counter per year) ───────────────────────
CREATE TABLE lot_id_sequences (
  year          INTEGER PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Items ────────────────────────────────────────────────────────────────────
CREATE TABLE items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         TEXT NOT NULL UNIQUE,                          -- LOT-YYYY-NNNNN
  material_type  TEXT NOT NULL CHECK (char_length(material_type) BETWEEN 1 AND 100),
  supplier       TEXT NOT NULL CHECK (char_length(supplier) BETWEEN 1 AND 100),
  intake_date    DATE NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'received'
                   CHECK (current_status IN (
                     'received','qc_pending','qc_pass','qc_fail',
                     'in_production','finished','cold_storage','dispatched','archived'
                   )),
  location_zone  TEXT NOT NULL REFERENCES locations(zone_id),
  created_by     UUID NOT NULL,                                 -- Supabase auth.users.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_lot_id        ON items(lot_id);
CREATE INDEX idx_items_location_zone ON items(location_zone);
CREATE INDEX idx_items_current_status ON items(current_status);
CREATE INDEX idx_items_intake_date   ON items(intake_date);

-- ─── Audit Logs (append-only, WORM) ──────────────────────────────────────────
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID REFERENCES items(id),                    -- NULL for non-item events
  action         TEXT NOT NULL CHECK (action IN (
                   'item_created','item_status_changed','item_location_changed',
                   'item_bulk_updated','user_login','user_logout',
                   'audit_exported','forbidden_attempt'
                 )),
  previous_state TEXT,                                          -- JSON string or NULL
  new_state      TEXT,                                          -- JSON string or NULL
  user_id        UUID NOT NULL,
  user_email     TEXT NOT NULL,
  ip_address     TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB
);

CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_item_id   ON audit_logs(item_id);
CREATE INDEX idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action    ON audit_logs(action);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs  ENABLE ROW LEVEL SECURITY;

-- Items: authenticated users can read; operators/qc/admin can write
CREATE POLICY items_select ON items FOR SELECT TO authenticated USING (true);
CREATE POLICY items_insert ON items FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' IN ('operator', 'admin'));
CREATE POLICY items_update ON items FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' IN ('operator', 'qc', 'admin'));

-- Locations: all authenticated users can read; admin can write
CREATE POLICY locations_select ON locations FOR SELECT TO authenticated USING (true);
CREATE POLICY locations_insert ON locations FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY locations_update ON locations FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Audit logs: WORM — INSERT only, no UPDATE/DELETE for any role
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);
-- No UPDATE or DELETE policies defined → effectively blocked

-- ─── Computed current_count view ─────────────────────────────────────────────
CREATE OR REPLACE VIEW location_counts AS
  SELECT
    l.zone_id,
    l.name,
    l.type,
    l.temperature_target,
    l.capacity,
    COUNT(i.id) AS current_count
  FROM locations l
  LEFT JOIN items i ON i.location_zone = l.zone_id
  GROUP BY l.zone_id, l.name, l.type, l.temperature_target, l.capacity;
```

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: JWT Token Contains Valid Claims

_For any_ successful login with valid credentials, the issued JWT token SHALL contain a `sub` (user UUID), `email`, and `role` claim where `role` is exactly one value from `["operator", "qc", "ppic", "admin"]`, and the `exp` claim equals `iat + 28800` (8 hours).

**Validates: Requirements 1.1, 1.6**

---

### Property 2: Invalid or Expired Tokens Are Rejected

_For any_ API request carrying a JWT token that is missing, malformed, has an invalid signature, or has an `exp` timestamp earlier than the current server time, the API_Gateway SHALL return an `UNAUTHORIZED` error response without forwarding the request to any downstream service.

**Validates: Requirements 1.4, 1.5**

---

### Property 3: RBAC Permissions Are Enforced Per Role

_For any_ authenticated user and any API action, the system SHALL permit the action if and only if the user's role grants that permission — specifically: `operator` may register items and update status/location but not perform `qc_pass`/`qc_fail` or access audit export; `qc` may perform `qc_pass`/`qc_fail` but not access user management or audit export; `ppic` may read all items but not write; `admin` may perform all actions. Any action exceeding the user's role SHALL return `FORBIDDEN` and write a `forbidden_attempt` AuditEntry.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

---

### Property 4: Item Registration Produces Correct Initial State

_For any_ valid registration request with non-empty `material_type` (1–100 chars), `supplier` (1–100 chars), and `intake_date` (valid ISO 8601 date not in the future), the Item_Service SHALL create an item with `current_status = "received"` and `location_zone = "RECEIVING"`, and the response SHALL contain `lot_id`, `qr_code` URL, `created_at`, and `current_status`.

**Validates: Requirements 3.1, 3.7**

---

### Property 5: Lot ID Format and Uniqueness Invariant

_For any_ set of N registration requests processed (concurrently or sequentially), all generated `Lot_ID` values SHALL match the regular expression `^LOT-\d{4}-\d{5}$` where the four-digit year equals the `intake_date` year, the five-digit counter is in range 00001–99999, and all N values are distinct with no collisions.

**Validates: Requirements 3.2, 3.3, 4.1, 4.3**

---

### Property 6: Registration Input Validation Rejects Invalid Inputs

_For any_ registration request with a missing or empty `material_type`, `supplier`, or `intake_date`, or with `intake_date` set to a future date, or with `material_type`/`supplier` exceeding 100 characters, the Item_Service SHALL return a `VALIDATION_ERROR` identifying the failing field(s) and SHALL NOT create an item record or emit any events.

**Validates: Requirements 3.4, 3.5, 13.1, 13.2**

---

### Property 7: State Machine Enforces Valid Transitions

_For any_ item in any `ItemStatus` state and any requested `target_status`, the Item_Service SHALL permit the transition if and only if `target_status` is in the valid transitions map for `current_status` (and `target_status ≠ current_status`). Valid transitions SHALL atomically update `current_status` and `updated_at` in the database and write an `item_status_changed` AuditEntry. Invalid transitions SHALL return `INVALID_TRANSITION` with `current_status`, `target_status`, and the list of allowed transitions.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

---

### Property 8: Bulk Scan Batch Size Invariant

_For any_ ScanBatch request containing between 1 and 50 items, the Item*Service SHALL accept and process the request. \_For any* ScanBatch request containing more than 50 items, the Item_Service SHALL return `BATCH_TOO_LARGE` and SHALL NOT process any items in the batch.

**Validates: Requirements 6.4, 6.5, 13.5**

---

### Property 9: Bulk Scan Partial Success and Audit Completeness

_For any_ ScanBatch request containing a mix of valid and invalid items, the Item_Service SHALL process all valid items, return per-item results with `{ lot_id, success, error? }` for every item, respond with HTTP 207, and write exactly one AuditEntry per successfully processed item.

**Validates: Requirements 6.6, 6.8**

---

### Property 10: ScanQueue Capacity and Persistence

_For any_ sequence of offline scans up to 500, the Mobile_Client SHALL store each scan in the ScanQueue (localStorage). When the 501st scan is attempted, the Mobile_Client SHALL reject it and display a warning without overwriting existing queued scans. Pending (non-failed) scans SHALL survive app close/reopen and be restored from localStorage on next launch.

**Validates: Requirements 7.1, 7.6, 7.7**

---

### Property 11: ScanQueue Sync Order and Retry Behavior

_For any_ ScanQueue containing N pending scans, when network connectivity is restored, the Mobile_Client SHALL submit scans in FIFO order, retry each failed submission up to 3 times at 5-second intervals, remove successfully submitted scans from the queue, and mark permanently failed scans without discarding other queued scans.

**Validates: Requirements 7.2, 7.3, 7.4**

---

### Property 12: Zone Capacity Invariant

_For any_ Location with `capacity > 0`, the `current_count` (computed as the count of items with `location_zone = zone_id`) SHALL never exceed `capacity`. Any item update that would cause `current_count` to exceed `capacity` SHALL return a `VALIDATION_ERROR` and SHALL NOT update the item's `location_zone`.

**Validates: Requirements 14.2, 14.3, 14.5**

---

### Property 13: Cold Zone Temperature Validation

_For any_ Location with `type = "cold"`, a `temperature_target` value in the range −30 to 10 (°C) SHALL be required. Any attempt to create or update a cold zone without a valid `temperature_target` SHALL return a `VALIDATION_ERROR`.

**Validates: Requirements 14.4**

---

### Property 14: QR Code Round-Trip

_For any_ registered item with `Lot_ID` value L, the QR code image returned at the URL `GET /api/qr/{L}` SHALL be decodable by a standard QR code reader to produce the string L exactly, with no modification, prefix, or suffix.

**Validates: Requirements 15.1, 15.3**

---

### Property 15: Item Registration–Search Round-Trip

_For any_ valid registration input `(material_type, supplier, intake_date)`, registering an item and then searching by the returned `Lot_ID` SHALL return a record where `lot_id`, `material_type`, `supplier`, `intake_date`, `current_status`, and `location_zone` exactly match the registration input and defaults, and the `history` array contains at least one `item_created` entry.

**Validates: Requirements 9.1, 9.6**

---

### Property 16: Search Input Validation

_For any_ search query that is an empty string, a whitespace-only string, or a string that neither matches `^LOT-\d{4}-\d{5}$` nor is a non-empty alphanumeric UUID, the Item_Service SHALL return a `VALIDATION_ERROR` without executing a database query.

**Validates: Requirements 9.3**

---

### Property 17: Audit Entry Completeness and Immutability Round-Trip

_For any_ system event (item creation, status change, location change, bulk update, user login, user logout, audit export, forbidden attempt), the Audit_Service SHALL write an AuditEntry with all required fields correctly populated (`item_id` and `previous_state` set to `null` for non-item events). When that AuditEntry is read back by its `id`, all field values SHALL be identical to those written.

**Validates: Requirements 10.1, 10.3, 10.8**

---

### Property 18: Audit Log Query Returns Entries Within Date Range

_For any_ audit log query with `date_from` and `date_to` filters, all returned AuditEntry records SHALL have `timestamp` within the specified range (inclusive), be ordered by `timestamp` descending, and be paginated at up to 50 entries per page.

**Validates: Requirements 10.4**

---

### Property 19: WebSocket Events Published on Item Changes

_For any_ item status or location change, the Item*Service SHALL publish an `item_updated` WebSocket event containing `lot_id`, `current_status`, `location_zone`, and `updated_at`. \_For any* new item registration, the Item_Service SHALL publish an `item_created` WebSocket event containing `lot_id`, `material_type`, `current_status`, and `created_at`.

**Validates: Requirements 11.1, 11.2**

---

### Property 20: WebSocket Connection Rejects Invalid Tokens

_For any_ WebSocket connection attempt with a missing, malformed, or expired JWT token, the WebSocket_Server SHALL reject the connection with code `UNAUTHORIZED`.

**Validates: Requirements 11.6**

---

### Property 21: API Response Envelope Invariant

_For any_ API request, the response SHALL conform to the standard envelope: success responses have `{ success: true, data: {...}, meta: { timestamp, request_id } }` and error responses have `{ success: false, error: { code, message, details }, meta: { timestamp, request_id } }`. The `request_id` SHALL be a unique UUID v4 distinct from all other request IDs. Error codes SHALL always map to their defined HTTP status codes. Paginated endpoints SHALL always include a `pagination` object with `page`, `limit`, `total`, and `pages`.

**Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5**

---

## Error Handling

### Error Response Standard

All errors follow the envelope defined in Requirement 16:

```typescript
{
  success: false,
  error: {
    code: ErrorCode,          // Machine-readable, never changes
    message: string,          // Human-readable, may change
    details?: Record<string, string>  // Field-level info for VALIDATION_ERROR
  },
  meta: {
    timestamp: string,        // ISO 8601 server time
    request_id: string        // UUID v4 for log correlation
  }
}
```

### Error Code → HTTP Status Mapping

| Error Code           | HTTP Status | When                                     |
| -------------------- | ----------- | ---------------------------------------- |
| `INVALID_INPUT`      | 400         | Missing or malformed request body/params |
| `VALIDATION_ERROR`   | 422         | Field-level validation failure           |
| `UNAUTHORIZED`       | 401         | Missing, invalid, or expired JWT         |
| `AUTH_FAILED`        | 401         | Wrong credentials at login               |
| `FORBIDDEN`          | 403         | Valid token but insufficient role        |
| `NOT_FOUND`          | 404         | Resource does not exist                  |
| `INVALID_TRANSITION` | 422         | State machine violation                  |
| `BATCH_TOO_LARGE`    | 413         | ScanBatch > 50 items                     |
| `RATE_LIMITED`       | 429         | >5 failed logins in 10 min from same IP  |
| `INTERNAL_ERROR`     | 500         | Unexpected server error                  |

### Error Handling by Layer

**API Gateway (Next.js middleware)**:

- JWT missing → `UNAUTHORIZED` (401), no downstream call
- JWT expired → `UNAUTHORIZED` (401), no downstream call
- Role insufficient → `FORBIDDEN` (403), write `forbidden_attempt` audit entry
- Rate limit exceeded → `RATE_LIMITED` (429)

**Item Service**:

- Missing required fields → `VALIDATION_ERROR` (422) with `details` identifying each failing field
- Future `intake_date` → `VALIDATION_ERROR` (422)
- Non-existent `location_zone` → `VALIDATION_ERROR` (422) with `code: "INVALID_ZONE"`
- Invalid `target_status` enum → `VALIDATION_ERROR` (422)
- Invalid state transition → `INVALID_TRANSITION` (422) with `current_status`, `target_status`, `allowed`
- Zone at capacity → `VALIDATION_ERROR` (422)
- Lot ID sequence exhausted → `INTERNAL_ERROR` (500)
- DB write failure → `INTERNAL_ERROR` (500), no retry

**Audit Service**:

- DB write failure → `INTERNAL_ERROR` returned to calling service; failure is NOT silently discarded
- Item record is NOT rolled back if audit write fails after item persistence

**WebSocket Server**:

- Invalid token on connect → reject with `UNAUTHORIZED`
- Token expires during connection → send `TOKEN_EXPIRED` error event, close connection
- Network drop / server restart → send `CONNECTION_CLOSED` error event before closing

**Mobile Client (Offline)**:

- Network unavailable → queue scan in ScanQueue (up to 500)
- Queue full → reject new scan, display warning
- Sync failure after 3 retries → mark scan as `failed`, continue with remaining queue
- Duplicate scan in session → display warning, do NOT submit

---

## Testing Strategy

### Dual Testing Approach

The testing strategy combines **property-based tests** (for universal correctness properties) with **unit tests** (for specific examples and edge cases) and **integration/E2E tests** (for infrastructure and UI flows).

### Property-Based Testing

**Library**: [`fast-check`](https://github.com/dubzzz/fast-check) (TypeScript-native, works with Vitest)

**Configuration**: Minimum 100 iterations per property test.

**Tag format**: Each property test is tagged with a comment:

```typescript
// Feature: drums-tracking, Property N: <property_text>
```

**Scope**: Properties 1–21 defined above. Each property maps to a single `fc.assert(fc.property(...))` test.

**Key generators needed**:

- `fc.record({ material_type: fc.string({minLength:1, maxLength:100}), supplier: fc.string({minLength:1, maxLength:100}), intake_date: fc.date({max: new Date()}).map(d => d.toISOString().split('T')[0]) })` — valid registration input
- `fc.constantFrom("operator","qc","ppic","admin")` — valid roles
- `fc.constantFrom(...Object.keys(VALID_TRANSITIONS))` — valid ItemStatus values
- `fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses))` — transition pairs
- `fc.array(fc.record({lot_id, target_status, timestamp}), {minLength:1, maxLength:50})` — valid scan batches
- `fc.string()` — arbitrary search queries for validation testing

**Property test file locations**:

```
src/__tests__/properties/
  auth.property.test.ts          (Properties 1, 2)
  rbac.property.test.ts          (Property 3)
  item-registration.property.test.ts  (Properties 4, 5, 6)
  state-machine.property.test.ts (Property 7)
  bulk-scan.property.test.ts     (Properties 8, 9)
  scan-queue.property.test.ts    (Properties 10, 11)
  location.property.test.ts      (Properties 12, 13)
  qr-code.property.test.ts       (Property 14)
  search.property.test.ts        (Properties 15, 16)
  audit.property.test.ts         (Properties 17, 18)
  websocket.property.test.ts     (Properties 19, 20)
  api-envelope.property.test.ts  (Property 21)
```

### Unit Tests (Vitest)

Focus on specific examples, edge cases, and pure functions:

- State machine transition table: verify each valid/invalid pair explicitly
- Lot ID generation: year rollover, counter reset, padding, overflow at 99999
- Input validation: boundary values (0 chars, 1 char, 100 chars, 101 chars)
- JWT payload parsing: missing claims, wrong role values
- ScanQueue: FIFO ordering, retry counting, failed scan isolation
- QR code generation: known lot_id → known QR output (snapshot)
- Error response shape: each error code maps to correct HTTP status

**Unit test file locations**:

```
src/__tests__/unit/
  state-machine.test.ts
  lot-id-generator.test.ts
  input-validation.test.ts
  jwt-utils.test.ts
  scan-queue.test.ts
  qr-generator.test.ts
  error-codes.test.ts
```

### Integration Tests (Vitest + test database)

Test infrastructure wiring against a real (test) Supabase instance:

- `audit_logs` table rejects UPDATE and DELETE (WORM enforcement)
- `lot_id` unique constraint rejects duplicates
- RLS policies: operator cannot read audit_logs; non-admin cannot delete items
- `GET /api/health` returns 200 when DB is up; 503 when DB is down
- `GET /api/readiness` returns `{ ready: true }` when DB connected
- WebSocket broadcast reaches all connected authenticated clients within 2 seconds
- Search performance: p95 < 500ms against 100,000-item dataset

### E2E Tests (Playwright)

Test complete user flows in a browser:

- **Flow A (Bulk Scan)**: Login → activate Scan Mode → scan 3 drums → verify green check + audio → tap Finish → verify summary
- **Flow B (Registration)**: Login → Register New → fill form → verify lot_id + QR code displayed
- **Flow C (Audit Export)**: Admin login → Audit Trail → filter by date → export CSV → verify download
- **Floor Plan**: Load dashboard → verify zone cards with counts → move item → verify count updates within 2s
- **Offline Sync**: Go offline → scan 5 drums → go online → verify all 5 synced and removed from queue
- **WebSocket Reconnect**: Disconnect network → verify "reconnecting" indicator → reconnect → verify indicator disappears

### Performance Tests

- Bulk scan endpoint: 50 items, 50 concurrent users → p95 < 500ms
- Search endpoint: 100,000 items dataset → p95 < 500ms
- WebSocket broadcast: 100 connected clients → all receive event within 2s

### Test Environment

- **Unit + Property**: Vitest with `fast-check`, mocked DaaS/Supabase clients
- **Integration**: Vitest against a dedicated Supabase test project (separate from production)
- **E2E**: Playwright against a staging deployment on AWS Amplify
- **CI**: GitHub Actions — unit + property tests on every PR; integration + E2E on merge to main
