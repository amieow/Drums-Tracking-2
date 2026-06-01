/**
 * Role-Based Access Control (RBAC) helper
 *
 * Defines the permissions map for all roles and actions in the system,
 * covering Requirements 2.1–2.4.
 *
 * Also provides `writeForbiddenAttempt` to record FORBIDDEN_ATTEMPT audit
 * entries as required by Requirement 2.5.
 */

import type { ItemStatus, UserRole } from "@/types";

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

// ─── Status-to-Role Mapping ────────────────────────────────────────────────────

/**
 * Groups the `ItemStatus` transition targets a scan can produce by the
 * permission that gates them. This projects the implicit status-to-role
 * relationship in `PERMISSIONS` into an explicit, reusable mapping so the scan
 * UI and the bulk-scan API stay in sync (single source of truth).
 *
 * - QC statuses (`items:qc_pass` / `items:qc_fail`) → `qc_pass`, `qc_fail`.
 * - Operator statuses (`items:update_status`) → `qc_pending`, `in_production`,
 *   `finished`, `cold_storage`, `dispatched`, `archived`.
 *
 * `qc_pending` is treated as an operator status: the operator performs the
 * `received → qc_pending` hand-off via `items:update_status`.
 */
export const STATUS_GROUPS_BY_PERMISSION: {
  permission: string;
  statuses: ItemStatus[];
}[] = [
  {
    permission: ACTIONS.ITEMS_QC_PASS,
    statuses: ["qc_pass"],
  },
  {
    permission: ACTIONS.ITEMS_QC_FAIL,
    statuses: ["qc_fail"],
  },
  {
    permission: ACTIONS.ITEMS_UPDATE_STATUS,
    statuses: [
      "qc_pending",
      "in_production",
      "finished",
      "cold_storage",
      "dispatched",
      "archived",
    ],
  },
];

/**
 * Master ordered list of the 8 scan target statuses in stable display order.
 *
 * `getAllowedTargetStatuses` filters this list by role so the result always
 * follows this exact order regardless of which groups are included. For admin
 * (which holds every gating permission) this yields all 8 in order:
 * `qc_pending, qc_pass, qc_fail, in_production, finished, cold_storage,
 * dispatched, archived`.
 */
const TARGET_STATUS_DISPLAY_ORDER: ItemStatus[] = [
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
];

/** Map each target status to the permission that gates it (derived from groups). */
const STATUS_GATING_PERMISSION: Record<ItemStatus, string> = (() => {
  const map = {} as Record<ItemStatus, string>;
  for (const group of STATUS_GROUPS_BY_PERMISSION) {
    for (const status of group.statuses) {
      map[status] = group.permission;
    }
  }
  return map;
})();

/**
 * Returns the ordered list of `ItemStatus` values the given role is permitted to
 * transition items into via scan — the union of the status groups whose gating
 * permission the role holds, in stable display order.
 *
 * Derived entirely from `checkPermission` so `PERMISSIONS` remains the single
 * source of truth.
 *
 * @example
 * getAllowedTargetStatuses("operator")
 *   // ["qc_pending", "in_production", "finished", "cold_storage", "dispatched", "archived"]
 * getAllowedTargetStatuses("qc")     // ["qc_pass", "qc_fail"]
 * getAllowedTargetStatuses("admin")
 *   // ["qc_pending", "qc_pass", "qc_fail", "in_production", "finished", "cold_storage", "dispatched", "archived"]
 * getAllowedTargetStatuses("ppic")   // []
 */
export function getAllowedTargetStatuses(role: UserRole): ItemStatus[] {
  return TARGET_STATUS_DISPLAY_ORDER.filter((status) =>
    checkPermission(role, STATUS_GATING_PERMISSION[status]),
  );
}

/**
 * Returns `true` if the given role is permitted to transition items into the
 * given target status via scan. Used by the bulk-scan API to validate each
 * submitted `target_status` against the caller's role (server-side guard).
 *
 * @example
 * isTargetStatusAllowed("operator", "in_production") // true
 * isTargetStatusAllowed("operator", "qc_pass")       // false
 * isTargetStatusAllowed("qc", "qc_pass")             // true
 */
export function isTargetStatusAllowed(
  role: UserRole,
  status: ItemStatus,
): boolean {
  return getAllowedTargetStatuses(role).includes(status);
}
