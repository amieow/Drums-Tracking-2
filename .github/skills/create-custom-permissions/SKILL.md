---
name: create-custom-permissions
description: Add named key-value boolean permissions (e.g. "MyApp.Dashboard.TaskWidget") to a DaaS-backed application. These custom flags coexist with DaaS data-access permissions, share the same Policy/Role assignment chain, and are checkable from both React components and Next.js API routes. Use when the application needs application-level capability flags that are not tied to a collection or CRUD operation.
argument-hint: "[permission keys] [policies/roles to assign them to]"
---

# Create Custom Permissions

Add application-level boolean capability flags that integrate with the existing DaaS Policy → Role → User assignment chain.

## Concept

DaaS data-access permissions govern *which collections a user can CRUD and with what filters*. Custom permissions govern *whether a user has an application-level capability* — independent of any collection.

```
"MyApp.Dashboard.TaskWidget": true   → user may see a widget
"MyApp.LeaveRequest.Reject": true    → user may reject workflow requests
"MyApp.Reports.Export": false        → user may NOT export reports
```

Custom flags are stored as JSONB on `daas_policies.custom_permissions` and merged across all effective policies with boolean OR — exactly like collection permissions are merged from multiple policies.

## Resolution Order

```
User
 ├── daas_access (direct)  → Policy.custom_permissions
 └── daas_user_roles → Role → daas_access → Policy.custom_permissions
                                          ↓
              merge all with OR → effectiveCustomPermissions
```

---

## Step 1: Add Column via MCP (No DaaS Code Change)

Use the DaaS MCP `fields` tool to add the column. This runs `ALTER TABLE` and registers the field in `directus_fields` so the DaaS API automatically includes it in policy responses:

```json
{
  "name": "fields",
  "arguments": {
    "action": "create",
    "data": {
      "collection": "daas_policies",
      "field": "custom_permissions",
      "type": "json",
      "meta": {
        "required": false,
        "hidden": false,
        "note": "Application capability flags: { \"MyApp.Feature.Key\": true }"
      }
    }
  }
}
```

Verify `PATCH /api/policies/:id` round-trips the field (DaaS uses `select('*')`, so no code change needed).

---

## Step 2: Extend `/api/permissions/me` Response

Add a `custom` field to the permissions endpoint so clients get flags in one request.

Create or extend `app/api/permissions/me/custom/route.ts` in the wrapping app:

```typescript
// app/api/permissions/me/custom/route.ts
import { NextResponse } from 'next/server';
import { getCustomPermissions } from '@/lib/permissions/custom';

export async function GET() {
  const perms = await getCustomPermissions();
  return NextResponse.json({ data: perms });
}
```

If extending the existing `/api/permissions/me` response, append `custom: await getCustomPermissions()` to the response JSON.

---

## Step 3: Install Server Utilities

Copy the `lib/permissions/custom` template into the project:

```bash
npx buildpad add lib/permissions/custom
```

This installs:
- `getCustomPermissions()` — resolves merged flags for the current user (server-side)
- `hasCustomPermission(key)` — single-key boolean check (server-side)
- `enforceCustomPermission(key)` — throws 403 if not granted (server-side)

> ⚠️ Calls `GET /api/permissions/me/custom` internally using the current request cookies. **Must** be called from Server Components or API route handlers, never from Client Components.

---

## Step 4: Extend Client PermissionsContext

Add `customPermissions` state to `lib/contexts/PermissionsContext.tsx`:

```typescript
// Inside PermissionsProvider — add alongside existing state
const [customPermissions, setCustomPermissions] = useState<Record<string, boolean>>({});

// Inside fetchPermissions — extend the /api/permissions/me response handling
const data = await response.json();
setPermissions(data.data || {});
setCustomPermissions(data.custom || {});   // ← new

// Add to context value
const hasCustomPermission = useCallback(
  (key: string): boolean => {
    if (isAdmin) return true;
    return customPermissions[key] === true;
  },
  [customPermissions, isAdmin]
);

// Export new hooks
export function useCustomPermission(key: string): boolean {
  const { hasCustomPermission } = usePermissions();
  return useMemo(() => hasCustomPermission(key), [key, hasCustomPermission]);
}
```

---

## Step 5: Enforce in API Routes

```typescript
// app/api/leave-requests/[id]/reject/route.ts
import { enforceCustomPermission } from '@/lib/permissions/custom';
import { enforcePermission } from '@/lib/permissions/enforcer';

export async function POST(request: NextRequest, { params }) {
  // Custom flag guard — throws 403 if denied
  await enforceCustomPermission('MyApp.LeaveRequest.Reject');

  // Data-access guard (unchanged)
  await enforcePermission({ collection: 'leave_requests', action: 'update' });

  // ... business logic
}
```

---

## Step 6: Guard UI Components

```tsx
// Conditionally render based on custom permission
function Dashboard() {
  const showTaskWidget = useCustomPermission('MyApp.Dashboard.TaskWidget');
  return (
    <Grid>
      {showTaskWidget && <TaskWidget />}
      <CalendarWidget />
    </Grid>
  );
}

// Guard an action button
function LeaveRequestActions({ requestId }: { requestId: string }) {
  const canReject = useCustomPermission('MyApp.LeaveRequest.Reject');
  return canReject
    ? <Button color="red" onClick={() => reject(requestId)}>Reject</Button>
    : null;
}
```

---

## Step 7: Add Policy Editor UI

Copy the `CustomPermissionsEditor` template and add it to the Policy detail page:

```bash
npx buildpad add components/CustomPermissionsEditor
```

Wire it into the Policy detail page (or a `/policies/[id]/custom` route):

```tsx
import { CustomPermissionsEditor } from '@/components/CustomPermissionsEditor';

// Inside the policy detail page, after existing form fields:
{!isNew && policy && (
  <CustomPermissionsEditor
    policyId={policy.id}
    onChange={(updated) => console.log('Saved', updated)}
  />
)}
```

---

## Retrieving Current User's Policies (with Scope)

The platform provides a built-in endpoint to fetch all policy records that apply to the current user at a given scope:

```
GET /api/policies/me
Header: X-Resource-URI: /tenant:123/dept:456   (optional — omit for root scope)
```

Response:
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Tenant Admin",
      "custom_permissions": { "MyApp.Dashboard.TaskWidget": true },
      "...any other custom JSONB fields": "..."
    }
  ],
  "meta": {
    "resource_uri": "/tenant:123/dept:456",
    "is_admin": false
  }
}
```

**Resolution**: Uses `get_user_policies_for_scope()` with upward ancestor matching — a policy assigned at `/tenant:1` covers requests at `/tenant:1/dept:2`. Admin users receive all policies.

The `data` array contains raw `daas_policies` rows including **all custom JSONB columns** the application has added. The client is responsible for merging flags across the returned policies:

```typescript
// Merge custom_permissions across all policies (OR semantics — true wins)
const flags = policies.reduce((acc, policy) => ({
  ...acc,
  ...policy.custom_permissions,
}), {} as Record<string, boolean>);

const canExport = flags['MyApp.Reports.Export'] === true;
```

---

## Key Naming Convention

Keys MUST follow dot-notation: `<AppName>.<Domain>.<Capability>`

| ✅ Good | ❌ Bad |
|--------|--------|
| `MyApp.Dashboard.TaskWidget` | `taskWidget` |
| `MyApp.LeaveRequest.Reject` | `reject` |
| `MyApp.Admin.ImpersonateUser` | `admin` |

`DaaS.*` namespace is reserved by the platform.

---

## Security Checklist

- [ ] `enforceCustomPermission` called in every API route that performs a guarded action
- [ ] UI checks (`useCustomPermission`) are UX only — never the sole security boundary
- [ ] Only admin-access users (`admin_access: true`) can write `daas_policies`
- [ ] Admin users bypass custom permission checks (`isAdmin → true`)
