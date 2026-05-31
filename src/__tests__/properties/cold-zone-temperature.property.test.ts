/**
 * Property-Based Tests for Cold Zone Temperature Validation (Property 13)
 *
 * **Validates: Requirements 14.4**
 *
 * Property 13: Cold Zone Temperature Validation
 * For any cold zone input where `temperature_target` is null, below −30, or
 * above 10, `validateLocationInput` SHALL return `valid: false` with a
 * `temperature_target` error detail. For any `temperature_target` in the valid
 * range [−30, 10], validation SHALL pass.
 */

import { validateLocationInput } from "@/lib/validation";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("Property 13: Cold Zone Temperature Validation", () => {
  // ─── Property 13a: Invalid temperature_target always fails ──────────────────

  it("invalid cold zone inputs always return VALIDATION_ERROR with temperature_target detail", () => {
    fc.assert(
      fc.property(
        fc.record({
          type: fc.constant("cold"),
          temperature_target: fc.oneof(
            fc.constant(null),
            fc.float({ min: -100, max: -31 }),
            fc.float({ min: 11, max: 100 }),
          ),
          name: fc.constant("Cold Zone"),
          capacity: fc.constant(50),
        }),
        (input) => {
          const result = validateLocationInput(input);

          // Must be invalid
          expect(result.valid).toBe(false);

          // Must have temperature_target in details
          expect(result.details).toBeDefined();
          expect(result.details!.temperature_target).toBeDefined();
        },
      ),
      { numRuns: 20 },
    );
  });

  // ─── Property 13b: Valid temperature_target in range [-30, 10] passes ────────

  it("cold zone with temperature_target in [-30, 10] passes validation", () => {
    fc.assert(
      fc.property(fc.float({ min: -30, max: 10 }), (temperature_target) => {
        // Skip NaN values that fc.float can occasionally produce
        if (!isFinite(temperature_target)) return;

        const result = validateLocationInput({
          type: "cold",
          temperature_target,
          name: "Cold Zone",
          capacity: 50,
        });

        // Must be valid — no temperature_target error
        expect(result.valid).toBe(true);
        expect(result.details?.temperature_target).toBeUndefined();
      }),
      { numRuns: 20 },
    );
  });
});
