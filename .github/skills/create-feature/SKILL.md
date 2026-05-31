---
name: create-feature
description: Plan and implement a complete feature using phased development approach. Analyzes requirements, designs data model, selects Buildpad components, and creates a phased implementation plan with testing strategy. Use when the user wants to add a new feature, module, or capability to an existing DaaS project.
argument-hint: "[feature name] [description]"
---

# Create Feature

Plan and coordinate implementation of a complete feature using **phased development**.

> **BEFORE generating ANY `.tsx` files** (pages, components, forms, lists), you MUST `read_file` the Buildpad component reference at `.github/skills/buildpad-reference/SKILL.md`. This loads the full 40+ component catalog with import paths and usage patterns. Skipping this step leads to raw Mantine usage violations.

## Feature Mini-Phases

Even individual features follow a phased approach:

| Phase      | Focus                        | Deliverables      |
| ---------- | ---------------------------- | ----------------- |
| **Design** | Requirements, data model, UI | Design document   |
| **Schema** | Migration, API, types        | API + tests       |
| **UI**     | Pages, forms, components     | Pages + tests     |
| **Logic**  | Validation, business rules   | Integration tests |
| **Polish** | Error handling, docs         | Documentation     |

## Planning Process

1. **Understand Requirements** — What problem does this solve? Who are the users?
2. **Check Built-In DaaS Features** — Before designing anything, review the [Built-in DaaS features reference](../daas-platform/references/builtin-features.instructions.md). If DaaS provides it natively (audit trail, workflow, versioning, file management, cron, RBAC, scoping, import/export), use it — do NOT rebuild it.
3. **Design Data Model** — Collections, fields, types, relationships, permissions. For every collection, follow the [Standard Fields decision tree](../create-collection/references/standard-fields.instructions.md#decision-tree--which-field-groups-to-include): always include audit fields, add workflow fields if approval/lifecycle needed, add scope field if multi-tenancy needed.
4. **Plan API Endpoints** — CRUD routes with request/response formats
5. **Design UI** — Pages, components, user flows
6. **Select Components (Buildpad-First MANDATORY)** — Check Buildpad's 40+ components before creating custom
7. **Plan Implementation** — Numbered tasks with estimates
8. **Plan Testing** — API tests, page tests, component tests, E2E tests

### Feature Planning Checklist

For each collection in the feature, answer these questions during the Design phase:

- [ ] **Audit fields included?** → ALWAYS yes (Group A: user_created, date_created, user_updated, date_updated)
- [ ] **Needs workflow/approval?** → Add Group B fields + plan `create-workflow` skill invocation
- [ ] **Needs multi-tenancy?** → Add Group C field + plan `manage-scope` skill invocation
- [ ] **Needs versioning?** → Plan DaaS versioning API integration (NOT custom version tables)
- [ ] **Needs scheduled tasks?** → Plan DaaS cron jobs (NOT Next.js cron routes)
- [ ] **Needs audit/change tracking?** → Already built-in via `GET /api/activity` (do NOT build custom)

## Buildpad Component Selection

| Need              | Buildpad Component                                              |
| ----------------- | --------------------------------------------------------------- |
| Text input        | `Input`, `Textarea`                                             |
| Rich text         | `RichTextHtml`, `RichTextMarkdown`                              |
| Select/dropdown   | `SelectDropdown`, `SelectRadio`                                 |
| Multi-select      | `SelectMultipleDropdown`, `Tags`                                |
| Toggle            | `Toggle`, `Boolean`                                             |
| Date/time         | `DateTime`                                                      |
| File upload       | `FileInterface`, `FileImage`, `Files`                           |
| Relations         | `ListM2O`, `ListM2M`, `ListO2M`, `ListM2A`                      |
| Dynamic form      | `VForm`, `CollectionForm`                                       |
| Listing records   | `CollectionList` (with search, filter, pagination, permissions) |
| Filtering records | `FilterPanel` (field-type-aware, DaaS-compatible JSON output)   |
| Aggregate/stats   | DaaS aggregate API (`aggregate[count]=id&groupBy=status`)       |

Custom components allowed ONLY for: app-specific layouts, dashboards, specialized visualizations.

## CollectionList Usage (MANDATORY for list pages)

When the UI phase includes a list page, you MUST use `CollectionList` with the full-featured pattern.
Do NOT create custom tables with Mantine `<Table>` or raw HTML for collection records.

```tsx
import { CollectionList } from "@/components/ui";

<CollectionList
  collection="articles"
  enableSearch
  enableFilter // Integrated FilterPanel with badge count
  enableSelection // Row selection with bulk actions
  enableCreate // Permission-gated create button
  enableDelete // Built-in delete with confirmation modal
  enableSort
  enableResize
  enableReorder
  enableHeaderMenu
  limit={25}
  onCreate={() => router.push("/content/articles/+")}
  onItemClick={(item) => router.push(`/content/articles/${item.id}`)}
/>;
```

Key features: integrated search + FilterPanel toggle with badge, permission-gated create/bulk actions,
pagination (25/50/100/250), field-type-aware cell rendering, column management.

## VForm Usage (CRITICAL)

When the UI phase includes a form page, you MUST follow the VForm controlled component pattern.
See [VForm usage reference](references/vform-usage.instructions.md) for the required pattern.

**Key rules:**

- VForm has NO `onSubmit` prop — pass `modelValue` + `onUpdate` for controlled state
- VForm renders a `<div>`, NOT a `<form>` — do NOT use `type="submit"` or `form="vform"`
- Handle submission externally via `onClick` on a Button
- Consider `CollectionForm` as an all-in-one alternative to VForm for CRUD pages

## Scope-Aware Context Pattern (REQUIRED when feature has tenant-scoped data)

> **Bug 26:** Any React context or component that calls DaaS on mount AND lives inside `ScopeProvider` must wait for the scope to be ready before fetching. Firing the request before the `daas_resource_uri` cookie is set results in a 401. The `.catch()` handler will have set state to `false`/empty, and the effect will NOT re-run unless `scopeLoading` is in the dependency array.

When implementing a new context/provider that fetches from DaaS:

```tsx
import { useScope } from '@/lib/contexts/ScopeContext';

const { resourceUri, isLoading: scopeLoading } = useScope();

useEffect(() => {
  if (scopeLoading) return; // ← REQUIRED guard — do not remove

  apiRequest('/api/...')
    .then(...)
    .catch(...);

  // Re-fetch when tenant changes (policies/data may differ per scope)
}, [version, resourceUri, scopeLoading]);
//             ^^^^^^^^^^  ^^^^^^^^^^^  ← REQUIRED deps
```

## Output Format

Provide a structured plan with:

- Overview and requirements
- Data model design
- API design
- UI design with Buildpad components
- Phased implementation tasks
- Testing strategy per phase
- Time estimates

## Testing Strategy (per phase)

- **Schema Phase**: API tests for all endpoints
- **UI Phase**: Page tests for all pages
- **Logic Phase**: Integration tests for business rules
- **Polish Phase**: E2E tests for user flows

## Post-Generation Validation (MANDATORY)

After generating ANY `.tsx` files for this feature, run the Buildpad-First violation check:

```bash
# Scan generated files for forbidden raw Mantine form/input imports
grep -rn "from '@mantine/form'\|from '@mantine/dates'\|from '@mantine/dropzone'\|<TextInput\|<NumberInput\|<Select \|<Switch \|<Checkbox \|<DatePicker\|<Dropzone" app/ components/ 2>/dev/null
```

**If any matches are found, replace them with Buildpad equivalents before proceeding.**

Quick fix reference:
| Violation | Replace With |
|---|---|
| `<TextInput>` / `<Textarea>` | `Input` / `Textarea` from `@/components/ui` |
| `<Select>` | `SelectDropdown` from `@/components/ui` |
| `<DatePicker>` | `DateTime` from `@/components/ui` |
| `<Switch>` / `<Checkbox>` | `Toggle` / `Boolean` / `SelectMultipleCheckbox` |
| `<Dropzone>` | `Upload` / `Files` from `@/components/ui` |
| `useForm` (@mantine/form) | `VForm` or `CollectionForm` from `@/components/ui` |
| Custom `<Table>` for records | `CollectionList` from `@/components/ui` |
