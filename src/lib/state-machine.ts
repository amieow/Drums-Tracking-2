/**
 * State Machine — Item lifecycle transition validator
 *
 * Provides the authoritative transition table and a validator function
 * used by the Item Service to enforce valid status progressions.
 */

import { ItemStatus, VALID_TRANSITIONS } from "../types";

export { VALID_TRANSITIONS };

export interface TransitionResult {
  valid: boolean;
  allowed: ItemStatus[];
}

/**
 * Validates whether transitioning an item from `current` to `target` is
 * permitted by the state machine.
 *
 * @param current - The item's current status.
 * @param target  - The requested target status.
 * @returns `{ valid, allowed }` where `allowed` is always the list of valid
 *          transitions from `current`, regardless of whether `target` is valid.
 *
 * @example
 * validateTransition("received", "qc_pending")
 * // → { valid: true,  allowed: ["qc_pending"] }
 *
 * validateTransition("received", "archived")
 * // → { valid: false, allowed: ["qc_pending"] }
 *
 * validateTransition("archived", "received")
 * // → { valid: false, allowed: [] }
 */
export function validateTransition(
  current: ItemStatus,
  target: ItemStatus,
): TransitionResult {
  const allowed: ItemStatus[] = VALID_TRANSITIONS[current] ?? [];
  const valid = allowed.includes(target);
  return { valid, allowed };
}
