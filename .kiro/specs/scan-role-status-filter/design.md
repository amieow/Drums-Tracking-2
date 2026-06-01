# Scan Role Status Filter Bugfix Design

## Overview

The scan page (`src/app/scan/page.tsx`) builds its "Target Status" dropdown from a single
hardcoded `TARGET_STATUS_OPTIONS` array containing all 8 transition statuses, and shows that
same list to every authenticated user. This ignores the role model in `src/lib/rbac.ts`, where
`operator` holds `items:update_status` (but not `items:qc_pass` / `items:qc_fail`) and `qc` holds
`items:qc_pass` / `items:qc_fail` (but not `items:update_status`). The result is three coupled
defects: operators are offered QC-only transitions they cannot perform, QC users are locked out of
the scan page entirely by the `NavBar` role gate (`allowedRoles: ["operator", "admin"]`), and the
bulk-scan API only checks the coarse `items:bulk_scan` permission without validating that the
submitted `target_status` is allowed for the caller's role.

The fix strategy is to make the existing RBAC permission map the single source of truth for the
status-to-role mapping, then apply that mapping in three places:

1. **Scan UI** — derive the visible target-status options from the caller's role so operators and
   QC see different, role-appropriate lists.
2. **Navigation gate** — grant `qc` access to the `/scan` nav link and page so QC can reach the
   only screen where they can perform `qc_pass` / `qc_fail`.
3. **Bulk-scan API** — enforce the role/status mapping server-side so a forged or stale request
   with a role-disallowed `target_status` is rejected with `FORBIDDEN`, independent of the UI.

The fix is additive and surgical: it introduces a small mapping helper grounded in the existing
`PERMISSIONS` map and wires it into the three call sites. It does not touch the
`VALID_TRANSITIONS` state machine, in-session duplicate detection, or offline queueing.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a user interacts with the scan
  feature (viewing target-status options, accessing the page, or submitting a bulk scan) in a way
  whose role-appropriate result differs from the current role-independent behavior. Concretely:
  (a) a non-admin user views the target-status list, (b) a `qc` user attempts to reach the scan
  page/nav link, or (c) any user submits a `target_status` not permitted for their role.
- **Property (P)**: The desired behavior — the scan feature presents and accepts only the
  transition statuses permitted for the caller's role, and grants page access to exactly the roles
  that hold `items:bulk_scan`.
- **Preservation**: Existing behavior for non-bug inputs that must remain unchanged — admin's full
  status list, operator access and operator-permitted scans, role-permitted scans succeeding, the
  `VALID_TRANSITIONS` state machine, in-session duplicate detection, offline queueing, and ppic
  remaining denied.
- **Status-to-role mapping**: The function that maps a `UserRole` to the set of `ItemStatus`
  values that role is permitted to transition items into via scan. Derived from `src/lib/rbac.ts`.
- **QC statuses**: Statuses gated by `items:qc_pass` / `items:qc_fail` → `qc_pass`, `qc_fail`.
- **Operator statuses**: Transitions gated by `items:update_status` → `qc_pending`,
  `in_production`, `finished`, `cold_storage`, `dispatched`, `archived`.
- **`getAllowedTargetStatuses(role)`**: New helper (proposed in `src/lib/rbac.ts`) that returns the
  ordered list of `ItemStatus` values a role may target via scan.
- **`checkPermission(role, action)`**: Existing helper in `src/lib/rbac.ts` that returns whether a
  role holds a permission. Used to derive the mapping and enforce it server-side.
- **`TARGET_STATUS_OPTIONS`**: The hardcoded `{ value, label }[]` array in
  `src/app/scan/page.tsx` that currently drives the dropdown for every role.
- **`NAV_ITEMS` / `allowedRoles`**: The navigation config in `src/components/NavBar.tsx` that gates
  which roles see the `/scan` link.

## Bug Details

### Bug Condition

The bug manifests whenever the scan feature's behavior should depend on the caller's role but does
not. The scan UI is built from a role-independent `TARGET_STATUS_OPTIONS` list, the `/scan` nav
gate omits `qc`, and the bulk-scan API authorizes purely on the coarse `items:bulk_scan`
permission. So the function under consideration (the composite scan flow: option list + page
access + server authorization) fails to restrict statuses or access according to role.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type ScanInteraction
         { role: UserRole,
           kind: "view_options" | "page_access" | "submit_scan",
           targetStatus?: ItemStatus }
  OUTPUT: boolean

  // (a) Target-status list is not role-appropriate
  IF input.kind == "view_options" THEN
    RETURN currentVisibleOptions(input.role) != getAllowedTargetStatuses(input.role)
  END IF

  // (b) A role that holds items:bulk_scan is denied scan-page access (qc today)
  IF input.kind == "page_access" THEN
    RETURN checkPermission(input.role, "items:bulk_scan")
           AND NOT navAllowsScan(input.role)
  END IF

  // (c) A bulk scan submits a target_status the role may not perform,
  //     yet the server accepts it on items:bulk_scan alone
  IF input.kind == "submit_scan" THEN
    RETURN checkPermission(input.role, "items:bulk_scan")
           AND input.targetStatus NOT IN getAllowedTargetStatuses(input.role)
           AND serverAcceptsOnBulkScanPermissionOnly(input)
  END IF

  RETURN false
END FUNCTION
```

### Examples

- **Operator views options (defect):** An operator opens `/scan` and the dropdown lists all 8
  statuses including `qc_pass` and `qc_fail`. Expected: only `qc_pending`, `in_production`,
  `finished`, `cold_storage`, `dispatched`, `archived`.
- **QC page access (defect):** A `qc` user is authenticated; the `/scan` nav link is hidden and the
  page is unreachable even though QC holds `items:bulk_scan` and is the only role meant to perform
  `qc_pass` / `qc_fail`. Expected: `/scan` link visible and page accessible.
- **QC views options (defect):** Were QC able to reach the page, it would show the same 8-status
  list as the operator. Expected: only `qc_pass` and `qc_fail`, a list distinct from the operator's.
- **Operator submits QC transition (defect):** An operator (or a forged client) POSTs
  `/api/items/bulk-scan` with `target_status: "qc_pass"`. The server processes it on
  `items:bulk_scan` alone. Expected: the scan is rejected with `FORBIDDEN` and no transition is
  applied.
- **Admin views options (correct — preserve):** An admin opens `/scan` and sees the full set of
  transition statuses, unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- **3.1** Admin continues to be offered the full set of target statuses (admin holds all transition
  permissions), and admin scan submissions for any valid transition continue to be accepted.
- **3.2** Operators continue to have scan-page access and can bulk scan operator-permitted
  transitions exactly as before.
- **3.3** Any user submitting a `target_status` permitted for their role continues to have the scan
  processed and the transition applied.
- **3.4** The `VALID_TRANSITIONS` state machine (`src/types/index.ts` + `validateTransition`),
  in-session duplicate detection (`processedInSession` / `checkDuplicate`), and offline queueing
  (`ScanQueue` / `SyncManager`) all continue to behave exactly as before.
- **3.5** A `ppic` user continues to be denied scan-page access, since `ppic` does not hold
  `items:bulk_scan`.

**Scope:**
All inputs that do NOT involve role-dependent scan behavior must be completely unaffected by this
fix. This includes:

- Admin's full target-status list and admin scans.
- Operator access and operator-permitted scans.
- The scan-processing pipeline below the authorization layer: state-machine validation, duplicate
  detection, offline queue enqueue/sync, the 207 Multi-Status response shape, and per-item
  `ScanResult` success/error reporting.
- ppic and any unauthenticated request, which remain denied.

**Note:** The actual expected correct behavior for bug inputs is defined in the Correctness
Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug analysis, the defects stem from role-awareness being absent at three layers that
each independently authorize or present scan behavior:

1. **Hardcoded, role-independent option list (UI presentation)**: `TARGET_STATUS_OPTIONS` in
   `src/app/scan/page.tsx` is a module-level constant rendered directly into the `<select>`. The
   component never reads `user.role` (available via `useAuth`) to filter the list, so every role
   sees all 8 statuses. Root cause: no status-to-role filtering exists on the client.

2. **Incomplete nav allow-list (UI access gate)**: The `/scan` entry in `NAV_ITEMS`
   (`src/components/NavBar.tsx`) uses `allowedRoles: ["operator", "admin"]`, which predates QC being
   a scanning role. Because QC is omitted, the link is filtered out and QC cannot navigate to the
   page. Root cause: the allow-list does not reflect that `qc` holds `items:bulk_scan`.

3. **Coarse-grained server authorization (server enforcement)**: The bulk-scan route
   (`src/app/api/items/bulk-scan/route.ts`) checks only `checkPermission(userRole, "items:bulk_scan")`
   and then passes the batch straight to `processScanBatch`. It never validates each item's
   `target_status` against the caller's role. Root cause: the API conflates "may scan at all" with
   "may apply this specific transition," so the UI restriction can be bypassed by any direct request.

The unifying root cause is that the status-to-role relationship lives only implicitly inside the
`PERMISSIONS` map and is never projected into a reusable status list. The fix introduces that
projection once and reuses it across all three layers.

## Correctness Properties

Property 1: Bug Condition - Role-Appropriate Status Filtering and Enforcement

_For any_ input where the bug condition holds (`isBugCondition` returns true), the fixed scan
feature SHALL behave according to the caller's role: the scan UI SHALL present exactly
`getAllowedTargetStatuses(role)` (operators see `qc_pending`, `in_production`, `finished`,
`cold_storage`, `dispatched`, `archived` and never `qc_pass` / `qc_fail`; QC sees exactly `qc_pass`
and `qc_fail`); a `qc` user SHALL see the `/scan` nav link and be permitted to access the scan
page; and a bulk-scan request whose `target_status` is not in `getAllowedTargetStatuses(role)`
SHALL be rejected with a `FORBIDDEN` error and SHALL NOT apply any transition.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Role-Dependent Scan Behavior

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed
code SHALL produce the same result as the original code, preserving: admin's full target-status
list and admin scans; operator access and operator-permitted scans; processing of any
role-permitted `target_status`; the `VALID_TRANSITIONS` state machine, in-session duplicate
detection, and offline queueing; and ppic remaining denied scan-page access.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix adds one mapping helper and wires it into the
three layers. The mapping is derived from the existing `PERMISSIONS` map so RBAC remains the single
source of truth.

**File**: `src/lib/rbac.ts`

**Function**: new `getAllowedTargetStatuses(role)`

**Specific Changes**:

1. **Introduce the status-to-role projection**: Add a constant that groups `ItemStatus` transition
   targets by the permission that gates them, then a helper that assembles the allowed list per
   role from `checkPermission`:
   - `items:qc_pass` / `items:qc_fail` → `["qc_pass", "qc_fail"]` (QC statuses).
   - `items:update_status` → `["qc_pending", "in_production", "finished", "cold_storage",
"dispatched", "archived"]` (operator statuses).
   - `getAllowedTargetStatuses(role)` returns the union of the groups whose gating permission the
     role holds, in a stable display order. Result: operator → 6 operator statuses; qc → 2 QC
     statuses; admin → all 8; ppic → empty.
2. **Add a server-side guard helper**: Add `isTargetStatusAllowed(role, status)` (or reuse
   `getAllowedTargetStatuses(role).includes(status)`) for the API to validate each scan item.

**File**: `src/components/NavBar.tsx`

**Function**: `NAV_ITEMS` config

**Specific Changes**: 3. **Grant QC scan access**: Change the `/scan` entry's `allowedRoles` from
`["operator", "admin"]` to `["operator", "qc", "admin"]`. This makes the link visible to QC and
keeps it hidden from ppic. No change to the filtering logic itself.

**File**: `src/app/scan/page.tsx`

**Function**: `ScanPage`

**Specific Changes**: 4. **Derive options from role**: Read `user` from `useAuth()`, compute the option list from
`getAllowedTargetStatuses(user.role)` (mapping each status to its existing label), and render
that instead of the static `TARGET_STATUS_OPTIONS`. Keep a label lookup map so labels are
unchanged. 5. **Initialize and guard the selected status**: Default `targetStatus` to the first allowed status
for the role (instead of a hardcoded `"qc_pending"`), and ensure the selected value always
belongs to the allowed list when the role/options resolve, so no role can submit an
out-of-list status from a stale default.

**File**: `src/app/api/items/bulk-scan/route.ts`

**Function**: `POST`

**Specific Changes**: 6. **Enforce role/status mapping server-side**: After the existing `items:bulk_scan` check and
after parsing the body, validate every item's `target_status` against
`getAllowedTargetStatuses(userRole)`. If any item's status is not permitted for the role, write a
`forbidden_attempt` audit entry (reusing `writeForbiddenAttempt` with the offending action, e.g.
`items:qc_pass`) and return a `FORBIDDEN` error without calling `processScanBatch`, so no
transition is applied. Role-permitted batches fall through to `processScanBatch` unchanged.

**Design notes / decisions:**

- **`qc_pending` placement**: Treated as an operator status (operator performs the
  `received → qc_pending` hand-off via `items:update_status`), matching the requirements assumption.
- **Single source of truth**: The UI filter and the server guard both call
  `getAllowedTargetStatuses`, so they cannot drift apart.
- **Enforcement granularity**: The server rejects the request when any item carries a disallowed
  status (fail-closed at the authorization layer, before per-item processing), rather than marking
  individual items failed, because a disallowed status indicates a forged/bypassed request rather
  than a normal per-item error.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate
the bug on the unfixed code (confirming the root cause at each of the three layers), then verify the
fix produces role-appropriate behavior and preserves all non-role-dependent behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or
refute the root cause analysis at each layer. If refuted, re-hypothesize.

**Test Plan**: Write tests that (a) render the scan page as an operator and inspect the rendered
option values, (b) evaluate the `NavBar` visible-items computation for a `qc` user, and (c) POST a
bulk-scan request with a role-disallowed `target_status` against the unfixed route handler and
observe that it is accepted. Run these on the UNFIXED code to observe failures.

**Test Cases**:

1. **Operator option list test**: Render the scan page with an operator user and assert the option
   values exclude `qc_pass` / `qc_fail` (will fail on unfixed code — all 8 are present).
2. **QC nav access test**: Compute `visibleItems` for a `qc` user and assert `/scan` is present
   (will fail on unfixed code — `/scan` is filtered out).
3. **Server enforcement test**: Call the bulk-scan handler with `userRole: "operator"` and an item
   `target_status: "qc_pass"` and assert a `FORBIDDEN` response with no transition applied (will
   fail on unfixed code — request is processed on `items:bulk_scan` alone).
4. **QC option list edge test**: Render the scan page with a `qc` user and assert the option values
   are exactly `qc_pass`, `qc_fail` (may fail/throw on unfixed code — QC cannot reach the page, and
   if forced would show all 8).

**Expected Counterexamples**:

- Operator dropdown contains `qc_pass` / `qc_fail`.
- `qc` user's `visibleItems` omits `/scan`.
- Bulk-scan handler returns success (207) for an operator submitting `qc_pass`.
- Possible causes: hardcoded `TARGET_STATUS_OPTIONS`, incomplete `allowedRoles`, coarse
  `items:bulk_scan`-only check.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the
expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedScanFeature(input)
  ASSERT expectedBehavior(result)
  // view_options: visibleOptions(role) == getAllowedTargetStatuses(role)
  // page_access (qc): navAllowsScan(qc) == true
  // submit_scan (disallowed status): result.code == "FORBIDDEN" AND no transition applied
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function
produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalScanFeature(input) = fixedScanFeature(input)
  // admin option list unchanged; operator access unchanged;
  // role-permitted scans processed identically; ppic still denied;
  // state machine / duplicate detection / offline queue unchanged
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain (all roles × all statuses).
- It catches edge cases that manual unit tests might miss (e.g., status ordering, role boundaries).
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for admin options, operator-permitted scans,
and ppic denial, then write property-based tests capturing that behavior and re-run them against the
fixed code.

**Test Cases**:

1. **Admin option preservation**: Observe that admin sees all 8 statuses on unfixed code; assert
   `getAllowedTargetStatuses("admin")` still yields all 8 after the fix.
2. **Operator-permitted scan preservation**: Observe that an operator scanning to an operator status
   (e.g., `in_production`) succeeds on unfixed code; assert it still succeeds after the fix.
3. **ppic denial preservation**: Observe that ppic has no `/scan` link and the route denies ppic on
   unfixed code; assert ppic remains denied after the fix.
4. **Pipeline preservation**: Observe state-machine rejection (`INVALID_TRANSITION`), duplicate
   detection, and offline-queue enqueue on unfixed code for role-permitted inputs; assert identical
   behavior after the fix.

### Unit Tests

- `getAllowedTargetStatuses` returns the correct list per role: operator (6 operator statuses, no
  `qc_pass` / `qc_fail`), qc (`qc_pass`, `qc_fail`), admin (all 8), ppic (empty).
- `NavBar` visible-items includes `/scan` for operator, qc, admin and excludes it for ppic.
- Bulk-scan route returns `FORBIDDEN` for a role-disallowed `target_status` and 207 for an allowed
  one; `processScanBatch` is not invoked on the forbidden path.
- Scan page initializes `targetStatus` to a role-allowed default and never renders a disallowed
  option.

### Property-Based Tests

- For every `(role, status)` pair, the UI option list contains `status` if and only if the server
  accepts a single-item batch with that `target_status` for that role (UI/server agreement).
- For every role, `getAllowedTargetStatuses(role)` ⊆ the set of statuses gated by permissions the
  role actually holds in `PERMISSIONS` (mapping is consistent with RBAC).
- For every role-permitted `(role, status)`, the fixed bulk-scan authorization layer passes the
  batch through to processing unchanged (preservation across the input domain).

### Integration Tests

- Full operator flow: log in as operator → `/scan` reachable → dropdown shows operator statuses →
  scan to `in_production` succeeds; attempting `qc_pass` via direct API returns `FORBIDDEN`.
- Full QC flow: log in as qc → `/scan` link visible and reachable → dropdown shows `qc_pass` /
  `qc_fail` → scan a `qc_pending` item to `qc_pass` succeeds (state machine honored).
- Role-switch / denial flow: ppic cannot see or reach `/scan`; admin sees the full list and scans
  across the lifecycle, with `VALID_TRANSITIONS`, duplicate detection, and offline queueing intact.
