/**
 * Lot ID Generator
 *
 * Generates collision-safe, sequential Lot IDs in the format `LOT-YYYY-NNNNN`
 * using a database-level `SELECT increment_lot_sequence($1)` call that wraps
 * the entire sequence increment in a single atomic transaction with row-level
 * locking.
 *
 * Algorithm:
 * 1. Extract `year` from `intake_date` (YYYY).
 * 2. Call the `increment_lot_sequence` Postgres function with the year.
 * 3. Zero-pad the returned sequence to 5 digits.
 * 4. Return `LOT-{year}-{paddedSequence}`.
 */

import type { Sql } from "postgres";

/** Maximum allowed sequence value per year. */
const MAX_SEQUENCE = 99999;

/**
 * Generates the next unique Lot ID for the given intake date.
 *
 * @param intakeDate - ISO 8601 date string (YYYY-MM-DD) for the intake.
 * @param sql        - A postgres-compatible client with tagged template support.
 * @returns A promise that resolves to a Lot ID string, e.g. `LOT-2026-00001`.
 * @throws  An error with a message containing `"INTERNAL_ERROR"` on overflow or DB failure.
 */
export async function generateLotId(
  intakeDate: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: Sql | any,
): Promise<string> {
  const year = parseInt(intakeDate.substring(0, 4), 10);

  if (isNaN(year) || year < 2000 || year > 2099) {
    throw new Error(
      `INTERNAL_ERROR: Invalid intake_date year "${intakeDate.substring(0, 4)}". Expected a year in the range 2000–2099.`,
    );
  }

  let sequence: number;
  try {
    const rows = await sql<{ increment_lot_sequence: number }[]>`
      SELECT increment_lot_sequence(${year})
    `;
    sequence = rows[0].increment_lot_sequence;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("SEQUENCE_OVERFLOW")) {
      throw new Error(
        `INTERNAL_ERROR: Lot ID sequence for year ${year} has reached the maximum value of ${MAX_SEQUENCE}. No more Lot IDs can be generated for this year.`,
      );
    }
    throw new Error(
      `INTERNAL_ERROR: Failed to generate Lot ID for year ${year}: ${message}`,
    );
  }

  if (sequence > MAX_SEQUENCE) {
    throw new Error(
      `INTERNAL_ERROR: Lot ID sequence for year ${year} has reached the maximum value of ${MAX_SEQUENCE}. No more Lot IDs can be generated for this year.`,
    );
  }

  const paddedSequence = sequence.toString().padStart(5, "0");
  return `LOT-${year}-${paddedSequence}`;
}
