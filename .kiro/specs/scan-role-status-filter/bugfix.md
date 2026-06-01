# Bugfix Requirements Document

## Introduction

The scan page (`src/app/scan/page.tsx`) lets a user pick a "Target Status" and then apply it to every drum they scan. Today that dropdown is built from a single hardcoded `TARGET_STATUS_OPTIONS` array containing all 8 item statuses (`qc_pending`, `qc_pass`, `qc_fail`, `in_production`, `finished`, `cold_storage`, `dispatched`, `archived`), and the exact same list is shown to every user regardless of role.

This contradicts the role model defined in `src/lib/rbac.ts`:

- **operator** holds `items:update_status` / `items:update_location` but does **not** hold `items:qc_pass` or `items:qc_fail`.
- **qc** holds `items:qc_pass` and `items:qc_fail` but not the general operational `items:update_status`.

As a result, operators are offered QC-only transitions (`qc_pass`, `qc_fail`) they are not allowed to perform, and the operator and QC scan screens are indistinguishable. The problem is compounded by two related defects: QC users are blocked from the scan page entirely by the `NavBar` role gate (`allowedRoles: ["operator", "admin"]`) even though QC is the only role meant to perform QC transitions, and the bulk-scan API (`src/app/api/items/bulk-scan/route.ts`) only checks the coarse `items:bulk_scan` permission without validating that the submitted `target_status` is allowed for the caller's role.

The fix must make the scan UI present a **role-appropriate** set of target statuses (operators and QC must see different lists), grant QC users access to the scan page, and enforce the role/status mapping on the server so the UI restriction cannot be bypassed.

**Assumption — status-to-role mapping (source of truth: `src/lib/rbac.ts`):**

- **QC statuses** = statuses gated by `items:qc_pass` / `items:qc_fail` → `qc_pass`, `qc_fail`.
- **Operator statuses** = transitions gated by `items:update_status` → `qc_pending`, `in_production`, `finished`, `cold_storage`, `dispatched`, `archived`.
- The placement of `qc_pending` (the `received → qc_pending` hand-off) is treated as an operator status because the operator performs that transition; final confirmation is deferred to design. `admin` retains the full set because it holds all transition permissions.

## Bug Analysis

### Current Behavior (Defect)

The scan dropdown is role-independent, QC cannot reach the page, and the server does not validate the target status against the caller's role.

1.1 WHEN an operator opens the scan page THEN the system displays all 8 target statuses, including `qc_pass` and `qc_fail`, which the operator role is not permitted to perform

1.2 WHEN a QC user is authenticated THEN the system hides the `/scan` navigation link and blocks access to the scan page, despite QC holding `items:bulk_scan` and being the only role allowed to perform `qc_pass` / `qc_fail` transitions

1.3 WHEN the operator scan screen and the QC scan screen are compared THEN the system shows an identical target-status list for both roles instead of role-specific lists

1.4 WHEN an operator submits a bulk-scan request with `target_status` of `qc_pass` or `qc_fail` THEN the system processes the request using only the coarse `items:bulk_scan` permission, without rejecting the role-disallowed target status

### Expected Behavior (Correct)

The dropdown is filtered to the caller's role, QC can access the scan page, the two roles see different lists, and the server rejects role-disallowed target statuses.

2.1 WHEN an operator opens the scan page THEN the system SHALL display only operator-permitted statuses (`qc_pending`, `in_production`, `finished`, `cold_storage`, `dispatched`, `archived`) and SHALL NOT display `qc_pass` or `qc_fail`

2.2 WHEN a QC user is authenticated THEN the system SHALL display the `/scan` navigation link and SHALL permit access to the scan page

2.3 WHEN a QC user opens the scan page THEN the system SHALL display only QC-permitted statuses (`qc_pass`, `qc_fail`) so that the operator and QC target-status lists are different

2.4 WHEN any user submits a bulk-scan request with a `target_status` not permitted for their role THEN the system SHALL reject that scan with a FORBIDDEN error and SHALL NOT apply the transition

### Unchanged Behavior (Regression Prevention)

Existing access, scanning, and state-machine behavior for inputs that do not trigger the bug must be preserved.

3.1 WHEN an admin opens the scan page THEN the system SHALL CONTINUE TO offer the full set of target statuses, since admin holds all transition permissions

3.2 WHEN an operator opens the scan page THEN the system SHALL CONTINUE TO allow access and bulk scanning of operator-permitted transitions

3.3 WHEN a user submits a bulk-scan request with a `target_status` that is permitted for their role THEN the system SHALL CONTINUE TO process the scan and apply the transition

3.4 WHEN a scan is processed THEN the system SHALL CONTINUE TO enforce the `VALID_TRANSITIONS` state machine, in-session duplicate detection, and offline queueing exactly as before

3.5 WHEN a ppic user is authenticated THEN the system SHALL CONTINUE TO deny access to the scan page, since ppic does not hold `items:bulk_scan`
