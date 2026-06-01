import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import postgres from "postgres";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, "../.env.local");
const envContent = readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
}

const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false } });

const migrations = ["001_initial_schema.sql", "002_users_table.sql"];

for (const file of migrations) {
  const migrationPath = resolve(__dirname, `../supabase/migrations/${file}`);
  const migrationSql = readFileSync(migrationPath, "utf-8");
  console.log(`Running ${file} ...`);
  try {
    await sql.unsafe(migrationSql);
    console.log(`  ✓ done`);
  } catch (err) {
    console.error(`  ✗ failed: ${err.message}`);
  }
}

await sql.end();
console.log("\nAll migrations complete.");
