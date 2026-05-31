/**
 * API Response Envelope Helpers
 *
 * Produces the standard ApiSuccess<T> and ApiError envelopes with
 * auto-generated meta.timestamp (ISO 8601) and meta.request_id (UUID v4).
 *
 * Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
 */

import type {
  ApiError,
  ApiSuccess,
  ErrorCode,
  PaginationMeta,
} from "../types/index";
import { ERROR_HTTP_STATUS } from "../types/index";

/**
 * Build a standard success envelope.
 *
 * @param data       The response payload.
 * @param pagination Optional pagination metadata for list endpoints (Req 16.4).
 */
export function successResponse<T>(
  data: T,
  pagination?: PaginationMeta,
): ApiSuccess<T> {
  const envelope: ApiSuccess<T> = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    },
  };

  if (pagination !== undefined) {
    envelope.pagination = pagination;
  }

  return envelope;
}

/**
 * Build a standard error envelope.
 *
 * @param code    Machine-readable error code (Req 16.3).
 * @param message Human-readable description.
 * @param details Optional field-level details, populated for VALIDATION_ERROR
 *                and INVALID_INPUT; omitted for all other codes (Req 16.1).
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, string>,
): ApiError {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
      request_id: crypto.randomUUID(),
    },
  };
}

/**
 * Map an ErrorCode to its canonical HTTP status code (Req 16.3).
 *
 * @param code An ErrorCode value.
 * @returns    The corresponding HTTP status number.
 */
export function getHttpStatus(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
