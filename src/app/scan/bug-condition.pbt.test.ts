/**
 * Bug Condition Exploration Test (Property 1)
 *
 * Property 1: Bug Condition — Role-Appropriate Status Filtering and Enforcement
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * GOAL: Surface counterexamples that demonstrate the bug exists across the three
 * layers (option list, nav gate, server authorization). This test encodes the
 * EXPECTED (post-fix) behavior described by Property 1, so:
 *   - On UNFIXED code it MUST FAIL (failure confirms the bug exists).
 *   - On FIXED code it will PASS (validating the fix).
 *
 * Property 1 Expected Behavior:
 *   - visibleOptions(role) == getAllowedTargetStatuses(role)
 *       operator -> qc_pending, in_production, finished, cold_storage, dispatched, archived
 *       qc       -> qc_pass, qc_fail
 *   - navAllowsScan("qc") == true
 *   - a bulk-scan with a target_status not allowed for the role is rejected with
 *     FORBIDDEN and NO transition is applied (processScanBatch not invoked).
 *
 * NOTE: `getAllowedTargetStatuses` does not exist on the unfixed code, so the
 * expected allowed-status sets are hardcoded here per the spec (bugfix.md /
 * design.md) rather than depending on a not-yet-existing helper.
 *
 * Test environment is `node` (no jsdom/testing-library), so React components are
 * rendered with `react-dom/server` (`renderToStaticMarkup`) and the API route is
 * invoked by calling its exported `POST` handler directly.
 */

import type { ItemStatus, UserRole } from "@/types";
import * as fc from "fast-check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ─── Mutable auth state (hoisted so the vi.mock factory can reference it) ──────

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: UserRole } | null,
  token: "test-token" as string | null,
}));

// ─── Mocks ─────────────────────────────────────────────────────────────────────

// Auth context: return whatever role the test sets, no AuthProvider/router needed.
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: authState.user,
    token: authState.token,
    loading: false,
    setSession: () => {},
    logout: () => {},
  }),
  useRequireAuth: () => authState.user,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// next/navigation: harmless stubs so client components render server-side.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
  usePathname: () => "/scan",
  useSearchParams: () => new URLSearchParams(),
}));

// next/link: render a plain anchor so href values appear in the static markup.
vi.mock("next/link", async () => {
  const ReactMod = await import("react");
  return {
    __esModule: true,
    default: ({
      href,
      children,
      ...rest
    }: {
      href: unknown;
      children?: React.ReactNode;
    }) =>
      ReactMod.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children,
      ),
  };
});

// QrScanner: stub it out (pulls in html5-qrcode / camera APIs unavailable in node).
vi.mock("@/components/QrScanner", async () => {
  const ReactMod = await import("react");
  return {
    __esModule: true,
    default: ReactMod.forwardRef(function MockQrScanner() {
      return null;
    }),
  };
});

// item-service: spy on processScanBatch so we can assert it is NOT invoked on the
// forbidden path, and avoid touching the real Supabase/DB layer.
vi.mock("@/services/item-service", () => ({
  processScanBatch: vi.fn(async () => ({
    processed_at: new Date().toISOString(),
    results: [{ lot_id: "LOT-2024-00001", success: true }],
  })),
}));

// audit: stub the DB-backed write so no DATABASE_URL is required on the
// FORBIDDEN path (the route imports `writeForbiddenAttempt` from `@/lib/audit`).
// `checkPermission`/`PERMISSIONS` in `@/lib/rbac` stay REAL — they are the pure
// gate under test and need no mocking.
vi.mock("@/lib/audit", () => ({
  writeForbiddenAttempt: vi.fn(async () => {}),
}));

// ─── Expected (post-fix) allowed-status sets — source of truth: bugfix.md ──────

const EXPECTED_ALLOWED: Record<UserRole, ItemStatus[]> = {
  operator: [
    "qc_pending",
    "in_production",
    "finished",
    "cold_storage",
    "dispatched",
    "archived",
  ],
  qc: ["qc_pass", "qc_fail"],
  admin: [
    "qc_pending",
    "qc_pass",
    "qc_fail",
    "in_production",
    "finished",
    "cold_storage",
    "dispatched",
    "archived",
  ],
  ppic: [],
};

const ALL_STATUSES: ReadonlySet<string> = new Set<ItemStatus>([
  "received",
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "in_production",
  "finished",
  "cold_storage",
  "dispatched",
  "archived",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Extract `<option value="...">` values from rendered markup (status values only). */
function extractOptionValues(html: string): string[] {
  const values: string[] = [];
  const re = /<option[^>]*\svalue="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (ALL_STATUSES.has(m[1])) values.push(m[1]);
  }
  return values;
}

/** Render ScanPage as `role` and return the target-status option values. */
async function renderScanPageOptionValues(role: UserRole): Promise<string[]> {
  authState.user = { id: "user-uuid-1", email: `${role}@example.com`, role };
  const mod = await import("@/app/scan/page");
  const ScanPage = mod.default;
  const html = renderToStaticMarkup(React.createElement(ScanPage));
  return extractOptionValues(html);
}

/** Render NavBar as `role` and report whether the /scan link is present. */
async function navIncludesScan(role: UserRole): Promise<boolean> {
  authState.user = { id: "user-uuid-1", email: `${role}@example.com`, role };
  const mod = await import("@/components/NavBar");
  const NavBar = mod.default;
  const html = renderToStaticMarkup(
    React.createElement(NavBar, { title: "Scan Mode" }),
  );
  return /href="\/scan"/.test(html);
}

/** Call the bulk-scan POST handler as `role` submitting `targetStatus`. */
async function callBulkScan(role: UserRole, targetStatus: ItemStatus) {
  const itemService = await import("@/services/item-service");
  const processScanBatch =
    itemService.processScanBatch as unknown as ReturnType<typeof vi.fn>;
  processScanBatch.mockClear();

  const { POST } = await import("@/app/api/items/bulk-scan/route");
  const { NextRequest } = await import("next/server");

  const req = new NextRequest("http://localhost/api/items/bulk-scan", {
    method: "POST",
    headers: {
      "x-user-id": "user-uuid-1",
      "x-user-role": role,
      "x-user-email": `${role}@example.com`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          lot_id: "LOT-2024-00001",
          target_status: targetStatus,
          timestamp: "2024-01-01T00:00:00Z",
        },
      ],
    }),
  });

  const res = await POST(req);
  let body: { success?: boolean; error?: { code?: string } } | null = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return {
    status: res.status,
    code: body?.error?.code,
    success: body?.success === true,
    processScanBatchCalled: processScanBatch.mock.calls.length > 0,
  };
}

// ─── Deterministic counterexamples (reproducible) ──────────────────────────────

describe("Property 1: Bug Condition — Role-Appropriate Status Filtering and Enforcement", () => {
  it("(a) view_options — operator dropdown EXCLUDES qc_pass / qc_fail and equals the operator allowed set", async () => {
    const values = await renderScanPageOptionValues("operator");
    expect(values).not.toContain("qc_pass");
    expect(values).not.toContain("qc_fail");
    expect(new Set(values)).toEqual(new Set(EXPECTED_ALLOWED.operator));
  });

  it("(b) page_access — qc user's NavBar visibleItems include /scan", async () => {
    const hasScan = await navIncludesScan("qc");
    expect(hasScan).toBe(true);
  });

  it("(c) submit_scan — operator submitting qc_pass is rejected FORBIDDEN with no transition applied", async () => {
    const r = await callBulkScan("operator", "qc_pass");
    expect(r.status).toBe(403);
    expect(r.code).toBe("FORBIDDEN");
    expect(r.processScanBatchCalled).toBe(false);
  });

  it("(d) qc view_options edge — qc dropdown is exactly qc_pass, qc_fail", async () => {
    const values = await renderScanPageOptionValues("qc");
    expect(new Set(values)).toEqual(new Set(EXPECTED_ALLOWED.qc));
  });

  // ─── Scoped property: for all bug-condition inputs, expected behavior holds ──

  type Interaction =
    | { kind: "view_options"; role: UserRole }
    | { kind: "page_access"; role: UserRole }
    | { kind: "submit_scan"; role: UserRole; targetStatus: ItemStatus };

  const interactionArb: fc.Arbitrary<Interaction> = fc.oneof(
    fc.record({
      kind: fc.constant("view_options" as const),
      role: fc.constantFrom<UserRole>("operator", "qc"),
    }),
    fc.record({
      kind: fc.constant("page_access" as const),
      role: fc.constant<UserRole>("qc"),
    }),
    fc.record({
      kind: fc.constant("submit_scan" as const),
      role: fc.constant<UserRole>("operator"),
      targetStatus: fc.constantFrom<ItemStatus>("qc_pass", "qc_fail"),
    }),
  );

  it("for all (role, kind, targetStatus) where isBugCondition holds, the scan feature behaves per the caller's role", async () => {
    await fc.assert(
      fc.asyncProperty(interactionArb, async (input) => {
        if (input.kind === "view_options") {
          const values = await renderScanPageOptionValues(input.role);
          // visibleOptions(role) == getAllowedTargetStatuses(role)
          expect(new Set(values)).toEqual(
            new Set(EXPECTED_ALLOWED[input.role]),
          );
        } else if (input.kind === "page_access") {
          // navAllowsScan("qc") == true
          expect(await navIncludesScan(input.role)).toBe(true);
        } else {
          // disallowed submit_scan -> FORBIDDEN, no transition applied
          const r = await callBulkScan(input.role, input.targetStatus);
          expect(r.status).toBe(403);
          expect(r.code).toBe("FORBIDDEN");
          expect(r.processScanBatchCalled).toBe(false);
        }
      }),
      {
        numRuns: 100,
        examples: [
          [{ kind: "view_options", role: "operator" }],
          [{ kind: "view_options", role: "qc" }],
          [{ kind: "page_access", role: "qc" }],
          [{ kind: "submit_scan", role: "operator", targetStatus: "qc_pass" }],
          [{ kind: "submit_scan", role: "operator", targetStatus: "qc_fail" }],
        ],
      },
    );
  });
});
