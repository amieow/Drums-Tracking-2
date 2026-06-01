# Implementation Plan: Scan Role Status Filter Bugfix

## Overview

This plan fixes three coupled defects in the scan feature using the exploratory bugfix workflow:
operators are offered QC-only target statuses, QC users are locked out of the scan page, and the
bulk-scan API authorizes purely on the coarse `items:bulk_scan` permission. The fix introduces a
single status-to-role projection (`getAllowedTargetStatuses`) derived from the existing
`PERMISSIONS` map in `src/lib/rbac.ts` and wires it into three layers (scan UI, nav gate, bulk-scan
API).

The plan follows the two-phase testing approach from the design: first surface counterexamples that
demonstrate the bug on UNFIXED code (Property 1 - Bug Condition) and capture baseline behavior to
preserve (Property 2 - Preservation), then implement the fix and re-run the same tests to confirm
the bug is resolved (fix checking) and nothing regressed (preservation checking). All code is
TypeScript; property-based tests use `fast-check` with Vitest (already dev dependencies).

---

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Role-Appropriate Status Filtering and Enforcement
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists across the three layers (option list, nav gate, server authorization)
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists, confirming or refuting the root-cause analysis at each layer. If refuted, re-hypothesize.
  - **Scoped PBT Approach**: Use `fast-check` to generate `(role, kind, targetStatus)` inputs where `isBugCondition` holds, AND include the concrete deterministic counterexamples below so failures are reproducible:
    - **(a) view_options** - Render `ScanPage` as an `operator` user and read the rendered `<select>` option values; assert they exclude `qc_pass` and `qc_fail` (will FAIL on unfixed code - all 8 statuses present from the hardcoded `TARGET_STATUS_OPTIONS`). Document the counterexample: operator dropdown contains `qc_pass` / `qc_fail`.
    - **(b) page_access** - Compute `NavBar` `visibleItems` for a `qc` user; assert `/scan` is present (will FAIL on unfixed code - `allowedRoles: ["operator", "admin"]` filters `/scan` out for `qc`). Document the counterexample: `qc` user's `visibleItems` omits `/scan`.
    - **(c) submit_scan** - Call the `POST` bulk-scan handler (`src/app/api/items/bulk-scan/route.ts`) with `userRole: "operator"` and an item carrying `target_status: "qc_pass"`; assert a `FORBIDDEN` response with no transition applied (`processScanBatch` not invoked) (will FAIL on unfixed code - request is processed on `items:bulk_scan` alone, returning 207). Document the counterexample: handler returns success for an operator submitting `qc_pass`.
    - **(d) qc view_options edge** - Render `ScanPage` as a `qc` user; assert option values are exactly `qc_pass`, `qc_fail` (may FAIL or throw on unfixed code - QC cannot reach the page, and if forced shows all 8).
  - The test assertions match the Expected Behavior in Property 1: `visibleOptions(role) == getAllowedTargetStatuses(role)`, `navAllowsScan("qc") == true`, and disallowed `submit_scan` yields `FORBIDDEN` with no transition.
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause (hardcoded `TARGET_STATUS_OPTIONS`, incomplete `allowedRoles`, coarse `items:bulk_scan`-only check)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Role-Dependent Scan Behavior
  - **IMPORTANT**: Follow observation-first methodology - run the UNFIXED code first, record actual outputs, then assert those outputs across the input domain
  - **Why property-based**: Preservation is a universal property ("for all non-buggy inputs"). Use `fast-check` to generate `(role, status)` pairs across all roles × all 8 statuses to catch ordering and role-boundary edge cases.
  - Observe on UNFIXED code and capture as properties:
    - **Admin options (3.1)** - Observe admin sees all 8 statuses; assert `getAllowedTargetStatuses("admin")` yields all 8 in stable display order and admin scans for any valid transition are accepted.
    - **Operator access + operator scans (3.2)** - Observe an operator reaches `/scan` and a scan to an operator status (e.g. `in_production`) succeeds; assert this still holds.
    - **Role-permitted scans (3.3)** - For every role-permitted `(role, status)` pair, observe the scan is processed and the transition applied; assert the fixed authorization layer passes the batch through to `processScanBatch` unchanged.
    - **Pipeline (3.4)** - Observe `VALID_TRANSITIONS` rejection (`INVALID_TRANSITION`), in-session duplicate detection (`processedInSession` / `checkDuplicate`), and offline-queue enqueue (`ScanQueue` / `SyncManager`) on UNFIXED code for role-permitted inputs; assert identical behavior, including the 207 Multi-Status response shape and per-item `ScanResult` reporting.
    - **ppic denial (3.5)** - Observe ppic has no `/scan` link and the route denies ppic; assert ppic remains denied (`getAllowedTargetStatuses("ppic")` is empty, `visibleItems` omits `/scan`).
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for role-independent scan status filtering and missing server enforcement
  - [x] 3.1 Add status-to-role mapping helpers in `src/lib/rbac.ts`
    - Add a constant grouping `ItemStatus` transition targets by their gating permission: `items:qc_pass` / `items:qc_fail` → `["qc_pass", "qc_fail"]` (QC statuses); `items:update_status` → `["qc_pending", "in_production", "finished", "cold_storage", "dispatched", "archived"]` (operator statuses)
    - Add `getAllowedTargetStatuses(role)` returning the union of groups whose gating permission the role holds (via `checkPermission`), in a stable display order: operator → 6 operator statuses; qc → `qc_pass`, `qc_fail`; admin → all 8; ppic → empty
    - Add `isTargetStatusAllowed(role, status)` (or use `getAllowedTargetStatuses(role).includes(status)`) for server-side validation
    - Treat `qc_pending` as an operator status (operator performs the `received → qc_pending` hand-off via `items:update_status`)
    - _Bug_Condition: isBugCondition(input) - role-appropriate result differs from current role-independent behavior_
    - _Expected_Behavior: getAllowedTargetStatuses(role) is the single source of truth derived from PERMISSIONS_
    - _Preservation: mapping derived from existing PERMISSIONS map so RBAC stays the single source of truth_
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Grant QC scan access in `src/components/NavBar.tsx`
    - Change the `/scan` entry's `allowedRoles` from `["operator", "admin"]` to `["operator", "qc", "admin"]`
    - Do not change the filtering logic itself; link stays hidden from ppic
    - _Bug_Condition: isBugCondition(input) where kind = "page_access", role = qc holds items:bulk_scan but nav denies access_
    - _Expected_Behavior: navAllowsScan("qc") == true; ppic still excluded_
    - _Preservation: operator and admin access unchanged; ppic remains denied_
    - _Requirements: 2.2, 3.5_

  - [x] 3.3 Derive scan options from role and guard the default in `src/app/scan/page.tsx`
    - Read `user` from `useAuth()` and compute the option list from `getAllowedTargetStatuses(user.role)`, mapping each status to its existing label via a label lookup map (labels unchanged)
    - Render the derived options instead of the static `TARGET_STATUS_OPTIONS`
    - Default `targetStatus` to the first allowed status for the role (not a hardcoded `"qc_pending"`) and ensure the selected value always belongs to the allowed list once role/options resolve, so no stale default can submit an out-of-list status
    - _Bug_Condition: isBugCondition(input) where kind = "view_options", currentVisibleOptions(role) != getAllowedTargetStatuses(role)_
    - _Expected_Behavior: visibleOptions(role) == getAllowedTargetStatuses(role) for operator and qc_
    - _Preservation: admin still sees the full 8-status list; labels unchanged_
    - _Requirements: 2.1, 2.3, 3.1_

  - [x] 3.4 Enforce role/status mapping server-side in `src/app/api/items/bulk-scan/route.ts`
    - After the existing `items:bulk_scan` check and after parsing the body, validate every item's `target_status` against `getAllowedTargetStatuses(userRole)` (or `isTargetStatusAllowed`)
    - If any item's status is not permitted for the role, write a `forbidden_attempt` audit entry (reuse `writeForbiddenAttempt` with the offending action, e.g. `items:qc_pass`) and return a `FORBIDDEN` error WITHOUT calling `processScanBatch`, so no transition is applied
    - Role-permitted batches fall through to `processScanBatch` unchanged (fail-closed at the authorization layer, before per-item processing)
    - _Bug_Condition: isBugCondition(input) where kind = "submit_scan", targetStatus NOT IN getAllowedTargetStatuses(role) yet server accepts on items:bulk_scan alone_
    - _Expected_Behavior: disallowed target_status rejected with FORBIDDEN and no transition applied_
    - _Preservation: role-permitted batches still processed by processScanBatch; 207 response shape and per-item ScanResult unchanged_
    - _Requirements: 2.4, 3.3, 3.4_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Role-Appropriate Status Filtering and Enforcement
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms operator/qc see role-appropriate options, qc reaches `/scan`, and disallowed `target_status` is rejected with `FORBIDDEN`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Role-Dependent Scan Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - admin full list, operator access/scans, role-permitted scans, state machine / duplicate detection / offline queue, ppic denial all unchanged)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full suite with `npm test` (vitest `--run`) and confirm the bug condition test (Property 1) passes, the preservation tests (Property 2) pass, and unit/integration tests pass
  - Verify UI/server agreement: for every `(role, status)` pair, the UI option list contains `status` iff the server accepts a single-item batch with that `target_status` for that role
  - Verify mapping consistency: for every role, `getAllowedTargetStatuses(role)` ⊆ the statuses gated by permissions the role holds in `PERMISSIONS`
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Property-based tests use `fast-check` with Vitest (minimum 100 iterations per property); run via `npm test`
- `getAllowedTargetStatuses` in `src/lib/rbac.ts` is the single source of truth for the status-to-role mapping - the UI filter and server guard both call it so they cannot drift apart
- `qc_pending` is treated as an operator status (operator performs the `received → qc_pending` hand-off via `items:update_status`)
- The fix is additive and surgical: it does NOT touch the `VALID_TRANSITIONS` state machine, in-session duplicate detection, or offline queueing
- Server enforcement is fail-closed: a batch containing any role-disallowed `target_status` is rejected with `FORBIDDEN` before per-item processing, rather than marked as a per-item failure
- Tasks 1 and 2 MUST be completed (tests written and run on UNFIXED code) before any implementation in task 3

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 3, "tasks": ["3.5", "3.6"] },
    { "id": 4, "tasks": ["4"] }
  ]
}
```
