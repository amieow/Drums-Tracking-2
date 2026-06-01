/**
 * Seed script — creates one user per role for local development/testing.
 *
 * Usage:
 *   node scripts/seed-users.mjs
 *
 * Reads DATABASE_URL from .env.local automatically.
 */

import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import postgres from "postgres";
import { fileURLToPath } from "url";

// ── Load .env.local manually ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

let envContent = "";
try {
  envContent = readFileSync(envPath, "utf-8");
} catch {
  console.error("Could not read .env.local — make sure it exists.");
  process.exit(1);
}

function parseEnv(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

const env = parseEnv(envContent);
const DATABASE_URL = env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env.local");
  process.exit(1);
}

// ── Seed users ────────────────────────────────────────────────────────────────

const USERS = [
  { email: "admin@drums.local", password: "Admin1234!", role: "admin" },
  {
    email: "operator@drums.local",
    password: "Operator1234!",
    role: "operator",
  },
  { email: "qc@drums.local", password: "Qc1234!", role: "qc" },
  { email: "ppic@drums.local", password: "Ppic1234!", role: "ppic" },
];

const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false } });

console.log(`\nConnecting to database...\n`);

for (const user of USERS) {
  process.stdout.write(`Creating ${user.role.padEnd(8)} — ${user.email} ... `);
  try {
    const passwordHash = await bcrypt.hash(user.password, 12);
    await sql`
      INSERT INTO users (email, password_hash, role)
      VALUES (${user.email}, ${passwordHash}, ${user.role})
      ON CONFLICT (email) DO NOTHING
    `;
    // Check if it was actually inserted or skipped
    const rows = await sql`SELECT id FROM users WHERE email = ${user.email}`;
    if (rows.length > 0) {
      console.log(`done (id: ${rows[0].id})`);
    } else {
      console.log("already exists, skipping.");
    }
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

await sql.end();

console.log("\nDone. Login credentials:\n");
console.table(
  USERS.map(({ email, password, role }) => ({ role, email, password })),
);
