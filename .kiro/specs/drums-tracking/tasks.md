# Implementation Plan: Drums Tracking

## Overview

Incremental implementation of the Drums Tracking enterprise inventory system. The plan follows a bottom-up approach: shared types and utilities first, then the API Gateway layer (Next.js API routes with JWT middleware, RBAC, and rate limiting), then core business logic (item registration, state machine, bulk scan, QR codes), then the offline-capable mobile PWA (ScanQueue, camera scanning), then the real-time web dashboard (floor plan, WebSocket client, search, audit log), and finally integration wiring and E2E validation.

All code is TypeScript. Testing uses Vitest + fast-check for property-based tests.

---

## Tasks

- [x] 1. Project foundation — shared types, constants, and utilities
  - [x] 1.1 Create TypeScript type definitions and enums
    - Create `src/types/index.ts` with all interfaces and types from the design: `UserRole`, `ItemStatus`, `LocationType`, `AuditAction`, `User`, `JWTPayload`, `Item`, `ItemHistoryEntry`, `Location`, `AuditEntry`, `QueuedScan`, `WsServerEvent` subtypes, `ApiSuccess`, `ApiError`, `ErrorCode`, and all request/response shapes
    - _Requirements: 1.6, 2.1–2.4, 3.1, 4.1, 5.1, 6.4, 7.1, 9.1, 10.3, 14.1, 16.1–16.5_

  - [x] 1.2 Implement the state machine transition table and validator
    - Create `src/lib/state-machine.ts` with `VALID_TRANSITIONS` map and `validateTransition(current, target)` function that returns `{ valid: boolean, allowed: ItemStatus[] }`
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [x] 1.3 Write unit tests for the state machine
    - Test every valid transition pair (should return `valid: true`)
    - Test every invalid transition pair including self-transitions and transitions from `archived`
    - Test that `allowed` array matches the map exactly for each state
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [x] 1.4 Implement Lot ID generator
    - Create `src/lib/lot-id-generator.ts` with `generateLotId(intakeDate: string, supabaseClient): Promise<string>` using `SELECT ... FOR UPDATE` on `lot_id_sequences`, zero-padding to 5 digits, year rollover logic, and overflow guard at 99999
    - _Requirements: 3.2, 3.3, 4.1, 4.4, 4.5_

  - [x] 1.5 Write unit tests for Lot ID generator
    - Test format `^LOT-\d{4}-\d{5}$` for various dates
    - Test year rollover resets counter to 00001
    - Test zero-padding (sequence 1 → `00001`, 99999 → `99999`)
    - Test overflow at 99999 throws/returns error
    - _Requirements: 3.2, 4.1, 4.4, 4.5_

  - [x] 1.6 Implement input validation utilities
    - Create `src/lib/validation.ts` with validators: `validateRegistrationInput`, `validateScanBatch`, `validateAuditLogQuery`, `validateSearchQuery`, `validateLocationInput`
    - Each validator returns `{ valid: boolean, details?: Record<string, string> }`
    - _Requirements: 3.4, 3.5, 6.4, 6.5, 9.3, 10.4, 13.1–13.7, 14.4_

  - [x] 1.7 Write unit tests for input validation utilities
    - Test boundary values: 0 chars, 1 char, 100 chars, 101 chars for `material_type` and `supplier`
    - Test future `intake_date` rejection and past/today acceptance
    - Test ScanBatch size: 1, 50 (accept), 51 (reject)
    - Test search query: empty string, whitespace, valid Lot ID, valid UUID, invalid string
    - _Requirements: 3.4, 3.5, 6.4, 6.5, 9.3, 13.1, 13.2, 13.5_

  - [x] 1.8 Implement API response envelope helpers
    - Create `src/lib/api-response.ts` with `successResponse<T>(data, pagination?)` and `errorResponse(code, message, details?)` that produce the standard envelope with `meta.timestamp` (ISO 8601) and `meta.request_id` (UUID v4)
    - _Requirements: 16.1–16.5_

  - [x] 1.9 Write unit tests for API response envelope helpers
    - Test `successResponse` shape: `success: true`, `data`, `meta.timestamp`, `meta.request_id` (UUID v4 format)
    - Test `errorResponse` shape: `success: false`, `error.code`, `error.message`, `meta`
    - Test each `ErrorCode` maps to its defined HTTP status
    - Test paginated response includes `pagination` object
    - _Requirements: 16.1–16.5_

  - [x] 1.10 Implement JWT utilities
    - Create `src/lib/jwt.ts` with `verifyJwt(token: string): Promise<JWTPayload | null>` using Supabase Auth client, and `extractBearerToken(authHeader: string | null): string | null`
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.11 Write unit tests for JWT utilities
    - Test `extractBearerToken` with valid header, missing header, malformed header
    - Test `verifyJwt` with valid token (mock), expired token, malformed token, missing role claim, invalid role value
    - _Requirements: 1.4, 1.5, 1.6, 1.7_

- [x] 2. Checkpoint — foundation complete
  - Ensure all unit tests in Task 1 pass. Run `npx vitest --run src/__tests__/unit`. Ask the user if any questions arise before proceeding.

- [x] 3. API Gateway middleware — JWT verification, RBAC, and rate limiting
  - [x] 3.1 Implement Next.js middleware for JWT verification
    - Create `src/middleware.ts` that intercepts all `/api/*` routes (except `/api/auth/login`, `/api/health`, `/api/readiness`), extracts the Bearer token, calls `verifyJwt`, injects `x-user-id`, `x-user-role`, `x-user-email` headers on success, and returns `UNAUTHORIZED` (401) on failure
    - _Requirements: 1.4, 1.5, 16.1–16.3_

  - [x] 3.2 Implement RBAC enforcement helper
    - Create `src/lib/rbac.ts` with `checkPermission(role: UserRole, action: string): boolean` and a permissions map covering all role/action combinations from Requirements 2.1–2.4
    - _Requirements: 2.1–2.5_

  - [x] 3.3 Write unit tests for RBAC helper
    - Test each role against every action: operator (register, update status/location, read — allow; qc_pass/qc_fail, user management, audit export — deny)
    - Test qc, ppic, admin roles against their respective allowed/denied actions
    - _Requirements: 2.1–2.4_

  - [x] 3.4 Implement in-memory rate limiter for login endpoint
    - Create `src/lib/rate-limiter.ts` with `checkRateLimit(ip: string): { allowed: boolean, retryAfter?: number }` tracking failed attempts per IP, blocking after 5 failures within 10 minutes, auto-unblocking after 10 minutes
    - _Requirements: 1.3_

  - [x] 3.5 Write unit tests for rate limiter
    - Test 5 failures within 10 min → blocked on 6th attempt
    - Test auto-unblock after 10-minute window
    - Test different IPs are tracked independently
    - _Requirements: 1.3_

  - [x] 3.6 Implement `POST /api/auth/login` route
    - Create `src/app/api/auth/login/route.ts` that validates request body, applies rate limiter, calls Supabase Auth `signInWithPassword`, returns `LoginResponse` on success, `AUTH_FAILED` on invalid credentials, `RATE_LIMITED` on blocked IP
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

  - [x] 3.7 Implement `POST /api/auth/verify` route
    - Create `src/app/api/auth/verify/route.ts` that verifies the Bearer token and returns the decoded `JWTPayload` or `UNAUTHORIZED`
    - _Requirements: 1.4, 1.5_

  - [x] 3.8 Implement `GET /api/health` and `GET /api/readiness` routes
    - Create `src/app/api/health/route.ts` returning `{ status: "ok" }` (200) always when process is running
    - Create `src/app/api/readiness/route.ts` that pings Supabase DB; returns `{ ready: true }` (200) on success, `{ ready: false, error: "INTERNAL_ERROR" }` (503) on failure
    - _Requirements: 12.4, 12.5, 12.6_

  - [x] 3.9 Write unit tests for auth routes and health endpoints
    - Test login: valid credentials → token + user; invalid credentials → AUTH_FAILED; rate limited → RATE_LIMITED
    - Test verify: valid token → payload; expired token → UNAUTHORIZED
    - Test health: always 200; readiness: 200 when DB up, 503 when DB down (mock)
    - _Requirements: 1.1–1.3, 12.4, 12.5, 12.6_

- [x] 4. Property-based tests — authentication and RBAC
  - [x] 4.1 Write property test for JWT token claims (Property 1)
    - **Property 1: JWT Token Contains Valid Claims**
    - Use `fc.record({ email: fc.emailAddress(), role: fc.constantFrom("operator","qc","ppic","admin") })` to generate valid login inputs; assert issued token contains `sub`, `email`, `role` ∈ valid set, and `exp = iat + 28800`
    - **Validates: Requirements 1.1, 1.6**

  - [x] 4.2 Write property test for invalid/expired token rejection (Property 2)
    - **Property 2: Invalid or Expired Tokens Are Rejected**
    - Use `fc.oneof(fc.constant(null), fc.string(), fc.record({...}))` to generate missing/malformed/expired tokens; assert every such request returns `UNAUTHORIZED` without forwarding downstream
    - **Validates: Requirements 1.4, 1.5**

  - [x] 4.3 Write property test for RBAC enforcement (Property 3)
    - **Property 3: RBAC Permissions Are Enforced Per Role**
    - Use `fc.constantFrom("operator","qc","ppic","admin")` × action set; assert each role/action pair returns permitted or `FORBIDDEN` exactly per the permissions map; assert `FORBIDDEN` writes a `forbidden_attempt` AuditEntry
    - **Validates: Requirements 2.1–2.5**

- [x] 5. Item registration and QR code API
  - [x] 5.1 Implement Supabase client singleton
    - Create `src/lib/supabase.ts` exporting `createServerClient()` using `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars (server-side only)
    - _Requirements: 3.1, 4.2_

  - [x] 5.2 Implement item registration service
    - Create `src/services/item-service.ts` with `registerItem(input: RegisterItemRequest, userId: string, ip: string): Promise<RegisterItemResponse>` that: validates input, generates Lot ID, inserts into `items` table with `current_status = "received"` and `location_zone = "RECEIVING"`, writes `item_created` AuditEntry, returns response with `lot_id`, `qr_code` URL, `created_at`, `current_status`
    - _Requirements: 3.1–3.7, 4.1–4.5, 13.1, 13.2_

  - [x] 5.3 Implement `POST /api/items` route
    - Create `src/app/api/items/route.ts` (POST handler) that reads injected user headers, checks RBAC (operator/admin only), calls `registerItem`, returns `RegisterItemResponse` or appropriate error
    - _Requirements: 2.1, 2.4, 3.1–3.7_

  - [x] 5.4 Implement QR code generation route
    - Create `src/app/api/qr/[lot_id]/route.ts` that uses the `qrcode` npm package to generate a PNG buffer encoding the bare `lot_id` string, returns `Content-Type: image/png`, returns 404 if `lot_id` not found in DB
    - _Requirements: 15.1–15.5_

  - [x] 5.5 Write unit tests for item registration service
    - Test valid input creates item with `current_status = "received"`, `location_zone = "RECEIVING"`
    - Test missing `material_type`, `supplier`, `intake_date` → `VALIDATION_ERROR` with field details
    - Test future `intake_date` → `VALIDATION_ERROR`
    - Test `material_type`/`supplier` > 100 chars → `VALIDATION_ERROR`
    - Test response contains `lot_id`, `qr_code` URL, `created_at`, `current_status`
    - _Requirements: 3.1, 3.4, 3.5, 3.7, 13.1, 13.2_

  - [x] 5.6 Write unit tests for QR code route
    - Test known `lot_id` → PNG response with `Content-Type: image/png`
    - Test non-existent `lot_id` → 404
    - _Requirements: 15.4, 15.5_

- [x] 6. Property-based tests — item registration and Lot ID
  - [x] 6.1 Write property test for item registration initial state (Property 4)
    - **Property 4: Item Registration Produces Correct Initial State**
    - Use `fc.record({ material_type: fc.string({minLength:1, maxLength:100}), supplier: fc.string({minLength:1, maxLength:100}), intake_date: fc.date({max: new Date()}).map(d => d.toISOString().split('T')[0]) })` to generate valid inputs; assert every response has `current_status = "received"`, `location_zone = "RECEIVING"`, and contains `lot_id`, `qr_code`, `created_at`
    - **Validates: Requirements 3.1, 3.7**

  - [x] 6.2 Write property test for Lot ID format and uniqueness (Property 5)
    - **Property 5: Lot ID Format and Uniqueness Invariant**
    - Generate N registration requests; assert all `lot_id` values match `^LOT-\d{4}-\d{5}$`, year segment equals `intake_date` year, counter in 00001–99999, and all N values are distinct
    - **Validates: Requirements 3.2, 3.3, 4.1, 4.3**

  - [x] 6.3 Write property test for registration input validation (Property 6)
    - **Property 6: Registration Input Validation Rejects Invalid Inputs**
    - Use `fc.oneof` to generate inputs with missing fields, empty strings, strings > 100 chars, future dates; assert every such request returns `VALIDATION_ERROR` and no item is created
    - **Validates: Requirements 3.4, 3.5, 13.1, 13.2**

- [x] 7. Item status update and bulk scan API
  - [x] 7.1 Implement item status update service
    - Add `updateItemStatus(lotId: string, targetStatus: ItemStatus, userId: string, userEmail: string, ip: string): Promise<Item>` to `src/services/item-service.ts`; validate transition via `validateTransition`, atomically update `current_status` and `updated_at`, write `item_status_changed` AuditEntry, publish `item_updated` WebSocket event
    - _Requirements: 5.1–5.6, 10.1, 11.1_

  - [x] 7.2 Implement bulk scan service
    - Add `processScanBatch(batch: ScanBatchRequest, userId: string, userEmail: string, ip: string): Promise<ScanBatchResponse>` to `src/services/item-service.ts`; validate batch size ≤ 50, process each item independently, collect per-item results, write one AuditEntry per successful item, return HTTP 207 with `results` array
    - _Requirements: 6.4–6.6, 6.8, 13.4, 13.5_

  - [x] 7.3 Implement `GET /api/items` and `GET /api/items/[id]` routes
    - Create GET handler in `src/app/api/items/route.ts` for listing items (all authenticated roles)
    - Create `src/app/api/items/[id]/route.ts` for fetching a single item by UUID with full history
    - _Requirements: 2.1–2.4, 9.1_

  - [x] 7.4 Implement `POST /api/items/bulk-scan` route
    - Create `src/app/api/items/bulk-scan/route.ts` that checks RBAC (operator/qc/admin), validates request body, calls `processScanBatch`, returns `ScanBatchResponse` with HTTP 207 on partial success
    - _Requirements: 2.1, 2.2, 2.4, 6.4–6.6, 6.8_

  - [x] 7.5 Write unit tests for item status update service
    - Test each valid transition succeeds and updates `current_status` + `updated_at`
    - Test invalid transition returns `INVALID_TRANSITION` with `current_status`, `target_status`, `allowed`
    - Test self-transition returns `INVALID_TRANSITION`
    - Test transition from `archived` returns `INVALID_TRANSITION`
    - _Requirements: 5.1–5.6_

  - [x] 7.6 Write unit tests for bulk scan service
    - Test batch of 1 item → success
    - Test batch of 50 items → all processed
    - Test batch of 51 items → `BATCH_TOO_LARGE`, nothing processed
    - Test mixed valid/invalid batch → valid items processed, per-item results returned, HTTP 207
    - Test each successful item writes one AuditEntry
    - _Requirements: 6.4–6.6, 6.8, 13.4, 13.5_

- [x] 8. Property-based tests — state machine and bulk scan
  - [x] 8.1 Write property test for state machine transitions (Property 7)
    - **Property 7: State Machine Enforces Valid Transitions**
    - Use `fc.tuple(fc.constantFrom(...statuses), fc.constantFrom(...statuses))` to generate all transition pairs; assert valid pairs succeed and update DB atomically + write AuditEntry; assert invalid pairs return `INVALID_TRANSITION` with correct `allowed` list
    - **Validates: Requirements 5.1–5.6**

  - [x] 8.2 Write property test for bulk scan batch size invariant (Property 8)
    - **Property 8: Bulk Scan Batch Size Invariant**
    - Use `fc.array(fc.record({...}), {minLength:1, maxLength:50})` for valid batches and `fc.array(..., {minLength:51})` for oversized; assert valid batches are accepted, oversized return `BATCH_TOO_LARGE` with no items processed
    - **Validates: Requirements 6.4, 6.5, 13.5**

  - [x] 8.3 Write property test for bulk scan partial success (Property 9)
    - **Property 9: Bulk Scan Partial Success and Audit Completeness**
    - Generate mixed batches with valid and invalid items; assert all valid items processed, per-item `{ lot_id, success, error? }` returned for every item, HTTP 207, exactly one AuditEntry per successful item
    - **Validates: Requirements 6.6, 6.8**

- [x] 9. Checkpoint — API layer complete
  - Ensure all unit and property tests pass. Run `npx vitest --run`. Ask the user if any questions arise before proceeding.

- [x] 10. Search and audit log API
  - [x] 10.1 Implement global search service
    - Add `searchItem(query: string, userId: string): Promise<Item>` to `src/services/item-service.ts`; validate query (exact match on `lot_id` or `id` only, no partial matching), fetch item with full history from `audit_logs`, return `NOT_FOUND` if no match, `VALIDATION_ERROR` for invalid query
    - _Requirements: 9.1–9.7_

  - [x] 10.2 Implement `GET /api/search` route
    - Create `src/app/api/search/route.ts` that reads `?q=` query param, calls `searchItem`, returns item with history or appropriate error
    - _Requirements: 9.1–9.7_

  - [x] 10.3 Implement audit log service
    - Create `src/services/audit-service.ts` with `queryAuditLogs(query: AuditLogQuery, userId: string): Promise<{ entries: AuditEntry[], pagination: PaginationMeta }>` and `exportAuditLogsCsv(query: AuditLogQuery, userId: string, userEmail: string, ip: string): Promise<string>` (returns CSV string, max 10,000 entries, writes `audit_exported` AuditEntry)
    - _Requirements: 10.1–10.9_

  - [x] 10.4 Implement `GET /api/audit-logs` route
    - Create `src/app/api/audit-logs/route.ts` that enforces admin-only RBAC, validates date filters, calls `queryAuditLogs`, returns paginated results
    - _Requirements: 2.4, 10.4, 10.5_

  - [x] 10.5 Implement `GET /api/audit-logs/export` route
    - Create `src/app/api/audit-logs/export/route.ts` that enforces admin-only RBAC, calls `exportAuditLogsCsv`, returns CSV with `Content-Disposition: attachment; filename="audit-log.csv"` and `Content-Type: text/csv`
    - _Requirements: 2.4, 10.5, 10.6, 10.7_

  - [x] 10.6 Write unit tests for search service
    - Test valid `lot_id` query → item with history returned
    - Test valid UUID query → item with history returned
    - Test no match → `NOT_FOUND`
    - Test empty string, whitespace, invalid format → `VALIDATION_ERROR` without DB query
    - Test history ordered reverse chronologically
    - _Requirements: 9.1–9.7_

  - [x] 10.7 Write unit tests for audit log service
    - Test `queryAuditLogs` with date range → entries within range, ordered by `timestamp` DESC, paginated ≤ 50
    - Test invalid ISO 8601 date → `VALIDATION_ERROR`
    - Test `exportAuditLogsCsv` → CSV with all fields; > 10,000 entries → `VALIDATION_ERROR`
    - Test export writes `audit_exported` AuditEntry
    - _Requirements: 10.4, 10.6, 10.7_

- [x] 11. Property-based tests — search and audit
  - [x] 11.1 Write property test for item registration–search round-trip (Property 15)
    - **Property 15: Item Registration–Search Round-Trip**
    - Generate valid registration inputs; register item, then search by returned `lot_id`; assert returned record matches `material_type`, `supplier`, `intake_date`, `current_status = "received"`, `location_zone = "RECEIVING"`, and `history` contains `item_created` entry
    - **Validates: Requirements 9.1, 9.6**

  - [x] 11.2 Write property test for search input validation (Property 16)
    - **Property 16: Search Input Validation**
    - Use `fc.oneof(fc.constant(""), fc.string().filter(s => s.trim() === ""), fc.string().filter(s => !isValidLotId(s) && !isValidUuid(s)))` to generate invalid queries; assert every such query returns `VALIDATION_ERROR` without executing a DB query
    - **Validates: Requirements 9.3**

  - [x] 11.3 Write property test for audit entry completeness and immutability (Property 17)
    - **Property 17: Audit Entry Completeness and Immutability Round-Trip**
    - For each event type, write an AuditEntry and read it back by `id`; assert all field values are identical; assert `item_id` and `previous_state` are `null` for non-item events
    - **Validates: Requirements 10.1, 10.3, 10.8**

  - [x] 11.4 Write property test for audit log date range query (Property 18)
    - **Property 18: Audit Log Query Returns Entries Within Date Range**
    - Use `fc.tuple(fc.date(), fc.date())` to generate date ranges; assert all returned entries have `timestamp` within range (inclusive), ordered `timestamp` DESC, paginated ≤ 50
    - **Validates: Requirements 10.4**

- [x] 12. Location zone management API
  - [x] 12.1 Implement location service
    - Create `src/services/location-service.ts` with `listLocations(): Promise<Location[]>` (using `location_counts` view), `createLocation(input, userId): Promise<Location>`, `updateLocation(zoneId, input, userId): Promise<Location>`; enforce cold zone temperature validation, capacity constraints
    - _Requirements: 14.1–14.6_

  - [x] 12.2 Implement location API routes
    - Create `src/app/api/locations/route.ts` (GET — all authenticated; POST — admin only)
    - Create `src/app/api/locations/[zone_id]/route.ts` (GET — all authenticated; PATCH — admin only)
    - _Requirements: 2.3, 2.4, 14.1–14.6_

  - [x] 12.3 Write unit tests for location service
    - Test `listLocations` returns zones with computed `current_count`
    - Test cold zone creation without `temperature_target` → `VALIDATION_ERROR`
    - Test cold zone with `temperature_target` outside −30 to 10 → `VALIDATION_ERROR`
    - Test item assignment to full zone → `VALIDATION_ERROR`
    - Test zone with `capacity = 0` → no capacity warning
    - _Requirements: 14.1–14.6_

- [x] 13. Property-based tests — location zones
  - [x] 13.1 Write property test for zone capacity invariant (Property 12)
    - **Property 12: Zone Capacity Invariant**
    - For any Location with `capacity > 0`, generate item assignments that would exceed capacity; assert each over-capacity assignment returns `VALIDATION_ERROR` and `current_count` never exceeds `capacity`
    - **Validates: Requirements 14.2, 14.3, 14.5**

  - [x] 13.2 Write property test for cold zone temperature validation (Property 13)
    - **Property 13: Cold Zone Temperature Validation**
    - Use `fc.record({ type: fc.constant("cold"), temperature_target: fc.oneof(fc.constant(null), fc.float({min: -100, max: -31}), fc.float({min: 11, max: 100})) })` to generate invalid cold zones; assert every such request returns `VALIDATION_ERROR`
    - **Validates: Requirements 14.4**

- [x] 14. Property-based tests — QR code
  - [x] 14.1 Write property test for QR code round-trip (Property 14)
    - **Property 14: QR Code Round-Trip**
    - Use `fc.string({minLength:1, maxLength:20}).map(s => \`LOT-2026-${s.padStart(5,'0').slice(0,5)}\`)`to generate valid Lot IDs; generate QR PNG via`GET /api/qr/{lot_id}`; decode with `@zxing/browser`or`jsQR`; assert decoded string equals original `lot_id` exactly
    - **Validates: Requirements 15.1, 15.3**

- [x] 15. WebSocket server integration
  - [x] 15.1 Implement WebSocket client utility
    - Create `src/lib/websocket-client.ts` with `createWsClient(token: string)` that connects to `wss://{daas-host}/ws?token={JWT}`, handles `item_updated` and `item_created` events, auto-reconnects up to 5 times at 1-second intervals on drop, exposes `onEvent(handler)` and `disconnect()` methods
    - _Requirements: 11.3–11.7_

  - [x] 15.2 Implement WebSocket event publisher in item service
    - Add `publishWsEvent(event: WsServerEvent): Promise<void>` to `src/services/item-service.ts` that posts to the DaaS WebSocket broadcaster endpoint; log failure without rolling back item update
    - _Requirements: 11.1, 11.2_

  - [x] 15.3 Write unit tests for WebSocket client utility
    - Test successful connection with valid token
    - Test `item_updated` event triggers `onEvent` handler with correct payload
    - Test `item_created` event triggers `onEvent` handler
    - Test auto-reconnect: simulate 3 drops, assert 3 reconnect attempts at 1-second intervals
    - Test max 5 reconnect attempts then stops
    - _Requirements: 11.3, 11.7_

- [x] 16. Property-based tests — WebSocket
  - [x] 16.1 Write property test for WebSocket events on item changes (Property 19)
    - **Property 19: WebSocket Events Published on Item Changes**
    - For any item status/location change, assert `item_updated` event published with `lot_id`, `current_status`, `location_zone`, `updated_at`; for any new registration, assert `item_created` event published with `lot_id`, `material_type`, `current_status`, `created_at`
    - **Validates: Requirements 11.1, 11.2**

  - [x] 16.2 Write property test for WebSocket connection rejects invalid tokens (Property 20)
    - **Property 20: WebSocket Connection Rejects Invalid Tokens**
    - Use `fc.oneof(fc.constant(null), fc.string(), fc.record({...expired...}))` to generate invalid/expired tokens; assert every connection attempt is rejected with `UNAUTHORIZED`
    - **Validates: Requirements 11.6**

- [x] 17. Property-based tests — API response envelope
  - [x] 17.1 Write property test for API response envelope invariant (Property 21)
    - **Property 21: API Response Envelope Invariant**
    - For any API request (success or error), assert response conforms to standard envelope: success → `{ success: true, data, meta: { timestamp, request_id } }`; error → `{ success: false, error: { code, message }, meta }`; `request_id` is unique UUID v4; error codes map to correct HTTP status; paginated endpoints include `pagination` object
    - **Validates: Requirements 16.1–16.5**

- [x] 18. Checkpoint — backend services complete
  - Ensure all unit and property tests pass. Run `npx vitest --run`. Ask the user if any questions arise before proceeding.

- [x] 19. Mobile PWA — ScanQueue and offline buffering
  - [x] 19.1 Implement ScanQueue class
    - Create `src/lib/scan-queue.ts` with `ScanQueue` class backed by `localStorage` key `drums_scan_queue`; implement `enqueue(scan: Omit<QueuedScan, 'id' | 'retries' | 'status'>)` (max 500, reject with warning when full), `dequeue()`, `markFailed(id, error)`, `markSuccess(id)`, `getPending(): QueuedScan[]`, `getAll(): QueuedScan[]`, `size(): number`
    - _Requirements: 7.1, 7.4, 7.5, 7.7_

  - [x] 19.2 Implement offline sync manager
    - Create `src/lib/sync-manager.ts` with `SyncManager` class that listens to `navigator.onLine` + `online` event, on reconnect submits pending scans from `ScanQueue` in FIFO order via `POST /api/items/bulk-scan`, retries each failed scan up to 3 times at 5-second intervals, removes successful scans, marks permanently failed scans
    - _Requirements: 7.2, 7.3, 7.4, 7.6_

  - [x] 19.3 Implement duplicate scan detection
    - Add in-memory `Set<string>` session tracker to `SyncManager`; before submitting a scan, check if `lot_id` already processed in current session; if duplicate, display warning and do NOT submit
    - _Requirements: 6.9_

  - [x] 19.4 Write unit tests for ScanQueue
    - Test enqueue up to 500 → accepted; 501st → rejected with warning, existing scans preserved
    - Test FIFO ordering: enqueue A, B, C → dequeue returns A, B, C
    - Test `markFailed` sets `status = "failed"` and `error` without removing from queue
    - Test `markSuccess` removes scan from queue
    - Test persistence: serialize/deserialize from localStorage
    - _Requirements: 7.1, 7.4, 7.5, 7.7_

  - [x] 19.5 Write unit tests for sync manager
    - Test online event triggers sync of all pending scans in FIFO order
    - Test retry: failed scan retried up to 3 times at 5-second intervals
    - Test after 3 retries → marked failed, other scans continue
    - Test successful scan removed from queue
    - Test duplicate `lot_id` in session → warning displayed, not submitted
    - _Requirements: 7.2, 7.3, 7.4, 6.9_

- [x] 20. Property-based tests — ScanQueue
  - [x] 20.1 Write property test for ScanQueue capacity and persistence (Property 10)
    - **Property 10: ScanQueue Capacity and Persistence**
    - Use `fc.array(fc.record({...}), {minLength:1, maxLength:500})` to generate scan sequences; assert all ≤ 500 stored; assert 501st rejected with warning and existing scans preserved; assert queue survives serialize/deserialize round-trip
    - **Validates: Requirements 7.1, 7.6, 7.7**

  - [x] 20.2 Write property test for ScanQueue sync order and retry (Property 11)
    - **Property 11: ScanQueue Sync Order and Retry Behavior**
    - Generate N pending scans; simulate network restore; assert scans submitted in FIFO order; assert each failed scan retried ≤ 3 times; assert successful scans removed; assert failed scans marked without discarding others
    - **Validates: Requirements 7.2, 7.3, 7.4**

- [x] 21. Mobile PWA — camera scanning UI
  - [x] 21.1 Implement QR scanner component
    - Create `src/components/QrScanner.tsx` using `@zxing/browser` or `html5-qrcode`; keep camera open in Scan Mode; on each successful decode call `onScan(lot_id)` callback; display scan result overlay (green check on success, red alert on error) within 500ms of server response; play audio beep on success, distinct alert on error
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 21.2 Implement Scan Mode page
    - Create `src/app/scan/page.tsx` with target status selector, `QrScanner` component, session summary counter (total/succeeded/failed), duplicate scan warning, offline queue count indicator, "Finish" button that exits Scan Mode and shows session summary
    - _Requirements: 6.1–6.3, 6.7, 6.9, 7.5_

  - [x] 21.3 Configure PWA manifest and service worker
    - Create `public/manifest.json` with app name, icons, `display: "standalone"`, `start_url`
    - Configure `next.config.ts` with `next-pwa` or equivalent for service worker generation
    - _Requirements: 7.6 (PWA installability for offline resilience)_

- [x] 22. Web Dashboard — floor plan view
  - [x] 22.1 Implement floor plan zone card component
    - Create `src/components/ZoneCard.tsx` displaying zone `name`, `type`, `current_count`, capacity warning indicator (when `current_count >= capacity > 0`), color coding: cold=blue, hazard=red, qc=yellow, production=orange, standard=grey
    - _Requirements: 8.4, 8.5_

  - [x] 22.2 Implement floor plan page with WebSocket subscription
    - Create `src/app/dashboard/page.tsx` that fetches all locations via HTTP on load, renders `ZoneCard` grid, establishes WebSocket subscription via `createWsClient`, updates zone counts on `item_updated` events within 2 seconds, handles zone click to show items list, auto-reconnects with "reconnecting" indicator
    - _Requirements: 8.1–8.6, 11.3, 11.7_

- [x] 23. Web Dashboard — search, audit log, and auth pages
  - [x] 23.1 Implement global search page
    - Create `src/app/search/page.tsx` with search input, calls `GET /api/search?q=`, displays item details and full history in reverse chronological order
    - _Requirements: 9.1, 9.5_

  - [x] 23.2 Implement audit log viewer page
    - Create `src/app/audit/page.tsx` (admin only) with date range filters, paginated table of AuditEntry records, CSV export button that triggers `GET /api/audit-logs/export?format=csv`
    - _Requirements: 10.4–10.7_

  - [x] 23.3 Implement item registration form page
    - Create `src/app/register/page.tsx` with form for `material_type`, `supplier`, `intake_date`; on submit calls `POST /api/items`; displays returned `lot_id` and QR code image
    - _Requirements: 3.1, 3.7, 15.1, 15.2_

  - [x] 23.4 Implement authentication pages and session management
    - Create `src/app/login/page.tsx` with email/password form calling `POST /api/auth/login`; store JWT in `httpOnly` cookie or `sessionStorage`; implement `src/lib/auth-context.tsx` React context providing `user`, `token`, `logout`; redirect unauthenticated users to `/login`
    - _Requirements: 1.1, 1.2, 2.6_

- [x] 24. Integration wiring and database setup
  - [x] 24.1 Create database migration SQL file
    - Create `supabase/migrations/001_initial_schema.sql` with the full DDL from the design: `locations`, `lot_id_sequences`, `items`, `audit_logs` tables, all indexes, RLS policies, `location_counts` view, and seed `RECEIVING` zone
    - _Requirements: 4.2, 5.4, 10.2, 14.1_

  - [x] 24.2 Wire RBAC middleware into all API routes
    - Audit every route handler to ensure `checkPermission` is called with the injected `x-user-role` header; add `forbidden_attempt` AuditEntry write to the RBAC rejection path in middleware
    - _Requirements: 2.1–2.6_

  - [x] 24.3 Wire WebSocket event publishing into item service
    - Ensure `publishWsEvent` is called after every successful `updateItemStatus` and `registerItem` call; verify failure to publish does not roll back the item update
    - _Requirements: 11.1, 11.2_

  - [x] 24.4 Configure environment variables and Amplify deployment settings
    - Document all required env vars in `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DAAS_BASE_URL`, `DAAS_WS_URL`
    - Create `amplify.yml` with build settings for Next.js SSR on AWS Amplify
    - _Requirements: 12.3 (deployment)_

- [x] 25. Integration tests
  - [x] 25.1 Write integration test for WORM audit log enforcement
    - Connect to test Supabase instance; attempt `UPDATE` and `DELETE` on `audit_logs`; assert both are rejected by RLS
    - _Requirements: 10.2_

  - [x] 25.2 Write integration test for Lot ID unique constraint
    - Attempt to insert two items with the same `lot_id`; assert second insert is rejected with unique constraint violation
    - _Requirements: 4.2, 13.6_

  - [x] 25.3 Write integration test for health and readiness endpoints
    - Test `GET /api/health` returns 200 `{ status: "ok" }` when running
    - Test `GET /api/readiness` returns 200 `{ ready: true }` when DB connected; mock DB failure → 503 `{ ready: false, error: "INTERNAL_ERROR" }`
    - _Requirements: 12.4, 12.5, 12.6_

  - [x] 25.4 Write integration test for WebSocket broadcast
    - Connect 2 authenticated clients; trigger item status update; assert both clients receive `item_updated` event within 2 seconds
    - _Requirements: 11.3_

- [x] 26. Final checkpoint — all tests pass
  - Run `npx vitest --run` for all unit and property tests. Run integration tests against test Supabase instance. Ask the user if any questions arise before proceeding to E2E.

- [ ] 27. Fix missing `WsServerEvent` import in item service
  - [x] 27.1 Add `WsServerEvent` to the type imports in `src/services/item-service.ts`
    - `WsServerEvent` is used by `publishWsEvent` but is not imported from `@/types`; add it to the existing `import type { ... } from "@/types"` block
    - _Requirements: 11.1, 11.2_

  - [ ]\* 27.2 Verify TypeScript compilation passes after import fix
    - Run `npx tsc --noEmit` and confirm zero type errors in `src/services/item-service.ts`
    - _Requirements: 11.1, 11.2_

- [ ] 28. Add root home page with navigation
  - [x] 28.1 Create `src/app/page.tsx` as the authenticated home/navigation hub
    - Redirect unauthenticated users to `/login` via `useRequireAuth()`
    - Display navigation cards linking to `/dashboard`, `/scan`, `/register`, `/search`, and `/audit` (admin only)
    - Show the logged-in user's name, email, and role; include a logout button
    - _Requirements: 2.1–2.4 (role-appropriate navigation), 1.1 (session display)_

  - [ ]\* 28.2 Write unit tests for home page navigation rendering
    - Test operator role: scan, register, dashboard, search links visible; audit link hidden
    - Test admin role: all links including audit visible
    - Test ppic role: dashboard and search visible; scan and register hidden
    - _Requirements: 2.1–2.4_

- [ ] 29. Implement item location update endpoint
  - [x] 29.1 Add `updateItemLocation` function to item service
    - Add `updateItemLocation(lotId: string, targetZone: string, userId: string, userEmail: string, ip: string): Promise<Item>` to `src/services/item-service.ts`
    - Validate that `targetZone` exists in the `locations` table; return `VALIDATION_ERROR` with code `INVALID_ZONE` if not found
    - Check zone capacity: if `current_count >= capacity > 0`, return `VALIDATION_ERROR` indicating zone is at capacity
    - Atomically update `location_zone` and `updated_at` in the `items` table
    - Write an `item_location_changed` AuditEntry with `previous_state = JSON.stringify({ location_zone: oldZone })` and `new_state = JSON.stringify({ location_zone: targetZone })`
    - Publish an `item_updated` WebSocket event with the new `location_zone`
    - _Requirements: 13.3, 14.3, 14.5, 10.1, 11.1_

  - [x] 29.2 Add `PATCH /api/items/[id]` route for location updates
    - Create `src/app/api/items/[id]/route.ts` PATCH handler that reads `x-user-role`, checks RBAC (operator/admin), validates request body `{ location_zone: string }`, calls `updateItemLocation`, returns updated item or appropriate error
    - _Requirements: 2.1, 2.4, 13.3, 14.3, 14.5_

  - [ ]\* 29.3 Write unit tests for item location update service
    - Test valid zone → item `location_zone` updated, `updated_at` refreshed
    - Test non-existent zone → `VALIDATION_ERROR` with `INVALID_ZONE`
    - Test zone at capacity → `VALIDATION_ERROR`
    - Test zone with `capacity = 0` → update succeeds (no capacity limit)
    - Test `item_location_changed` AuditEntry written with correct `previous_state` and `new_state`
    - _Requirements: 13.3, 14.3, 14.5, 10.1_

- [ ] 30. Admin user management page
  - [x] 30.1 Create `src/app/admin/page.tsx` for admin user management
    - Guard with `useRequireAuth()` and redirect non-admin roles to `/`
    - Display a list of all users (fetched from Supabase Auth admin API via a server action or API route)
    - Provide UI to create a new user (email, password, role), update a user's role, and deactivate (disable) a user
    - _Requirements: 2.4 (admin may perform user management)_

  - [x] 30.2 Implement `GET /api/admin/users` and `POST /api/admin/users` routes
    - Create `src/app/api/admin/users/route.ts` (GET — list users; POST — create user); enforce admin-only RBAC; use Supabase Auth Admin API (`supabase.auth.admin.listUsers`, `supabase.auth.admin.createUser`)
    - _Requirements: 2.4_

  - [x] 30.3 Implement `PATCH /api/admin/users/[id]` and `DELETE /api/admin/users/[id]` routes
    - Create `src/app/api/admin/users/[id]/route.ts` (PATCH — update role; DELETE — deactivate user); enforce admin-only RBAC; use `supabase.auth.admin.updateUserById` and `supabase.auth.admin.deleteUser`
    - _Requirements: 2.4_

  - [ ]\* 30.4 Write unit tests for admin user management routes
    - Test non-admin role → `FORBIDDEN` on all admin routes
    - Test admin role → list users returns array; create user returns new user; update role succeeds; deactivate succeeds
    - _Requirements: 2.4, 2.5_

- [x] 31. Final checkpoint — gaps resolved
  - Ensure all new tasks pass. Run `npx vitest --run`. Verify TypeScript compiles with `npx tsc --noEmit`. Ask the user if any questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery
- All code is TypeScript; property-based tests use `fast-check` with Vitest (minimum 100 iterations per property)
- Property test files live in `src/__tests__/properties/`; unit test files in `src/__tests__/unit/`
- Each property test is tagged with `// Feature: drums-tracking, Property N: <property_text>`
- The design document's `VALID_TRANSITIONS` map is the single source of truth for state machine logic — never duplicate it
- The `RECEIVING` zone must be seeded in the DB before any item registration can succeed
- WebSocket publish failures must never roll back item updates (fire-and-forget with logging)
- Audit log writes that fail after item persistence must return `INTERNAL_ERROR` to the caller but must NOT roll back the item record
- All API responses must use the standard envelope from `src/lib/api-response.ts`
- Rate limiter state is in-memory; on Amplify SSR, consider Redis if multiple instances are deployed
- Tasks 1–26 are fully implemented; tasks 27–31 represent genuine gaps identified during the post-implementation audit

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6", "1.8", "1.10"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7", "1.9", "1.11"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.4", "5.1"] },
    { "id": 4, "tasks": ["3.3", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 5, "tasks": ["3.9", "4.1", "4.2", "4.3"] },
    { "id": 6, "tasks": ["5.2", "5.4"] },
    { "id": 7, "tasks": ["5.3", "5.5", "5.6"] },
    { "id": 8, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 9, "tasks": ["7.1", "7.3"] },
    { "id": 10, "tasks": ["7.2", "7.5"] },
    { "id": 11, "tasks": ["7.4", "7.6", "8.1", "8.2", "8.3"] },
    { "id": 12, "tasks": ["10.1", "10.3", "12.1"] },
    {
      "id": 13,
      "tasks": ["10.2", "10.4", "10.5", "10.6", "10.7", "12.2", "12.3"]
    },
    { "id": 14, "tasks": ["11.1", "11.2", "11.3", "11.4", "13.1", "13.2"] },
    { "id": 15, "tasks": ["14.1", "15.1", "15.2"] },
    { "id": 16, "tasks": ["15.3", "16.1", "16.2", "17.1"] },
    { "id": 17, "tasks": ["19.1"] },
    { "id": 18, "tasks": ["19.2", "19.3"] },
    { "id": 19, "tasks": ["19.4", "19.5", "20.1", "20.2"] },
    { "id": 20, "tasks": ["21.1", "21.3"] },
    { "id": 21, "tasks": ["21.2", "22.1"] },
    { "id": 22, "tasks": ["22.2", "23.1", "23.2", "23.3", "23.4"] },
    { "id": 23, "tasks": ["24.1", "24.2", "24.3", "24.4"] },
    { "id": 24, "tasks": ["25.1", "25.2", "25.3", "25.4"] },
    { "id": 25, "tasks": ["27.1"] },
    { "id": 26, "tasks": ["27.2", "28.1", "29.1"] },
    { "id": 27, "tasks": ["28.2", "29.2", "30.1", "30.2"] },
    { "id": 28, "tasks": ["29.3", "30.3"] },
    { "id": 29, "tasks": ["30.4"] }
  ]
}
```
