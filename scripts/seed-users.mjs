/**
 * Seed script — creates one user per role for local development/testing.
 *
 * Usage:
 *   node scripts/seed-users.mjs
 *
 * Reads credentials from .env.local automatically.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local manually (no dotenv dependency needed) ───────────────────
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
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

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`\nConnecting to: ${SUPABASE_URL}\n`);

for (const user of USERS) {
  process.stdout.write(`Creating ${user.role.padEnd(8)} — ${user.email} ... `);
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    user_metadata: { role: user.role },
    email_confirm: true,
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      console.log("already exists, skipping.");
    } else {
      console.log(`FAILED: ${error.message}`);
    }
  } else {
    console.log(`created (id: ${data.user.id})`);
  }
}

console.log("\nDone. Login credentials:\n");
console.table(
  USERS.map(({ email, password, role }) => ({ role, email, password })),
);
