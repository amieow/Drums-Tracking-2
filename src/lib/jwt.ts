/**
 * JWT Utilities — Token extraction and verification
 *
 * Signs and verifies JWTs using the `jose` library with a shared secret
 * (JWT_SECRET environment variable). No external auth service required.
 */

import type { JWTPayload, UserRole } from "@/types";
import { SignJWT, jwtVerify } from "jose";

/** Valid roles accepted by the system. */
const VALID_ROLES: UserRole[] = ["operator", "qc", "ppic", "admin"];

/** Token expiry — 8 hours. */
const TOKEN_EXPIRY = "8h";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing environment variable: JWT_SECRET is required.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs a new JWT for the given user.
 *
 * @param payload - The user payload to embed in the token.
 * @returns A signed JWT string.
 */
export async function signJwt(payload: {
  sub: string;
  email: string;
  role: UserRole;
}): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secret);
}

/**
 * Extracts the token string from an `Authorization: Bearer <token>` header.
 *
 * @param authHeader - The raw value of the Authorization header, or null.
 * @returns The token string, or null if the header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length);
}

/**
 * Verifies a JWT token and returns the decoded payload.
 *
 * @param token - The raw JWT string to verify.
 * @returns The decoded `JWTPayload` on success, or `null` if invalid/expired.
 */
export async function verifyJwt(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);

    const role = payload.role as unknown;
    if (!role || !VALID_ROLES.includes(role as UserRole)) {
      return null;
    }

    return {
      sub: payload.sub ?? "",
      email: (payload.email as string) ?? "",
      role: role as UserRole,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}
