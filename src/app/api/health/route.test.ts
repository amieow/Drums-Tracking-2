/**
 * Unit tests for GET /api/health
 *
 * Validates: Requirements 12.4
 */

import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health (Req 12.4)", () => {
  it("always returns 200 with { status: 'ok' }", async () => {
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("returns status 'ok' on repeated calls", async () => {
    for (let i = 0; i < 3; i++) {
      const response = GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
    }
  });

  it("response has the correct content-type header", async () => {
    const response = GET();

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
