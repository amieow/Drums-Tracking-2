/**
 * Next.js Middleware — JWT Authentication
 *
 * Intercepts all /api/* routes and enforces JWT authentication.
 * Excluded routes (no auth required): /api/auth/login, /api/health, /api/readiness
 *
 * On success: injects x-user-id, x-user-role, x-user-email headers and forwards the request.
 * On failure: returns 401 UNAUTHORIZED JSON response.
 *
 * Validates: Requirements 1.4, 1.5, 16.1–16.3
 */

import { errorResponse } from "@/lib/api-response";
import { extractBearerToken, verifyJwt } from "@/lib/jwt";
import { NextRequest, NextResponse } from "next/server";

/** Routes that do not require authentication. */
const PUBLIC_ROUTES = ["/api/auth/login", "/api/health", "/api/readiness"];

/** Route prefixes that do not require authentication. */
const PUBLIC_PREFIXES = ["/api/qr/"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Allow public routes through without authentication
  if (PUBLIC_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  // Allow public route prefixes (e.g. /api/qr/*)
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get("authorization");
  const token = extractBearerToken(authHeader);

  if (!token) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required"),
      { status: 401 },
    );
  }

  // Verify the token
  const payload = await verifyJwt(token);

  if (!payload) {
    return NextResponse.json(
      errorResponse("UNAUTHORIZED", "Authentication required"),
      { status: 401 },
    );
  }

  // Clone the request headers and inject user context
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", payload.sub);
  requestHeaders.set("x-user-role", payload.role);
  requestHeaders.set("x-user-email", payload.email);

  // Forward the request with the injected headers
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};
