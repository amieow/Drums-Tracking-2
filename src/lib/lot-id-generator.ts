/**
 * Lot ID Generator
 *
 * Generates collision-safe, sequential Lot IDs in the format `LOT-YYYY-NNNNN`
 * using a database-level `SELECT ... FOR UPDATE` lock on the `lot_id_sequences`
 * table to guarantee uniqueness under concurrent requests.
 *
 * Algorithm:
 * 1. Extract `year` from `intake_date` (YYYY).
 * 2. Acquire a row-level lock via `SELECT ... FOR UPDATE` on `lot_id_sequences`
 *    keyed by year.
 * 3. Read `last_sequence` for the year; increment by 1.
 * 4. If the new sequence would exceed 99999, throw an INTERNAL_ERROR.
 * 5. Zero-pad to 5 digits: `LOT-{year}-{sequence.toString().padStart(5, '0')}`.
 * 6. Write the new sequence value atomically.
 * 7. On year rollover (new year detected), insert a new row with `sequence = 1`.
 */

/** Maximum allowed sequence value per year. */
const MAX_SEQUENCE = 99999;

/**
 * Generates the next unique Lot ID for the given intake date.
 *
 * The function uses a PostgreSQL `SELECT ... FOR UPDATE` lock on the
 * `lot_id_sequences` table row for the given year, ensuring that concurrent
 * calls never produce duplicate IDs.
 *
 * @param intakeDate    - ISO 8601 date string (YYYY-MM-DD) for the intake.
 * @param supabaseClient - An authenticated Supabase client instance with
 *                         access to the `lot_id_sequences` table.
 * @returns A promise that resolves to a Lot ID string, e.g. `LOT-2026-00001`.
 * @throws  An error with a message containing `"INTERNAL_ERROR"` when the
 *          annual sequence counter has reached 99999 (overflow guard).
 *
 * @example
 * const lotId = await generateLotId("2026-06-15", supabase);
 * // → "LOT-2026-00001"
 */
export async function generateLotId(
  intakeDate: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: any,
): Promise<string> {
  // Step 1: Extract the four-digit year from the intake date.
  const year = parseInt(intakeDate.substring(0, 4), 10);

  if (isNaN(year) || year < 2000 || year > 2099) {
    throw new Error(
      `INTERNAL_ERROR: Invalid intake_date year "${intakeDate.substring(0, 4)}". Expected a year in the range 2000–2099.`,
    );
  }

  // Steps 2–7 are executed inside a PostgreSQL function (RPC) that wraps the
  // entire sequence increment in a single atomic transaction with row-level
  // locking.  This avoids the need to manage explicit transactions from the
  // client side, which is not supported by the Supabase JS client.
  //
  // The `increment_lot_sequence` function must exist in the database:
  //
  //   CREATE OR REPLACE FUNCTION increment_lot_sequence(p_year INTEGER)
  //   RETURNS INTEGER
  //   LANGUAGE plpgsql
  //   AS $$
  //   DECLARE
  //     v_sequence INTEGER;
  //   BEGIN
  //     -- Acquire a row-level lock for the given year (inserts if missing).
  //     INSERT INTO lot_id_sequences (year, last_sequence, updated_at)
  //     VALUES (p_year, 0, NOW())
  //     ON CONFLICT (year) DO NOTHING;
  //
  //     SELECT last_sequence INTO v_sequence
  //     FROM lot_id_sequences
  //     WHERE year = p_year
  //     FOR UPDATE;
  //
  //     v_sequence := v_sequence + 1;
  //
  //     IF v_sequence > 99999 THEN
  //       RAISE EXCEPTION 'SEQUENCE_OVERFLOW';
  //     END IF;
  //
  //     UPDATE lot_id_sequences
  //     SET last_sequence = v_sequence, updated_at = NOW()
  //     WHERE year = p_year;
  //
  //     RETURN v_sequence;
  //   END;
  //   $$;

  const { data, error } = await supabaseClient.rpc("increment_lot_sequence", {
    p_year: year,
  });

  if (error) {
    // The database function raises 'SEQUENCE_OVERFLOW' when the counter
    // would exceed 99999 (Requirement 4.4).
    if (
      error.message?.includes("SEQUENCE_OVERFLOW") ||
      error.code === "P0001"
    ) {
      throw new Error(
        `INTERNAL_ERROR: Lot ID sequence for year ${year} has reached the maximum value of ${MAX_SEQUENCE}. No more Lot IDs can be generated for this year.`,
      );
    }

    throw new Error(
      `INTERNAL_ERROR: Failed to generate Lot ID for year ${year}: ${error.message}`,
    );
  }

  const sequence: number = data as number;

  // Overflow guard on the client side as a secondary safety net.
  if (sequence > MAX_SEQUENCE) {
    throw new Error(
      `INTERNAL_ERROR: Lot ID sequence for year ${year} has reached the maximum value of ${MAX_SEQUENCE}. No more Lot IDs can be generated for this year.`,
    );
  }

  // Step 5: Zero-pad the sequence to 5 digits and assemble the Lot ID.
  const paddedSequence = sequence.toString().padStart(5, "0");
  return `LOT-${year}-${paddedSequence}`;
}
