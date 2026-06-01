/**
 * Audit-logging helpers that require database access.
 *
 * SERVER-SIDE ONLY. This module imports `postgres` and must never be
 * imported by client code.
 */

import { getDb } from "@/lib/db";

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
    console.error(`[audit] Unexpected error writing forbidden_attempt:`, err);
  }
}
