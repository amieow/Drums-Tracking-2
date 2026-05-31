/**
 * JWT Utilities — Token extraction and verification
 *
 * Provides helpers for extracting Bearer tokens from Authorization headers
 * and verifying JWTs via Supabase Auth.
 */

import type { JWTPayload, UserRole } from "@/types";
import { createClient } from "@supabase/supabase-js";

/** Valid roles accepted by the system. */
const VALID_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

/**
 * Extracts the token string from an `Authorization: Bearer <token>` header.
 *
 * @param authHeader - The raw value of the Authorization header, or null.
 * @returns The token string, or null if the header is missing or malformed.
 *
 * @example
 * extractBearerToken("Bearer eyJ...")  // → "eyJ..."
 * extractBearerToken(null)             // → null
 * extractBearerToken("Basic abc")      // → null
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length);
}

/**
 * Verifies a JWT token using Supabase Auth and returns the decoded payload.
 *
 * Uses `supabase.auth.getUser(token)` to validate the token server-side.
 * Extracts the `role` claim from `user_metadata.role` or `app_metadata.role`.
 *
 * @param token - The raw JWT string to verify.
 * @returns The decoded `JWTPayload` on success, or `null` if the token is
 *          invalid, expired, malformed, or missing/invalid role claim.
 */
export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "verifyJwt: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return null;
  }

  const user = data.user;

  // Extract role from user_metadata first, then fall back to app_metadata
  const role: unknown =
    user.user_metadata?.role ?? user.app_metadata?.role ?? null;

  if (!role || !VALID_ROLES.includes(role as UserRole)) {
    return null;
  }

  // Decode the JWT payload to extract iat/exp claims
  // The token is a standard JWT: header.payload.signature (base64url encoded)
  let iat: number;
  let exp: number;

  try {
    const payloadBase64 = token.split(".")[1];
    if (!payloadBase64) return null;

    // base64url → base64 → JSON
    const padded = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(padded, "base64").toString("utf-8");
    const decoded = JSON.parse(jsonStr) as Record<string, unknown>;

    iat = typeof decoded.iat === "number" ? decoded.iat : 0;
    exp = typeof decoded.exp === "number" ? decoded.exp : 0;
  } catch {
    return null;
  }

  const payload: JWTPayload = {
    sub: user.id,
    email: user.email ?? "",
    role: role as UserRole,
    iat,
    exp,
  };

  return payload;
}
