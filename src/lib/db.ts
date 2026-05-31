/**
 * Database Client — Singleton
 *
 * Provides a server-side PostgreSQL client using the `postgres` package.
 * Connects via the DATABASE_URL connection string.
 *
 * SERVER-SIDE ONLY. Never import in client components.
 *
 * Environment variables required:
 *   - DATABASE_URL — PostgreSQL connection string
 */

import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns the cached singleton postgres client, creating it on first call.
 *
 * @throws An error if DATABASE_URL is missing.
 */
export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "Missing environment variable: DATABASE_URL is required.",
      );
    }
    _sql = postgres(connectionString, {
      ssl: { rejectUnauthorized: false },
      max: 10,
      idle_timeout: 20,
    });
  }
  return _sql;
}
