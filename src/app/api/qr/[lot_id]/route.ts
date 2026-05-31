/**
 * GET /api/qr/[lot_id]
 *
 * Generates and returns a QR code PNG image encoding the bare `lot_id` string
 * (e.g., "LOT-2026-00001"). The QR code is generated on-the-fly using the
 * `qrcode` npm package — no image storage is required.
 *
 * Responses:
 *   200  image/png  — QR code PNG buffer for the given lot_id
 *   404  JSON       — lot_id not found in the items table
 *
 * This endpoint is intentionally unauthenticated so that printed QR labels
 * can be scanned and resolved without requiring a login token.
 *
 * Validates: Requirements 15.1–15.5
 */

import { getSupabaseClient } from "@/lib/supabase";
import QRCode from "qrcode";

interface RouteParams {
  params: Promise<{ lot_id: string }>;
}

export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { lot_id } = await params;

  // Verify the lot_id exists in the items table (Requirement 15.5)
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("items")
    .select("lot_id")
    .eq("lot_id", lot_id)
    .maybeSingle();

  if (error) {
    return Response.json(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to query database.",
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: crypto.randomUUID(),
        },
      },
      { status: 500 },
    );
  }

  if (!data) {
    return Response.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Lot ID "${lot_id}" not found.`,
        },
        meta: {
          timestamp: new Date().toISOString(),
          request_id: crypto.randomUUID(),
        },
      },
      { status: 404 },
    );
  }

  // Generate QR code PNG buffer encoding the bare lot_id string (Requirement 15.1, 15.3)
  const buffer = await QRCode.toBuffer(lot_id, { type: "png" });

  // Return PNG with correct Content-Type (Requirement 15.4)
  // Convert Node.js Buffer to Uint8Array for compatibility with the Web Response API
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
    },
  });
}
