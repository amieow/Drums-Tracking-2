# Requirements Document

## Introduction

Drums Trackers is an enterprise-grade centralized inventory management system for Sima Arome's warehouse and production floor. The system replaces fragmented manual processes (spreadsheets, notebooks, chat logs) with a secure, real-time, auditable single source of truth for every drum of raw material and finished extract. It enables warehouse operators to update drum status and location via mobile QR scanning, gives PPIC and QC staff instant visibility, and provides compliance officers with an immutable audit trail — eliminating double data entry and manual tracking across the supply chain.

---

## Glossary

- **System**: The Drums Trackers application as a whole.
- **Auth_Service**: The authentication and authorization component backed by Supabase, responsible for verifying user identity and issuing JWT tokens.
- **Item_Service**: The backend component responsible for drum/item lifecycle management, state machine enforcement, and lot ID generation.
- **Audit_Service**: The backend component responsible for writing and exporting immutable audit log entries.
- **Mobile_Client**: The mobile-optimized Progressive Web App (PWA) used by operators on the warehouse floor.
- **Web_Dashboard**: The browser-based dashboard used by PPIC, QC staff, and admins for visualization and compliance review.
- **API_Gateway**: The entry point for all HTTP requests, handling SSL termination, rate limiting, and auth token validation.
- **WebSocket_Server**: The real-time event broadcast component that pushes item state changes to all connected clients.
- **Database**: The PostgreSQL database serving as the primary persistent store for items, locations, and audit logs.
- **Lot_ID**: A unique, human-readable drum identifier following the format `LOT-YYYY-NNNNN` (e.g., `LOT-2026-00001`).
- **Item**: A single drum of raw material or finished extract tracked by the system.
- **ItemStatus**: An enumerated set of valid drum lifecycle states: `received`, `qc_pending`, `qc_pass`, `qc_fail`, `in_production`, `finished`, `cold_storage`, `dispatched`, `archived`.
- **Location**: A named warehouse zone with a defined type, capacity, and optional temperature target.
- **AuditEntry**: An immutable, append-only record of a system event capturing who performed an action, what changed, and when.
- **ScanBatch**: A bulk API payload containing up to 50 scan items submitted in a single request.
- **Operator**: A warehouse floor user with permission to update item status and location via scanning.
- **QC_Staff**: A quality control user with permission to perform QC pass/fail status transitions.
- **PPIC**: A production planning user with read-only access to all items and production schedules.
- **Admin**: A user with full system access including user management and audit log export.
- **RBAC**: Role-Based Access Control — the permission model governing what each role may read or write.
- **WORM**: Write Once, Read Many — the compliance requirement that audit log entries are immutable and cannot be deleted or modified.
- **Scan_Mode**: The mobile UI state in which the camera is active and each successful QR scan triggers an immediate item update.
- **ScanQueue**: The client-side offline buffer that stores scans when network connectivity is unavailable.
- **State_Machine**: The enforced set of valid `ItemStatus` transitions that prevents invalid workflow progressions.

---

## Requirements

---

### Requirement 1: Enterprise Authentication

**User Story:** As a Sima Arome staff member, I want to log in with my corporate credentials and be assigned a role, so that I can access only the features appropriate to my job function.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Auth_Service SHALL issue a signed JWT token containing the user's `id`, `email`, and `role`, with an expiry of 8 hours from the time of issuance.
2. WHEN a user submits invalid credentials, THE Auth_Service SHALL return an `AUTH_FAILED` error response and SHALL NOT issue a token.
3. WHEN a login attempt is made more than 5 times with invalid credentials within 10 minutes from the same IP address, THE Auth_Service SHALL return a `RATE_LIMITED` error, SHALL block further attempts for 10 minutes, and SHALL automatically unblock the IP after the 10-minute window expires.
4. WHEN a request arrives at the API_Gateway without a JWT token whose signature is valid, expiry has not passed, and role claim is a member of `["operator", "qc", "ppic", "admin"]`, THE API_Gateway SHALL return an `UNAUTHORIZED` error response without forwarding the request to downstream services.
5. IF a JWT token's expiry timestamp is earlier than the current server time, THEN THE API_Gateway SHALL reject the token and return an `UNAUTHORIZED` error response without forwarding to downstream services.
6. THE Auth_Service SHALL assign each authenticated user exactly one role from the set `["operator", "qc", "ppic", "admin"]`.
7. IF a user's JWT token role claim is absent or its value is not a member of `["operator", "qc", "ppic", "admin"]`, THEN THE Auth_Service SHALL reject the login and return an `AUTH_FAILED` error.

---

### Requirement 2: Role-Based Access Control (RBAC)

**User Story:** As a system administrator, I want each role to have strictly enforced permissions, so that unauthorized users cannot perform actions outside their job scope.

#### Acceptance Criteria

1. WHILE a user holds the `operator` role, THE System SHALL permit the user to register new items, update item status and location via scan, and read item records; and SHALL deny access to user management, audit log export, and `qc_pass`/`qc_fail` status transitions.
2. WHILE a user holds the `qc` role, THE System SHALL permit the user to perform `qc_pass` and `qc_fail` status transitions and read item records; and SHALL deny access to user management and audit log export.
3. WHILE a user holds the `ppic` role, THE System SHALL permit the user to read all item records and production schedules; and SHALL deny all write operations on items, user management, and audit log export.
4. WHILE a user holds the `admin` role, THE System SHALL permit the user to perform all actions including item registration, item status updates, user management (create, update, deactivate users), and audit log export.
5. WHEN a user attempts an action that exceeds their role's permissions, THE API_Gateway SHALL return a `FORBIDDEN` error response without executing the action and SHALL write a `FORBIDDEN_ATTEMPT` AuditEntry recording the `user_id`, `action`, and `timestamp`.
6. THE System SHALL enforce RBAC checks on every API request and every WebSocket connection, including requests from authenticated users with valid tokens.

---

### Requirement 3: Item Registration (Intake)

**User Story:** As an operator, I want to register a new drum of raw material into the system, so that it receives a unique traceable identity from the moment it enters the warehouse.

#### Acceptance Criteria

1. WHEN an authenticated operator submits a registration request with `material_type`, `supplier`, and `intake_date`, THE Item_Service SHALL create a new Item record with `current_status` set to `received` and `location_zone` set to `RECEIVING`, where `RECEIVING` is a pre-configured Location zone that must exist in the `locations` table.
2. THE Item_Service SHALL generate a unique `Lot_ID` in the format `LOT-YYYY-NNNNN` for each newly registered item, where `YYYY` is the four-digit intake year and `NNNNN` is a zero-padded sequential counter that resets to `00001` at the start of each new calendar year.
3. WHEN two registration requests are processed concurrently, THE Item_Service SHALL assign distinct `Lot_ID` values to each item with no collisions.
4. WHEN a registration request is submitted with a missing or empty `material_type`, `supplier`, or `intake_date`, THE Item_Service SHALL return a `VALIDATION_ERROR` response identifying the missing fields and SHALL NOT create an item record.
5. WHEN a registration request is submitted with an `intake_date` set to a date after the current server UTC date, THE Item_Service SHALL return a `VALIDATION_ERROR` response.
6. WHEN a new item is successfully registered, THE Item_Service SHALL emit an `item_created` event to the WebSocket_Server and SHALL write an `item_created` AuditEntry; IF registration fails for any reason, THE Item_Service SHALL NOT emit events or write AuditEntry records; IF the item record is persisted but the event emission or audit write fails, THE Item_Service SHALL retain the item record without rolling back the registration.
7. WHEN a new item is successfully registered, THE System SHALL return the generated `Lot_ID`, a QR code URL, the `created_at` timestamp (server-generated at the moment of persistence), and the initial `current_status`.

---

### Requirement 4: Lot ID Format and Uniqueness

**User Story:** As a warehouse operator, I want every drum to have a scannable, human-readable lot number, so that I can identify and track it unambiguously throughout its lifecycle.

#### Acceptance Criteria

1. THE Item_Service SHALL generate all `Lot_ID` values matching the regular expression `^LOT-\d{4}-\d{5}$`, where the four-digit year segment equals the calendar year of the item's `intake_date` (range 2000–2099) and the five-digit counter segment is in the range 00001–99999.
2. THE Database SHALL enforce a unique constraint on the `lot_id` column of the items table, rejecting duplicate values.
3. FOR ALL items, THE `Lot_ID` value returned in any API response SHALL be identical to the value stored in the Database and retrievable via the search endpoint (observable consistency property).
4. WHEN the sequential counter within a calendar year reaches `99999`, THE Item_Service SHALL return an `INTERNAL_ERROR` and SHALL NOT generate a duplicate `Lot_ID`.
5. WHEN a new calendar year begins, THE Item_Service SHALL reset the sequential counter to `00001` for `Lot_ID` generation, ensuring uniqueness is maintained across year boundaries.

---

### Requirement 5: Item Status State Machine

**User Story:** As a system administrator, I want item status transitions to be strictly enforced, so that drums cannot be moved to invalid lifecycle states that would compromise traceability.

#### Acceptance Criteria

1. THE Item_Service SHALL enforce the following valid status transitions:
   - `received` → `qc_pending`
   - `qc_pending` → `qc_pass`, `qc_fail`
   - `qc_pass` → `in_production`, `cold_storage`
   - `qc_fail` → `archived`
   - `in_production` → `finished`
   - `finished` → `cold_storage`, `dispatched`
   - `cold_storage` → `dispatched`
   - `dispatched` → `archived`
2. WHEN a scan or update request targets a status transition not listed in criterion 1, THE Item_Service SHALL return an `INVALID_TRANSITION` error including the `current_status`, `target_status`, and the list of allowed transitions from the current status.
3. IF an item's `current_status` is `archived`, THEN THE Item_Service SHALL return an `INVALID_TRANSITION` error for any transition request and SHALL NOT update the item.
4. WHEN a valid status transition is applied, THE Item_Service SHALL update `current_status` and `updated_at` atomically in the Database and SHALL write an `item_status_changed` AuditEntry; IF the database update fails, THE Item_Service SHALL return an `INTERNAL_ERROR` response immediately without retrying.
5. FOR ALL items, THE Item_Service SHALL ensure `current_status` always holds a value from the `ItemStatus` enum after any operation.
6. WHEN a scan or update request specifies a `target_status` equal to the item's `current_status`, THE Item_Service SHALL return an `INVALID_TRANSITION` error, as self-transitions are not permitted.

---

### Requirement 6: Bulk Scan Mode (Select & Scan)

**User Story:** As a warehouse operator, I want to select a target status or location and then scan multiple drums in succession, so that I can process a batch of drums quickly without navigating menus between each scan.

#### Acceptance Criteria

1. WHEN an operator activates Scan_Mode with a selected `target_status` or `target_location`, THE Mobile_Client SHALL open the camera and process each scanned `Lot_ID` as an individual update request without requiring the operator to return to the menu.
2. WHEN a scanned `Lot_ID` is successfully updated, THE Mobile_Client SHALL provide audio confirmation (beep) and visual confirmation (green check) within 500 milliseconds of receiving the server success response.
3. WHEN a scanned `Lot_ID` results in an error (item not found, invalid transition, insufficient permissions), THE Mobile_Client SHALL provide a distinct audio alert and display the specific error message without exiting Scan_Mode.
4. IF a `ScanBatch` request is submitted, THEN THE Item_Service SHALL accept between 1 and 50 scan items in a single API call.
5. WHEN a `ScanBatch` request contains more than 50 items, THE Item_Service SHALL return a `BATCH_TOO_LARGE` error and SHALL NOT process any items in the batch.
6. WHEN a `ScanBatch` request contains a mix of valid and invalid items, THE Item_Service SHALL process all valid items, return per-item results as `{ "lot_id": string, "success": boolean, "error"?: string }`, and respond with HTTP 207 indicating partial success.
7. WHEN an operator taps "Finish" in Scan_Mode, THE Mobile_Client SHALL exit Scan_Mode and display a summary of the total items processed, succeeded, and failed in the session.
8. WHEN a scan item is successfully processed, THE Item_Service SHALL write one `item_status_changed` or `item_location_changed` AuditEntry for that item.
9. WHEN a `Lot_ID` that has already been successfully scanned in the current Scan_Mode session is scanned again, THE Mobile_Client SHALL display a warning indicating the item was already processed in this session and SHALL NOT submit a duplicate update request.

---

### Requirement 7: Offline Scan Buffering

**User Story:** As a warehouse operator working in areas with poor connectivity, I want my scans to be saved locally and synced automatically when the network is restored, so that I never lose scan data due to connectivity issues.

#### Acceptance Criteria

1. WHILE the Mobile_Client has no network connectivity, THE Mobile_Client SHALL store each scan in the local ScanQueue using the device's localStorage, up to a maximum of 500 queued scans.
2. WHEN network connectivity is restored, THE Mobile_Client SHALL automatically submit all queued scans from the ScanQueue to the Item_Service in the order they were captured, retrying each failed submission up to 3 times at 5-second intervals before marking it as failed.
3. WHEN a queued scan is successfully submitted after reconnection, THE Mobile_Client SHALL remove the scan from the ScanQueue and display a sync confirmation to the operator.
4. WHEN a queued scan fails submission after reconnection due to a business rule error (e.g., invalid transition) or after exhausting all retry attempts for a transient network error, THE Mobile_Client SHALL mark the scan as failed in the ScanQueue and display the specific error to the operator without discarding other queued scans.
5. WHILE the ScanQueue contains one or more pending scans, THE Mobile_Client SHALL display the count of pending offline scans to the operator.
6. WHEN the Mobile_Client is closed and reopened and network connectivity is available, THE Mobile_Client SHALL restore all pending (non-failed) scans from localStorage and automatically resume sync.
7. WHEN the ScanQueue reaches its maximum capacity of 500 scans, THE Mobile_Client SHALL reject new scans, display a warning to the operator that the queue is full, and SHALL NOT overwrite existing queued scans.

---

### Requirement 8: Digital Floor Plan View

**User Story:** As a PPIC team member, I want to view a visual warehouse map showing the real-time count and status of drums per zone, so that I can monitor inventory placement without walking the floor.

#### Acceptance Criteria

1. WHEN the Web_Dashboard floor plan page is loaded, THE Web_Dashboard SHALL fetch all Location records via HTTP and render a visual floor plan displaying each zone's `name`, `type`, and current drum count before establishing the WebSocket subscription.
2. WHEN an item's `location_zone` changes and THE WebSocket_Server broadcasts an `item_updated` event, THE Web_Dashboard SHALL update the affected zone's drum count within 2 seconds of receiving the event.
3. WHEN a user taps or clicks a zone on the floor plan, THE Web_Dashboard SHALL display a list of all items currently assigned to that zone, including each item's `lot_id`, `current_status`, and `updated_at`.
4. THE Web_Dashboard SHALL visually distinguish zone types using distinct color coding: `cold` zones in blue, `hazard` zones in red, `qc` zones in yellow, `production` zones in orange, and `standard` zones in grey.
5. IF a zone's `current_count` equals its `capacity` (where `capacity` is greater than zero), THEN THE Web_Dashboard SHALL display a visual capacity warning indicator on that zone.
6. THE Web_Dashboard SHALL maintain real-time floor plan accuracy via WebSocket subscription and SHALL NOT require a manual page reload to reflect item movements.

---

### Requirement 9: Global Search

**User Story:** As any authenticated staff member, I want to search for a drum by its lot number or ID and see its full history, so that I can locate any item and review its complete lifecycle within 10 seconds.

#### Acceptance Criteria

1. WHEN an authenticated user submits a search query containing a valid `Lot_ID` or item `id`, THE Item_Service SHALL return the matching item's full record including `lot_id`, `material_type`, `supplier`, `intake_date`, `current_status`, `location_zone`, and `history` (where each history entry contains `action`, `previous_state`, `new_state`, `user_id`, and `timestamp`).
2. WHEN a search query matches no item, THE Item_Service SHALL return a `NOT_FOUND` error response.
3. WHEN a search query is submitted with an empty string, a whitespace-only string, or a string that does not match the `Lot_ID` regex (`^LOT-\d{4}-\d{5}$`) and is not a non-empty alphanumeric UUID, THE Item_Service SHALL return a `VALIDATION_ERROR` response without executing a database query.
4. THE Item_Service SHALL return search results within 500 milliseconds for any valid query against a dataset of up to 100,000 items.
5. WHEN search results are returned, THE Web_Dashboard SHALL display the item's full `history` array showing each `action`, `previous_state`, `new_state`, `user_id`, and `timestamp` in reverse chronological order.
6. WHEN a user registers an item and then searches by its `Lot_ID`, THE Item_Service SHALL return the registered item with `lot_id`, `material_type`, `supplier`, `intake_date`, `current_status`, and `location_zone` matching the registration input and defaults (round-trip property).
7. WHEN a search query is submitted, THE Item_Service SHALL perform exact-match lookup on `lot_id` or `id` fields only and SHALL NOT perform partial, prefix, or substring matching.

---

### Requirement 10: Compliance and Audit Log

**User Story:** As a compliance officer or admin, I want an immutable, tamper-proof log of every system action, so that I can satisfy regulatory audits and investigate any operational incident.

#### Acceptance Criteria

1. THE Audit_Service SHALL write an AuditEntry for every item creation, status change, location change, bulk update item, user login, user logout, and audit export event.
2. THE Database SHALL enforce append-only access on the `audit_logs` table, rejecting any UPDATE or DELETE operations regardless of the requesting user's role.
3. WHEN an AuditEntry is written for an item event, THE Audit_Service SHALL record `item_id`, `action`, `previous_state`, `new_state`, `user_id`, `user_email`, `ip_address`, and `timestamp` using server-generated time; WHEN an AuditEntry is written for a non-item event (e.g., `user_login`, `audit_exported`), THE Audit_Service SHALL set `item_id` and `previous_state` to `null` and `new_state` to a JSON object describing the event context.
4. WHEN an admin queries the audit log with `date_from` and `date_to` filters, THE Audit_Service SHALL return all AuditEntry records with `timestamp` within the specified range, ordered by `timestamp` descending, paginated at up to 50 entries per page; WHEN `date_from` or `date_to` is not a valid ISO 8601 datetime string, THE Audit_Service SHALL return a `VALIDATION_ERROR`.
5. WHEN a non-admin user attempts to access the audit log endpoint, THE API_Gateway SHALL return a `FORBIDDEN` error response.
6. WHEN an admin requests an audit log export with `format=csv`, THE Audit_Service SHALL return a downloadable CSV file containing all AuditEntry fields for the specified date range, limited to a maximum of 10,000 entries per export; IF the result set exceeds 10,000 entries, THE Audit_Service SHALL return a `VALIDATION_ERROR` instructing the admin to narrow the date range.
7. WHEN an audit log export is performed, THE Audit_Service SHALL write an `audit_exported` AuditEntry recording the exporting user's `user_id`, `user_email`, `ip_address`, and the export parameters (`date_from`, `date_to`, `format`).
8. WHEN an AuditEntry is written and then read back by its `id`, THE Audit_Service SHALL return a record with identical field values to those that were written (round-trip immutability property).
9. WHEN the Audit_Service fails to write an AuditEntry due to a database error, THE Audit_Service SHALL return an `INTERNAL_ERROR` to the calling service and SHALL NOT silently discard the write failure.

---

### Requirement 11: Real-Time Dashboard Updates

**User Story:** As a PPIC team member or admin, I want the dashboard to reflect item changes instantly without refreshing the page, so that I always see the current warehouse state.

#### Acceptance Criteria

1. WHEN an item's `current_status` or `location_zone` changes, THE Item_Service SHALL publish an `item_updated` WebSocket event containing `lot_id`, `current_status`, `location_zone`, and `updated_at`; IF the publish fails, THE Item_Service SHALL log the failure without rolling back the item update.
2. WHEN a new item is registered, THE Item_Service SHALL publish an `item_created` WebSocket event containing `lot_id`, `material_type`, `current_status`, and `created_at`.
3. WHEN an event is published to the WebSocket_Server, THE WebSocket_Server SHALL broadcast it to all authenticated connected clients within 2 seconds of receiving the event.
4. WHEN a WebSocket client's JWT token expires during an active connection, THE WebSocket_Server SHALL send an `error` event with code `TOKEN_EXPIRED` and close the connection.
5. WHEN a WebSocket connection closes due to a network drop or server restart (not token expiry), THE WebSocket_Server SHALL send an `error` event with code `CONNECTION_CLOSED` before closing.
6. WHEN a client attempts to establish a WebSocket connection, THE WebSocket_Server SHALL validate the JWT token in the connection handshake and SHALL reject the connection with code `UNAUTHORIZED` if the token is invalid or expired.
7. WHEN the Web_Dashboard detects a WebSocket connection drop, THE Web_Dashboard SHALL attempt to reconnect automatically, up to 5 times at 1-second intervals, and SHALL display a "reconnecting" indicator to the user during each attempt.

---

### Requirement 12: Performance and Availability

**User Story:** As a warehouse operator during a shift change, I want the system to remain fast and available even when many users are active simultaneously, so that scanning operations are never blocked by system slowness.

#### Acceptance Criteria

1. WHEN a single scan item is submitted via the bulk-scan endpoint under a load of 50 or fewer concurrent users, THE System SHALL complete the full cycle of database update, audit log write, and API response within 500 milliseconds.
2. WHILE the System is serving between 50 and 100 concurrent authenticated users, THE System SHALL maintain a p95 response time of 500 milliseconds or less for all item update operations.
3. THE System SHALL achieve an uptime of 99.5% or greater, measured over any rolling 30-day period, where downtime is defined as any period during which the `GET /api/health` endpoint returns a non-200 response, excluding pre-announced maintenance windows.
4. THE API_Gateway SHALL expose a `GET /api/health` endpoint that returns HTTP 200 with `{ "status": "ok" }` when the system process is running and HTTP 503 when the system process is not running or is unable to serve requests.
5. THE API_Gateway SHALL expose a `GET /api/readiness` endpoint that returns HTTP 200 with `{ "ready": true }` only when the Database connection is active and accepting queries.
6. IF the Database becomes unavailable, THEN THE API_Gateway SHALL return HTTP 503 with `{ "ready": false, "error": "INTERNAL_ERROR" }` from the `/api/readiness` endpoint and SHALL NOT process item update requests.

---

### Requirement 13: Data Integrity and Validation

**User Story:** As a system administrator, I want all data entering the system to be validated and sanitized, so that the database remains consistent and free of corrupt or malicious records.

#### Acceptance Criteria

1. THE Item_Service SHALL validate that `material_type` and `supplier` fields are non-empty strings between 1 and 100 characters before persisting an item; IF either field fails this validation, THE Item_Service SHALL return a `VALIDATION_ERROR` identifying the failing field.
2. THE Item_Service SHALL validate that `intake_date` is a valid ISO 8601 date string and is not set to a future date before persisting an item; IF either check fails, THE Item_Service SHALL return a `VALIDATION_ERROR`.
3. THE Item_Service SHALL validate that `location_zone` references an existing `zone_id` in the `locations` table before persisting an item or update; IF the zone does not exist, THE Item_Service SHALL return a `VALIDATION_ERROR` with code `INVALID_ZONE`.
4. THE Item_Service SHALL validate that `target_status` in a ScanBatch request is a member of the `ItemStatus` enum before processing any transition; IF the value is not a valid enum member, THE Item_Service SHALL return a `VALIDATION_ERROR`.
5. THE Item_Service SHALL accept a maximum of 50 items per ScanBatch request and SHALL reject requests exceeding this limit with a `BATCH_TOO_LARGE` error.
6. THE Database SHALL enforce a unique constraint on `lot_id` in the items table, and THE Item_Service SHALL return an `INTERNAL_ERROR` if a duplicate `lot_id` generation is detected.
7. IF any required field in a registration or update request is missing, THEN THE Item_Service SHALL return a `VALIDATION_ERROR` response identifying the missing fields and SHALL NOT partially persist the record.

---

### Requirement 14: Location Zone Management

**User Story:** As an admin, I want warehouse zones to be defined with capacity limits and types, so that the system can enforce placement rules and warn when zones are full.

#### Acceptance Criteria

1. THE System SHALL maintain a set of Location records, each with a unique `zone_id`, `name`, `type` (one of `standard`, `cold`, `hazard`, `qc`, `production`), `capacity`, and computed `current_count`.
2. THE Item_Service SHALL compute `current_count` for each Location as the count of items in the `items` table with `location_zone` equal to that zone's `zone_id`.
3. FOR ALL Location records where `capacity` is greater than zero, THE Item_Service SHALL ensure `current_count` is less than or equal to `capacity` at all times.
4. WHERE a Location has `type` equal to `cold`, THE System SHALL require a `temperature_target` value (in degrees Celsius, within the range -30 to 10) to be defined for that Location; IF a cold zone is created or updated without a valid `temperature_target`, THE System SHALL return a `VALIDATION_ERROR`.
5. WHEN an item is assigned to a Location whose `current_count` equals `capacity` (and `capacity` is greater than zero), THE Item_Service SHALL return a `VALIDATION_ERROR` indicating the zone is at capacity and SHALL NOT update the item's `location_zone`.
6. IF a Location has `capacity` equal to zero or undefined, THEN THE Web_Dashboard SHALL skip the capacity warning indicator for that zone.

---

### Requirement 15: QR Code Generation

**User Story:** As an operator registering a new drum, I want a QR code label generated automatically, so that I can print and attach it to the drum for scanning throughout its lifecycle.

#### Acceptance Criteria

1. WHEN a new item is successfully registered, THE Item_Service SHALL generate a QR code that encodes the bare `Lot_ID` string (e.g., `LOT-2026-00001`) and return a permanent URL pointing to the QR code image.
2. THE Item_Service SHALL return the QR code URL in the registration response so the operator can immediately print the label.
3. FOR ALL registered items, THE QR code image at the returned URL SHALL be decodable by a standard QR code reader to produce the original `Lot_ID` string exactly (round-trip property).
4. WHEN a QR code URL is accessed, THE System SHALL return the QR code image as a PNG file with HTTP Content-Type `image/png`.
5. WHEN a QR code URL is accessed for a `Lot_ID` that does not exist in the Database, THE System SHALL return HTTP 404.

---

### Requirement 16: Structured API Error Responses

**User Story:** As a developer integrating with the Drums Trackers API, I want all error responses to follow a consistent structure, so that client applications can handle errors programmatically without parsing free-text messages.

#### Acceptance Criteria

1. THE API_Gateway SHALL return all error responses in the format `{ "success": false, "error": { "code": "<MACHINE_CODE>", "message": "<human-readable>", "details": {} }, "meta": { "timestamp": "<ISO8601>", "request_id": "<uuid>" } }`, where `details` is populated with field-level error information for `VALIDATION_ERROR` and `INVALID_INPUT` codes and is an empty object for all other error codes.
2. THE API_Gateway SHALL return all success responses in the format `{ "success": true, "data": { ... }, "meta": { "timestamp": "<ISO8601>", "request_id": "<uuid>" } }`.
3. THE API_Gateway SHALL use the following error codes with their corresponding HTTP status codes consistently: `INVALID_INPUT` (400), `VALIDATION_ERROR` (422), `UNAUTHORIZED` (401), `AUTH_FAILED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INVALID_TRANSITION` (422), `BATCH_TOO_LARGE` (413), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500).
4. WHEN a paginated endpoint is called, THE API_Gateway SHALL include a `pagination` object in the response containing `page` (default: 1), `limit` (default: 50), `total`, and `pages` fields.
5. THE API_Gateway SHALL include a unique UUID v4 `request_id` in every response to enable log correlation between client errors and server logs.
