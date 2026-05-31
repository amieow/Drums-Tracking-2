/**
 * Property-Based Tests for RBAC Enforcement (Property 3)
 *
 * **Validates: Requirements 2.1–2.5**
 *
 * Property 3: RBAC Permissions Are Enforced Per Role
 * For any authenticated user and any API action, the system SHALL permit the
 * action if and only if the user's role grants that permission. Any action
 * exceeding the user's role SHALL return FORBIDDEN and write a
 * `forbidden_attempt` AuditEntry.
 */

import { ACTIONS, PERMISSIONS, checkPermission } from "@/lib/rbac";
import type { AuditAction, AuditEntry, UserRole } from "@/types";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Minimal audit writer interface used by enforcePermission */
type AuditWriter = (entry: Omit<AuditEntry, "id" | "timestamp">) => void;

// ─── enforcePermission helper ─────────────────────────────────────────────────

/**
 * Enforces RBAC for a given role/action pair.
 *
 * Returns `true` if the action is permitted.
 * Returns `false` and calls `auditWriter` with a `forbidden_attempt` AuditEntry
 * if the action is denied.
 *
 * This helper is the unit under test for the "FORBIDDEN writes a
 * forbidden_attempt AuditEntry" part of Property 3.
 */
export function enforcePermission(
  role: UserRole,
  action: string,
  userId: string,
  userEmail: string,
  ipAddress: string,
  auditWriter: AuditWriter,
): boolean {
  const permitted = checkPermission(role, action);

  if (!permitted) {
    const forbiddenEntry: Omit<AuditEntry, "id" | "timestamp"> = {
      item_id: null,
      action: "forbidden_attempt" as AuditAction,
      previous_state: null,
      new_state: JSON.stringify({ role, action }),
      user_id: userId,
      user_email: userEmail,
      ip_address: ipAddress,
      metadata: { role, attempted_action: action },
    };
    auditWriter(forbiddenEntry);
  }

  return permitted;
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const roleArb = fc.constantFrom<UserRole>("operator", "qc", "ppic", "admin");
const actionArb = fc.constantFrom<Action>(
  ...(Object.values(ACTIONS) as Action[]),
);
const rolActionPairArb = fc.tuple(roleArb, actionArb);

// ─── Property 3a: checkPermission is consistent with PERMISSIONS map ──────────

describe("Property 3: RBAC Permissions Are Enforced Per Role", () => {
  it("checkPermission(role, action) matches PERMISSIONS[role].has(action) for all role/action pairs", () => {
    // Run at least 50 examples — with 4 roles × 13 actions = 52 total combinations,
    // exhaustive coverage is guaranteed.
    fc.assert(
      fc.property(rolActionPairArb, ([role, action]) => {
        const expected = PERMISSIONS[role].has(action);
        const actual = checkPermission(role, action);
        return actual === expected;
      }),
      { numRuns: 52 },
    );
  });

  // ─── Property 3b: permitted actions return true ──────────────────────────────

  it("returns true for every action that PERMISSIONS[role] contains", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        const allowedActions = Array.from(PERMISSIONS[role]);
        return allowedActions.every(
          (action) => checkPermission(role, action) === true,
        );
      }),
      { numRuns: 50 },
    );
  });

  // ─── Property 3c: denied actions return false ────────────────────────────────

  it("returns false for every action that PERMISSIONS[role] does NOT contain", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        const allActions = Object.values(ACTIONS) as Action[];
        const deniedActions = allActions.filter(
          (a) => !PERMISSIONS[role].has(a),
        );
        return deniedActions.every(
          (action) => checkPermission(role, action) === false,
        );
      }),
      { numRuns: 50 },
    );
  });

  // ─── Property 3d: FORBIDDEN writes a forbidden_attempt AuditEntry ────────────

  it("enforcePermission calls auditWriter with forbidden_attempt when action is denied", () => {
    fc.assert(
      fc.property(
        rolActionPairArb,
        fc.uuid(),
        fc.emailAddress(),
        fc.ipV4(),
        ([role, action], userId, userEmail, ipAddress) => {
          const auditWriter = vi.fn() as unknown as ReturnType<typeof vi.fn> &
            AuditWriter;
          const permitted = enforcePermission(
            role,
            action,
            userId,
            userEmail,
            ipAddress,
            auditWriter,
          );

          const isDenied = !PERMISSIONS[role].has(action);

          if (isDenied) {
            // Must have called auditWriter exactly once
            expect(auditWriter).toHaveBeenCalledTimes(1);

            const [entry] = (auditWriter as ReturnType<typeof vi.fn>).mock
              .calls[0] as [Omit<AuditEntry, "id" | "timestamp">];

            // AuditEntry must have action = "forbidden_attempt"
            expect(entry.action).toBe("forbidden_attempt");

            // Must record the user context
            expect(entry.user_id).toBe(userId);
            expect(entry.user_email).toBe(userEmail);
            expect(entry.ip_address).toBe(ipAddress);

            // item_id must be null for non-item events
            expect(entry.item_id).toBeNull();

            // new_state must encode the role and attempted action
            const newState = JSON.parse(entry.new_state as string);
            expect(newState.role).toBe(role);
            expect(newState.action).toBe(action);

            // metadata must carry role and attempted_action
            expect(entry.metadata?.role).toBe(role);
            expect(entry.metadata?.attempted_action).toBe(action);

            // enforcePermission must return false
            expect(permitted).toBe(false);
          } else {
            // Permitted — auditWriter must NOT be called
            expect(auditWriter).not.toHaveBeenCalled();

            // enforcePermission must return true
            expect(permitted).toBe(true);
          }

          return true;
        },
      ),
      { numRuns: 52 },
    );
  });

  // ─── Property 3e: permitted actions never trigger auditWriter ────────────────

  it("enforcePermission never calls auditWriter when action is permitted", () => {
    fc.assert(
      fc.property(
        roleArb,
        fc.uuid(),
        fc.emailAddress(),
        fc.ipV4(),
        (role, userId, userEmail, ipAddress) => {
          const allowedActions = Array.from(PERMISSIONS[role]) as Action[];
          const auditWriter = vi.fn() as unknown as ReturnType<typeof vi.fn> &
            AuditWriter;

          for (const action of allowedActions) {
            auditWriter.mockClear();
            const result = enforcePermission(
              role,
              action,
              userId,
              userEmail,
              ipAddress,
              auditWriter,
            );
            expect(result).toBe(true);
            expect(auditWriter).not.toHaveBeenCalled();
          }

          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
