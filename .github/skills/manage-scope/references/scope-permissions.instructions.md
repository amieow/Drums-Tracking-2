---
name: Scope Permissions
description: How DaaS scope affects permission enforcement, inheritance direction, enforcePermission internals, check_permission_with_scope RPC, scoped access resolution logic, and admin bypass.
applyTo: "**/*.{ts,tsx}"
---

# Scope Permissions Instructions

DaaS permission enforcement is fully scope-aware. When a request includes a scope URI (via `X-Resource-Uri` header or `daas_resource_uri` cookie), all permission checks and data filters automatically operate in that scope context.

---

## Permission Inheritance: How It Works

Permission inheritance in DaaS scope is **upward-only (ancestor grants child access)**:

```
Scope Tree:
  /<region>:<apac>              ← Role assigned HERE
    /<region>:<apac>/<branch>:<sgp>    ← Role IS EFFECTIVE here (descendant)
    /<region>:<apac>/<branch>:<lon>    ← Role IS EFFECTIVE here (descendant)

  /<region>:<emea>              ← Role NOT effective here (different subtree)
```

**Inheritance resolution table:**

| Role assigned at URI      | Request at URI                          | Access granted? |
| ------------------------- | --------------------------------------- | --------------- |
| `/<r>:<apac>`             | `/<r>:<apac>`                           | ✓ (exact match) |
| `/<r>:<apac>`             | `/<r>:<apac>/<b>:<sgp>`                 | ✓ (descendant)  |
| `/<r>:<apac>`             | `/<r>:<apac>/<b>:<sgp>/<f>:<f1>`        | ✓ (descendant)  |
| `/<r>:<apac>/<b>:<sgp>`   | `/<r>:<apac>`                           | ✗ (ancestor)    |
| `/<r>:<apac>`             | `/<r>:<emea>`                           | ✗ (different subtree) |
| `null` (global)           | any URI                                 | ✓ (always)      |

**Algorithm:** A role at URI `A` is effective at request URI `R` when:
```
R === A  OR  R.startsWith(A + '/')
```

---

## `check_permission_with_scope` RPC

This Supabase RPC is the core of scope-aware permission checking. Called by `enforcePermission` when a scope URI is present.

**Signature:**
```sql
check_permission_with_scope(
  p_user_id    UUID,
  p_collection TEXT,
  p_action     TEXT,   -- 'read' | 'create' | 'update' | 'delete'
  p_resource_uri TEXT  -- the active scope URI
) RETURNS BOOLEAN
```

**Logic:**
1. Gets user's roles where `resource_uri IS NULL` (global) OR `resource_uri` is an ancestor-or-equal of `p_resource_uri`
2. Gets access entries for those roles where `resource_uri IS NULL` OR `resource_uri` is an ancestor-or-equal of `p_resource_uri`
3. Gets policies from those access entries
4. Returns `true` if any policy grants `p_action` on `p_collection`

**Fallback:** When `p_resource_uri` is null, the function falls back to standard `check_permission` (no scope filtering).

---

## `get_user_policies_for_scope` RPC

Returns the resolved set of policies applicable to a user in a given scope — used to build data filter expressions.

**Signature:**
```sql
get_user_policies_for_scope(
  p_user_id    UUID,
  p_resource_uri TEXT
) RETURNS TABLE(policy_id UUID, collection TEXT, action TEXT, permissions JSONB)
```

**Logic:** Same ancestor-or-equal matching as `check_permission_with_scope`. Returns the union of all policies from:
- Global roles (null `resource_uri`)
- Roles where `resource_uri` is ancestor-or-equal of `p_resource_uri`
- Access entries where `resource_uri` is ancestor-or-equal of `p_resource_uri`

---

## `enforcePermission` — Scope-Aware Enforcement

`lib/permissions/enforcer.ts` → `enforcePermission(check: PermissionCheck)`

The `PermissionCheck` interface:
```ts
interface PermissionCheck {
  userId: string;
  collection: string;
  action: 'read' | 'create' | 'update' | 'delete';
  resourceUri?: string | null;  // active scope URI (from request)
}
```

**Enforcement flow:**

```
enforcePermission({ userId, collection, action, resourceUri })
  │
  ├─ if resourceUri present:
  │    → call check_permission_with_scope(userId, collection, action, resourceUri)
  │
  └─ if resourceUri absent:
       → call check_permission(userId, collection, action)   (legacy, no scope)
```

**Automatic extraction in API middleware (`lib/api/middleware.ts`):**
```ts
// Middleware extracts resourceUri from request headers/cookies:
const resourceUri = req.headers.get('X-Resource-Uri')
  ?? req.cookies.get('daas_resource_uri')?.value
  ?? null;

// Passed to all permission checks:
await enforcePermission({ userId, collection, action, resourceUri });
```

---

## `getPermissionFilters` — Scope-Aware Data Filters

`lib/permissions/enforcer.ts` → `getPermissionFilters(userId, collection, resourceUri?)`

**Flow:**
```
getPermissionFilters(userId, collection, resourceUri)
  │
  ├─ if resourceUri present:
  │    → call get_user_policies_for_scope(userId, resourceUri)
  │
  └─ if resourceUri absent:
       → call get_user_policies(userId)    (global policies)
  │
  └─ merge policy permission filters → return combined filter expression
```

The returned filter is a DaaS-style JSON filter object (`_and`, `_or`, `_eq`, etc.) applied automatically to all collection queries.

---

## `daas_scope_collection_config` — Data Filter Enrichment

Beyond permission-level filtering, `getPermissionFilters` also applies the collection's scope config:

| `inheritance_mode` | Additional filter applied                                   |
| ------------------ | ----------------------------------------------------------- |
| `"exact"`          | `AND scope_field = <active-scope-item-uuid>`                |
| `"down"`           | `AND scope_field IN (<active-uuid>, <child-uuid>, ...)`     |

The active scope item UUID is extracted from the `resource_uri` (the last segment `<type>:<item>` → `item`).

**`missing_uri_mode` behavior:**

| `missing_uri_mode` | No scope URI in request  | Effect                                        |
| ------------------ | ------------------------ | --------------------------------------------- |
| `"strict"`         | → collection unrestricted by scope | All data accessible (no scope filter added) |
| `"reject"`         | → request blocked        | Returns 403 error; no data returned           |

---

## Scoped Access Entry Resolution

`daas_access` records can have `resource_uri` set, which scopes the policy assignment:

```
Request at: /<r>:<apac>/<b>:<sgp>

Access entry 1: role=manager, policy=orders-read, resource_uri=/<r>:<apac>
  → /<r>:<apac> is ancestor of /<r>:<apac>/<b>:<sgp>  → MATCH ✓

Access entry 2: role=manager, policy=orders-write, resource_uri=/<r>:<emea>
  → /<r>:<emea> is NOT ancestor of /<r>:<apac>/<b>:<sgp>  → SKIP ✗

Access entry 3: role=manager, policy=global-read, resource_uri=null
  → null always matches  → MATCH ✓
```

This means the same role can have **different effective policies depending on the scope**. A manager role in APAC gets different write permissions than in EMEA.

---

## Permission Filter: `$CURRENT_USER` Dynamic Variables

Dynamic variables in policy permission filters work identically in scoped and global contexts. The scope system adds an independent layer on top of policy filters — it does NOT replace them.

**Effective filter = scope data filter AND policy permission filter**

Example policy filter for tenant isolation (in addition to scope):
```json
{
  "owner_id": { "_eq": "$CURRENT_USER.id" }
}
```

Full dynamic variable reference:

| Variable                                    | Resolves To                                          |
| ------------------------------------------- | ---------------------------------------------------- |
| `$CURRENT_USER.id`                          | The authenticated user's UUID                        |
| `$CURRENT_USER.<junction>.<junction>_id`    | IDs from an M2M junction for the current user        |
| `$CURRENT_USER.<junction>.<field>`          | Any field from the junction table for current user   |

---

## Admin Bypass

Users with `daas_users.is_admin = true` bypass all scope permission checks. The `enforcePermission` function short-circuits before calling any RPC for admins.

Admin users also see all scopes in `ScopeSwitcher` (via `/api/scope/available` which returns all items for admins).
