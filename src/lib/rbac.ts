/**
 * Role-Based Access Control (RBAC) helper
 *
 * Defines the permissions map for all roles and actions in the system,
 * covering Requirements 2.1–2.4.
 *
 * Also provides `writeForbiddenAttempt` to record FORBIDDEN_ATTEMPT audit
 * entries as required by Requirement 2.5.
 */

import { getDb } from "@/lib/db";
import type { UserRole } from "@/types";

// ─── Action Constants ─────────────────────────────────────────────────────────

export const ACTIONS = {
  // Item actions
  ITEMS_REGISTER: "items:register",
  ITEMS_READ: "items:read",
  ITEMS_UPDATE_STATUS: "items:update_status",
  ITEMS_UPDATE_LOCATION: "items:update_location",
  ITEMS_QC_PASS: "items:qc_pass",
  ITEMS_QC_FAIL: "items:qc_fail",
  ITEMS_BULK_SCAN: "items:bulk_scan",

  // User management
  USERS_MANAGE: "users:manage",

  // Audit log
  AUDIT_READ: "audit:read",
  AUDIT_EXPORT: "audit:export",

  // Location management
  LOCATIONS_READ: "locations:read",
  LOCATIONS_MANAGE: "locations:manage",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

// ─── Permissions Map ──────────────────────────────────────────────────────────

/**
 * Maps each role to the set of actions it is permitted to perform.
 *
 * Requirement 2.1 — operator:
 *   ALLOW: register items, update item status/location via scan, read items
 *   DENY:  qc_pass/qc_fail transitions, user management, audit log export
 *
 * Requirement 2.2 — qc:
 *   ALLOW: qc_pass and qc_fail status transitions, read items
 *   DENY:  user management, audit log export
 *
 * Requirement 2.3 — ppic:
 *   ALLOW: read all items and production schedules (locations:read)
 *   DENY:  any write operations on items, user management, audit log export
 *
 * Requirement 2.4 — admin:
 *   ALLOW: everything — item registration, item status updates,
 *          user management (create/update/deactivate), audit log export
 */
export const PERMISSIONS: Record<UserRole, Set<string>> = {
  operator: new Set<string>([
    ACTIONS.ITEMS_REGISTER,
    ACTIONS.ITEMS_READ,
    ACTIONS.ITEMS_UPDATE_STATUS,
    ACTIONS.ITEMS_UPDATE_LOCATION,
    ACTIONS.ITEMS_BULK_SCAN,
    ACTIONS.LOCATIONS_READ,
  ]),

  qc: new Set<string>([
    ACTIONS.ITEMS_READ,
    ACTIONS.ITEMS_QC_PASS,
    ACTIONS.ITEMS_QC_FAIL,
    ACTIONS.ITEMS_BULK_SCAN,
    ACTIONS.LOCATIONS_READ,
  ]),

  ppic: new Set<string>([ACTIONS.ITEMS_READ, ACTIONS.LOCATIONS_READ]),

  admin: new Set<string>([
    ACTIONS.ITEMS_REGISTER,
    ACTIONS.ITEMS_READ,
    ACTIONS.ITEMS_UPDATE_STATUS,
    ACTIONS.ITEMS_UPDATE_LOCATION,
    ACTIONS.ITEMS_QC_PASS,
    ACTIONS.ITEMS_QC_FAIL,
    ACTIONS.ITEMS_BULK_SCAN,
    ACTIONS.USERS_MANAGE,
    ACTIONS.AUDIT_READ,
    ACTIONS.AUDIT_EXPORT,
    ACTIONS.LOCATIONS_READ,
    ACTIONS.LOCATIONS_MANAGE,
  ]),
};

// ─── Permission Check ─────────────────────────────────────────────────────────

/**
 * Returns `true` if the given role is permitted to perform the given action,
 * `false` otherwise.
 *
 * @param role   - The user's role (from the JWT `role` claim).
 * @param action - The action string to check (use `ACTIONS.*` constants).
 *
 * @example
 * checkPermission("operator", "items:register")  // true
 * checkPermission("operator", "items:qc_pass")   // false
 * checkPermission("admin",    "audit:export")     // true
 * checkPermission("ppic",     "items:register")   // false
 */
export function checkPermission(role: UserRole, action: string): boolean {
  const allowed = PERMISSIONS[role];
  if (!allowed) return false;
  return allowed.has(action);
}

// ─── Forbidden Attempt Audit ──────────────────────────────────────────────────

/**
 * Writes a `forbidden_attempt` AuditEntry to the audit_logs table.
 *
 * Called whenever a user attempts an action that exceeds their role's
 * permissions. Records `user_id`, `action`, and `timestamp` as required
 * by Requirement 2.5.
 *
 * Failures are logged but never thrown — the FORBIDDEN response is always
 * returned to the caller regardless of whether the audit write succeeds.
 *
 * @param params.userId    - The authenticated user's UUID.
 * @param params.userEmail - The authenticated user's email.
 * @param params.action    - The action that was denied.
 * @param params.ip        - The client IP address.
 *
 * Validates: Requirement 2.5
 */
export async function writeForbiddenAttempt(params: {
  userId: string;
  userEmail: string;
  action: string;
  ip: string;
}): Promise<void> {
  const { userId, userEmail, action, ip } = params;

  try {
    const sql = getDb();
    await sql`
      INSERT INTO audit_logs (item_id, action, previous_state, new_state, user_id, user_email, ip_address, timestamp)
      VALUES (NULL, 'forbidden_attempt', NULL, ${JSON.stringify({ action })}, ${userId}::uuid, ${userEmail}, ${ip}, ${new Date().toISOString()})
    `;
  } catch (err) {
    console.error(`[rbac] Unexpected error writing forbidden_attempt:`, err);
  }
}
