/**
 * Database Client — re-export for backwards compatibility.
 *
 * All code that previously imported `getSupabaseClient` from this module
 * now uses the `getDb` postgres client instead. This file is kept as a
 * thin re-export so any remaining imports don't break during migration.
 *
 * @deprecated Import from `@/lib/db` directly.
 */

export { getDb as getSupabaseClient } from "@/lib/db";
