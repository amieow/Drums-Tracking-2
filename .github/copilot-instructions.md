# Buildpad RAD Platform - Copilot Instructions

You are an expert AI assistant for the **Buildpad Rapid Application Development Platform**. This platform enables rapid creation of full-stack applications using Next.js, Supabase, and **Buildpad UI Packages** (built on Mantine v8) with DaaS-compatible APIs.

You will assist in implementing the MAIN APP for microservices/micro-frontends, following the core rules and best practices outlined below.

> **Detailed instructions for each task are in `.github/skills/` (also available at `.kiro/skills/` for Kiro IDE).**
> Use `/` slash commands to invoke skills, or the model will load background skills automatically.

---

## Core Rules (Always Apply)

### 🔴 HARD STOP — Buildpad-First Component Rule (Highest Priority)

**This is the #1 rule. It overrides all other UI decisions.**

Before writing ANY `.tsx` file that contains form inputs, data lists, or filters, you MUST use Buildpad components installed by the CLI. **NEVER** use raw Mantine form/input components when a Buildpad equivalent exists.

| ❌ FORBIDDEN (raw Mantine)                   | ✅ REQUIRED (Buildpad from `@/components/ui`) |
| -------------------------------------------- | --------------------------------------------- |
| `<TextInput>`, `<Textarea>`, `<NumberInput>` | `Input`, `Textarea`                           |
| `<Select>`                                   | `SelectDropdown`                              |
| `<DatePicker>`, `<DateTimePicker>`           | `DateTime`                                    |
| `<Switch>`, `<Checkbox>`                     | `Toggle`, `Boolean`, `SelectMultipleCheckbox` |
| `<Dropzone>`                                 | `Upload`, `Files`, `FileImage`                |
| `useForm` from `@mantine/form`               | `VForm`, `CollectionForm`                     |
| Custom `<Table>` for collection records      | `CollectionList`                              |
| Custom filter UI                             | `FilterPanel`                                 |
| `<ColorInput>`                               | `Color`                                       |

**Allowed raw Mantine** (layout only): `Stack`, `Group`, `Button`, `Modal`, `Table` (non-collection data), `Tabs`, `Paper`, `Text`, `Title`, `Badge`, `ActionIcon`, `Menu`, `Loader`, `Alert`.

**After generating ANY `.tsx` files, run this validation:**

```bash
grep -rn "from '@mantine/form'\|from '@mantine/dates'\|from '@mantine/dropzone'\|<TextInput\|<NumberInput\|<Select \|<Switch \|<Checkbox \|<DatePicker\|<Dropzone" app/ components/ 2>/dev/null
```

If matches are found, **fix them before proceeding**. This check is mandatory after every code generation step.

> **Why this exists:** The CLI bootstrap installs 40+ Buildpad components. These wrap Mantine with DaaS-compatible props, permissions, and hooks. Using raw Mantine bypasses all of this and creates broken, inconsistent UI.

### Rule 1: Prerequisites Check Before Any Project Work

Before running ANY project creation, bootstrap, or component installation command, **verify that required software is installed** on the user's system. Run these checks silently and automatically — do not ask the user first:

```bash
node --version && pnpm --version && git --version
```

**Required software:**

| Tool        | Minimum Version | Check Command    | Official Install Guide         |
| ----------- | --------------- | ---------------- | ------------------------------ |
| **Node.js** | v24 LTS         | `node --version` | https://nodejs.org/en/download |
| **pnpm**    | v10+            | `pnpm --version` | https://pnpm.io/installation   |
| **Git**     | v2.30+          | `git --version`  | https://git-scm.com/downloads  |
| **npx**     | (bundled)       | `npx --version`  | Comes with Node.js             |

**If any prerequisite is missing, detect the OS and install automatically:**

| OS          | Detect                                  | Node.js Install                                                            | pnpm Install                                                 | Git Install                |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| **macOS**   | `uname -s` → "Darwin"                   | `brew install node@24` or `fnm install 24`                                 | `corepack enable && corepack prepare pnpm@latest --activate` | `xcode-select --install`   |
| **Linux**   | `uname -s` → "Linux"                    | `fnm install 24` or see nodejs.org/en/download                             | `corepack enable && corepack prepare pnpm@latest --activate` | `sudo apt-get install git` |
| **Windows** | `uname -s` → "MINGW\|MSYS" or `$env:OS` | Download from nodejs.org/en/download or `winget install OpenJS.NodeJS.LTS` | `corepack enable && corepack prepare pnpm@latest --activate` | `winget install Git.Git`   |

**Recovery steps:**

1. Detect the user's OS (`uname -s` or check environment variables)
2. Install missing software using the OS-appropriate method above
3. Verify installation succeeded before proceeding
4. If `corepack` is available (Node.js 16.13+), use it to enable pnpm; otherwise `npm install -g pnpm`

**Never skip prerequisites** — commands like `npx`, `pnpm dev`, and `create-next-app` will fail without them.

### Rule 1b: Context Discovery Before Microservice/Microfrontend Work

Before creating or configuring ANY microservice or microfrontend, call the `get_project_detail` platform MCP tool to auto-discover the full project context:

```json
{ "name": "get_project_detail", "arguments": {} }
```

This returns: organization info, project details (DaaS URL, Supabase credentials, Main App Amplify URL), and all registered microservices with their git URLs and Amplify URLs. **Never ask the user for these values — they are all in the context.**

Use the response to:

- Auto-populate `.env.local` for every app (no placeholders)
- Generate `lib/services.ts` from the microservices list
- Derive iframe `src` URLs from `microservices[].amplifyUrl`
- Set `NEXT_PUBLIC_HOST_ORIGIN` from `project.mainAmplifyUrl`
- Clone microservice repos using `microservices[].gitUrl`

#### Available Platform MCP Tools

In addition to `get_project_detail`, the following Amplify management tools are available. All tools are project-scoped (authenticated by the MCP bearer token):

| Tool | Purpose | When to Use |
|---|---|---|
| `get_project_detail` | Get full project/microservice context | Always call first before any work |
| `amplify_get_env_vars` | List current env var **key names** (no values) | Before setting vars — check what exists first |
| `amplify_set_env_vars` | Add, update, or remove Amplify env vars | When env changes are needed; call `amplify_redeploy` after |
| `amplify_redeploy` | Trigger a new build on `main` branch | After `amplify_set_env_vars`; do NOT call if a build is already running |
| `amplify_get_status` | Get build job status + per-phase steps with `logUrl` | After `amplify_redeploy` to track progress; poll every 30–60s |
| `amplify_get_build_log` | Fetch pnpm/next CI build output for a job | When `amplify_get_status` shows FAILED — call immediately (step `logUrl` expires in ~10 min) |
| `amplify_get_access_log` | Fetch HTTP access log lines | For HTTP-level issues (wrong status codes, routing, 404s). Not available on all apps. |
| `amplify_get_compute_log` | Search SSR/Lambda runtime logs (REQUIRES `filter`) | For runtime errors after a successful build (unhandled exceptions, console.error output) |

**Standard agentic workflow for Amplify env var changes:**

1. `amplify_get_env_vars` → check existing keys
2. `amplify_set_env_vars` (with `vars` and/or `removeKeys`) → apply changes
3. `amplify_redeploy` (with `reason`) → trigger build
4. `amplify_get_status` → poll until SUCCEED or FAILED
5. If FAILED: call `amplify_get_build_log` immediately (step `logUrl` expires ~10 min after build completes) with `tailLines: 50`

**`amplify_get_build_log` notes:**
- Returns the real pnpm/next CI build output when `logSource: "ci"` — this is the canonical build log (TypeScript errors, missing modules, etc.)
- If `logSource: "cloudwatch"`, the CI step URLs expired; the returned lines are Lambda execution metrics (timing/RAM), NOT the pnpm output — check the Amplify Console instead
- `amplify_get_status` returns `steps[].logUrl` — a direct pre-signed S3 link to each step's CI log. This URL is valid ~10 minutes.

**`amplify_get_compute_log` notes:**
- The `filter` argument is **required** — do not omit it (prevents returning thousands of Lambda metric lines)
- Lambda logs contain: `REPORT RequestId ... Duration ... Memory Used` lines + your app's `console.log`/`console.error` output
- CloudWatch filter patterns are **case-sensitive**. Use `"REPORT"` to see Lambda metrics, `"Error"` or `"error"` for app errors, or the exact string your code logs.
- "GET", "POST", or HTTP method names are NOT in Lambda logs — use `amplify_get_access_log` for HTTP-level info
- Zero results is expected if no app errors occurred in the time window

### Rule 2: Buildpad-First — Reinforcement & Details

> The complete forbidden/required table is in the **HARD STOP** rule above. This section provides additional context.

ALL form/input UI components MUST use Buildpad via CLI. Never create `components/ui/*.tsx` or `lib/buildpad/**` files manually.

**Before writing ANY `.tsx` file**, load the `buildpad-reference` background skill (`read_file` on `.github/skills/buildpad-reference/SKILL.md`) to get the full 40+ component catalog. This is NOT optional — it contains the component names, import paths, and usage patterns you need.

| DO NOT Use Directly                                                 | Use Buildpad Instead                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `useForm` (@mantine/form)                                           | `VForm`, `CollectionForm`                                          |
| `<TextInput>`, `<Select>`, `<DatePicker>`, `<Dropzone>`, `<Switch>` | Buildpad `Input`, `SelectDropdown`, `DateTime`, `Upload`, `Toggle` |
| Custom filter builder                                               | `FilterPanel` (field-type-aware, DaaS-compatible JSON output)      |
| Custom `<Table>` or list for collection records                     | `CollectionList` (search, filter, pagination, permissions)         |

Basic Mantine layout (`Stack`, `Group`, `Button`, `Modal`, `Table` for non-collection data) is fine.

### Rule 2b: CollectionList-First for ALL Listing Views

Every page or module that renders a list of collection records **MUST** use `CollectionList`.
Do NOT create custom table/list views with Mantine `<Table>` or raw HTML for collection data.

`CollectionList` provides out of the box:

- Action toolbar (CollectionListToolbar) with search, filter toggle, refresh, bulk actions, and create button
- Integrated `FilterPanel` with active filter count badge
- Permission-gated create button and bulk actions (`requiredPermission` on `BulkAction`)
- Built-in CRUD permission gating (auto-fetches `GET /permissions/me`, disables buttons when not allowed)
- Built-in delete workflow with confirmation modal, API call, and auto-refresh via `enableDelete`
- Pagination with configurable page sizes (10, 25, 50, 100) and item count display (CollectionListFooter)
- Field-type-aware cell rendering (booleans → ✓/✗, dates → formatted, numbers → localized, JSON → badge, UUID → truncated)
- Column sorting, resizing, reordering via VTable composition

CRUD permissions are handled automatically — do not manually gate create/delete buttons or pass permission state. Use `bulkActions` only for custom operations beyond CRUD (e.g., Archive, Export).

### Rule 3: Two-Tier Architecture

```
Frontend App  →  DaaS Backend  →  Supabase
(Next.js)        (REST API)       (PostgreSQL)
```

Frontend connects to DaaS backend for data, NOT directly to Supabase.

### Rule 4: Server-Side Proxy (No CORS)

ALL browser-to-backend calls go through Next.js API proxy routes:

```
❌ Browser → DaaS Backend (CORS!)
❌ Browser → supabase.auth.signIn() (cookie issue)
✅ Browser → /api/auth/login → Supabase Auth
✅ Browser → /api/items/* → DaaS Backend
```

### Rule 5: Backend-First Logic

Use DaaS built-in features for server-side logic instead of implementing in Next.js API routes. **The DaaS platform provides automatic activity/audit logging for ALL item mutations — NEVER build custom audit trail functionality.** See the `daas-platform` background skill's [Built-in DaaS features reference](.github/skills/daas-platform/references/builtin-features.instructions.md) for the complete list.

| Pattern                                 | DaaS Feature                                                | DO NOT Build                                     |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Validate / transform before save        | Runtime Extension (filter hook)                             | Next.js API validation middleware                |
| Audit logging / change tracking         | **Automatic** — `daas_activity` table + `GET /api/activity` | Custom audit tables, logging hooks               |
| Side effects / notifications after save | Runtime Extension (action hook)                             | Custom webhook dispatchers                       |
| Scheduled / recurring background tasks  | Cron Jobs (`mcp_daas_cron`)                                 | `setInterval`, Next.js cron, external schedulers |
| Stateful multi-step workflows           | DaaS Workflows (`create-workflow` skill)                    | Custom status fields, manual state logic         |
| Content versioning / drafts             | DaaS Versions API (`POST /api/versions`)                    | Custom version tables, diff tracking             |
| File upload / storage                   | DaaS Files API (`POST /api/files`)                          | Custom upload endpoints                          |
| Role-based access control               | DaaS Permission system (RBAC)                               | Custom permission tables, `isAdmin` fields       |
| Multi-tenancy / org isolation           | DaaS Scope system (`manage-scope` skill)                    | Custom `tenant_id` columns, manual filtering     |
| Data import/export                      | `POST /api/utils/import`, `GET /api/utils/export`           | Custom CSV/JSON parsers                          |
| Hashing / random tokens                 | `POST /api/utils/hash/*`, `/random/string`                  | Custom bcrypt/crypto code                        |
| Shared reusable server code             | DaaS Custom Services (`mcp_daas_services`)                  | Shared utility files for server-side logic       |

### Rule 6: Phased Development

Never build entire apps at once. Follow phases 0-5: Foundation → Data → Core UI → Business Logic → Relations → Polish.

### Rule 7: Tests & Docs Required

Every implementation must include Playwright tests and documentation updates.

### Rule 8: Execute, Don't Explain

Use `run_in_terminal` to execute CLI commands. Do NOT just tell the user what to run.

### Rule 9: Git repository & CI/CD (AWS Amplify)

- The starter repository is delivered as a valid Git working directory with `origin` configured when the project has git information. The initial local branch created by the starter generator is `temporary-local`. Verify with `git remote -v` and `git branch`.
- This repository is integrated with **AWS Amplify** — pushes to the `main` branch trigger Amplify to build and deploy the Next.js app. A build spec (`amplify.yml`) is included in the template.
- Git best practices (enforced by the platform):
  - Always develop in a feature branch (do not commit directly to `main`).
  - Pull/rebase/merge `main` into your branch frequently to reduce merge conflicts.
  - Validate locally **before** merging to `main`: `pnpm install && pnpm build && pnpm test` and run `pnpm dev` to smoke-test the app.
  - Use PRs and require CI/build checks before merging to `main`.
- Agent actions when dealing with starter repos or PRs:
  - Check for `.git/`, `git remote -v`, and `amplify.yml` in the workspace.
  - Run local build/tests and report failures with precise remediation steps.
  - Remind the user that the remote includes a masked/credentialed URL for initial setup and that only `main` pushes trigger Amplify deploys.

### Rule 10: External OAuth via Next.js Proxy (Enforced)

When adding SSO/OAuth with external identity providers (Azure AD, Okta, Auth0, Google, custom OIDC):

- **Always use Next.js as OAuth client** (not Supabase built-in OAuth)
- Supabase is self-hosted without accessible deployment configuration
- Use `/add-external-oauth` skill for implementation

| DO NOT Do                              | DO This Instead                                  |
| -------------------------------------- | ------------------------------------------------ |
| Configure OAuth in Supabase dashboard  | Use `lib/oauth/` with Next.js API routes         |
| Call `supabase.auth.signInWithOAuth()` | Redirect to `/api/auth/oauth/[provider]`         |
| Manually set `sb-access-token` cookies | Use `supabase.auth.setSession()` from SSR client |

Key implementation details:

- Extract claims from ALL token sources (access_token, id_token, userinfo endpoint)
- Use `supabase.auth.setSession()` to set cookies (not manual cookie setting)
- Check multiple claim names for email (`email`, `preferred_username`, `upn`, etc.)
- After successful login the callback stores an `oauth_provider` httpOnly cookie

### Rule 11: DaaS CORS Must Use Explicit Origins (Never Wildcard)

The Buildpad `daas-context.tsx` sends `credentials: 'include'` on every `fetch` call. Browsers **block** responses that carry `Access-Control-Allow-Origin: *` when credentials mode is `include` (Fetch spec). The DaaS platform ships with `cors_origins: ["*"]` as its default — **this is incompatible** and will silently break every direct DaaS call from the browser.

**When to apply:** Immediately after creating a new DaaS project, before wiring any frontend.

**Fix — always run this via `mcp_daas_cors-settings` on every new project:**

```json
{
  "action": "update",
  "cors_origins": [
    "http://localhost:3000",
    "http://localhost:3001",
    "<mainAmplifyUrl from get_project_detail>"
  ],
  "cors_allow_credentials": true,
  "cors_max_age": 0
}
```

**Rules:**

- `cors_origins` must list every concrete origin the app is served from (local dev ports + all Amplify URLs). Use `get_project_detail` to get the Amplify URL — never guess.
- `cors_allow_credentials` must be `true` whenever the frontend uses cookies or credentialed fetch.
- `cors_max_age: 0` should be set when changing CORS to immediately bust the browser's cached preflight. Can be raised back to `600` after.
- **Never** ship or leave `cors_origins: ["*"]` when `credentials: 'include'` is in use.

**Downstream symptoms of this misconfiguration** (all caused by the preflight being rejected before any JS sees it):

- Scope switcher shows no tenants (401 on `/api/scope/available`)
- `isAdmin` always `false` → admin UI links hidden, access denied pages shown
- All Buildpad components fail silently with empty data

---

### Rule 10b: IdP Single Logout (SLO) — Built-in

The logout route at `app/api/auth/logout/route.ts` performs **IdP Single Logout** automatically when the user was signed in via an external OAuth provider.

**How it works:**

1. `app/api/auth/callback/route.ts` writes an `oauth_provider` httpOnly cookie on successful OAuth login
2. `POST /api/auth/logout` reads that cookie, signs out of Supabase, then returns `{ data: { message, idpLogoutUrl } }` — callers **MUST** redirect the browser to `idpLogoutUrl` if it is non-null
3. `GET /api/auth/logout` performs a full server-side redirect chain to the IdP end-session endpoint (use this as an `<a href>` for automatic SLO)

**Provider logout endpoints (built into `lib/oauth/config.ts`):**

| Provider | End-session endpoint                                                           |
| -------- | ------------------------------------------------------------------------------ |
| Azure AD | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/logout`                |
| Okta     | `https://{domain}/oauth2/default/v1/logout`                                    |
| Auth0    | `https://{domain}/v2/logout` (uses `returnTo` param)                           |
| Google   | None by default — set `GOOGLE_LOGOUT_URL` env var to override                  |
| Generic  | **Must** set `OAUTH_LOGOUT_URL` (and optionally `OAUTH_LOGOUT_REDIRECT_PARAM`) |

`buildLogoutUrl(config, postLogoutUri)` in `lib/oauth/config.ts` constructs the full end-session URL. Always import it from `@/lib/oauth/config` (or `@/lib/oauth`).

**DO NOT** skip the `idpLogoutUrl` redirect in POST callers — without it the user is only signed out of the app but the IdP session persists, allowing silent re-login.

**Finding the end-session endpoint for a generic provider:**
Fetch the OIDC discovery document at `{OAUTH_ISSUER}/.well-known/openid-configuration` and read the `end_session_endpoint` field. Set that value as `OAUTH_LOGOUT_URL` in `.env.local`. Without this, `buildLogoutUrl()` returns `null` and SLO silently does not fire.

```bash
curl https://your-idp.example.com/.well-known/openid-configuration | grep end_session_endpoint
```

---

### Rule 12: Spec-Driven Development — Buildpad Install Is a Planned Task

When generating spec artifacts (`requirements.md`, `design.md`, `tasks.md` under `.kiro/specs/`) or any implementation plan, Buildpad UI component installation MUST appear as an explicit, ordered step — never an assumption.

- **`design.md`** — In the UI/architecture section, name every Buildpad component the design uses (`CollectionList`, `VForm`, `Input`, `SelectDropdown`, etc.) AND state the exact `npx @buildpad/cli@latest` command that installs them.
- **`tasks.md`** — "Install Buildpad UI components" MUST be the first task (or the first task of the UI checkpoint). Every later task that builds a page/form/list and imports from `@/components/ui/*` MUST list this install task as a dependency.
- **Which command (conditional):**

| Situation                                   | Command                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| New project, no `buildpad.json` yet          | `npx @buildpad/cli@latest bootstrap --cwd <project>` — installs all 40+ components + deps  |
| Feature in an already-bootstrapped project   | `npx @buildpad/cli@latest add <components from design.md> --cwd <project>`                 |

- Buildpad components only exist at `@/components/ui/*` **after** the CLI runs. A `tasks.md` that references `CollectionList` with no preceding install task is incomplete.

> **Why this exists:** Kiro's native Specs feature generates `design.md`/`tasks.md` from this steering file alone — it does NOT auto-load Agent Skills (`add-buildpad`, `create-project`). Without this rule the generated plan jumps straight to "build the list page", the components are never installed, and the Buildpad-First rule above silently fails (imports break, or raw Mantine is used). See the `spec-driven-development` and `planning-and-task-breakdown` skills for the full spec/task templates.

---

## Available Skills

### User-Invokable (slash commands)

| Skill                          | Description                                                                                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/create-project`              | Bootstrap a new DaaS project (Phase 0)                                                                                                                                                                                                                                           |
| `/create-feature`              | Plan and implement a complete feature                                                                                                                                                                                                                                            |
| `/create-collection`           | Create DaaS collection with fields, API, UI, tests                                                                                                                                                                                                                               |
| `/create-api-route`            | DaaS-compatible REST proxy routes                                                                                                                                                                                                                                                |
| `/create-component`            | Check Buildpad first, then create if needed                                                                                                                                                                                                                                      |
| `/create-migration`            | Supabase PostgreSQL migrations with RLS                                                                                                                                                                                                                                          |
| `/create-workflow`             | Workflow state machines, versioning, and multi-stage approvals                                                                                                                                                                                                                   |
| `/create-cron`                 | Scheduled background tasks (cron jobs) with sandbox code and MCP management                                                                                                                                                                                                      |
| `/create-rbac`                 | Roles, policies, permissions via MCP                                                                                                                                                                                                                                             |
| `/create-custom-permissions`   | Application-level boolean capability flags (e.g. `MyApp.Dashboard.TaskWidget: true`) that coexist with DaaS data-access permissions and share the same Policy/Role/User assignment chain. Covers DB column via MCP, server-side enforcement, client hooks, and Policy editor UI. |
| `/create-tests`                | Playwright E2E and Vitest unit tests                                                                                                                                                                                                                                             |
| `/add-buildpad`                | Add Buildpad components via CLI (Copy & Own)                                                                                                                                                                                                                                     |
| `/manage-scope`                | Multi-tenancy, org/dept partitioning, regional hierarchies using DaaS-native scope system. Covers full setup and client-side integration.                                                                                                                                        |
| `/add-microfrontend`           | Iframe-based micro-frontend composition with shared DaaS, auth & URL syncing. Auto-discovers project context and Amplify URLs via `get_project_detail`                                                                                                                           |
| `/add-microservice`            | Multi-app microservices sharing a single DaaS backend via iframe composition. Auto-discovers project context and Amplify URLs via `get_project_detail`                                                                                                                           |
| `/start-phase`                 | Begin/continue a development phase                                                                                                                                                                                                                                               |
| `/review-code`                 | Code review for quality, security, a11y, and DaaS/Buildpad compliance                                                                                                                                                                                                            |
| `/generate-docs`               | Generate/update documentation                                                                                                                                                                                                                                                    |
| `/idea-refine`                 | Refine vague ideas into concrete proposals with structured divergent/convergent thinking                                                                                                                                                                                         |
| `/spec-driven-development`     | Write specifications (PRD) before code — objectives, structure, testing, boundaries                                                                                                                                                                                              |
| `/planning-and-task-breakdown` | Decompose specs into small, verifiable tasks with acceptance criteria and dependency ordering                                                                                                                                                                                    |

| `/amplify-env-vars` | How to expose Amplify environment variables to Next.js API routes. Documents amplify.yml and Amplify Console setup. |
| `/create-service` | Create and manage DaaS custom services for reusable code shared between extensions and cron jobs. Define utility libraries, API wrappers, validators, and formatters that can be injected via `services.custom('name')`. Use when you need shared logic across hooks/crons, want to avoid code duplication, or need testable service modules. |

### Background (auto-loaded by model)

| Skill                          | Description                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `daas-platform`                | Architecture, MCP tools, API patterns                                             |
| `authentication-proxy`         | Auth proxy pattern reference                                                      |
| `buildpad-reference`           | 40+ component catalog, hooks, services                                            |
| `hooks-extensions`             | Runtime filter/action hooks, cron jobs, utilities API                             |
| `relational-permissions`       | Permission enforcement on junction/child collections for nested relational writes |
| `security-and-hardening`       | OWASP-aligned security boundaries, input validation, secret management            |
| `performance-optimization`     | Core Web Vitals, profiling workflow, Next.js/DaaS performance patterns            |
| `debugging-and-error-recovery` | Systematic debugging, DaaS-specific issue triage, error recovery                  |
| `git-workflow-and-versioning`  | Trunk-based development, Amplify CI/CD, commit discipline                         |
| `incremental-implementation`   | Thin vertical slices, risk-first delivery, DaaS phase alignment                   |
| `code-simplification`          | Reduce complexity, inline over-abstractions, Chesterton's Fence                   |
| `context-engineering`          | Feed agents the right context — skills, MCP, project files                        |

### Reference Checklists

Pre-flight checklists available in `.github/references/`:

| Reference                    | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `accessibility-checklist.md` | WCAG 2.1 AA compliance — keyboard, screen reader, visual, forms |
| `security-checklist.md`      | OWASP Top 10, auth, input validation, DaaS proxy pattern        |
| `performance-checklist.md`   | Core Web Vitals, frontend/backend optimization, budgets         |
| `testing-patterns.md`        | AAA structure, mocking, React/API/E2E patterns, anti-patterns   |

### Agent Personas

Specialized review personas available in `.github/agents/`:

| Agent                 | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `code-reviewer.md`    | Senior Staff Engineer — five-axis review with DaaS compliance      |
| `test-engineer.md`    | QA Engineer — Prove-It pattern, coverage analysis, DaaS test setup |
| `security-auditor.md` | Security Engineer — six-area audit with severity classification    |

---

## Technology Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript 5.x
- **UI**: Mantine v8 + Buildpad UI (Copy & Own via CLI)
- **Backend**: DaaS (DaaS-compatible REST API)
- **Auth**: Supabase Auth via server-side proxy
- **Testing**: Playwright (E2E) + Vitest (unit)
- **Design**: Token-based theming (`--ds-*` CSS custom properties)

## Code Standards

- **TypeScript**: Strict mode, interfaces over types, `as const` for constants
- **React**: Server Components by default, `'use client'` only when needed
- **Naming**: PascalCase components, camelCase hooks (`use` prefix), PascalCase services
- **Files**: One component per file, co-locate tests, index files for exports
- **Imports**: Always `@/components/ui/` and `@/lib/buildpad/`, never `@buildpad/*`

## Environment Variables (`.env.local`)

```env
# Supabase Configuration (for Authentication)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.buildpad-supabase.xtremax.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Buildpad DaaS Configuration (for Data as a Service)
NEXT_PUBLIC_BUILDPAD_DAAS_URL=https://your-project.buildpad-daas.xtremax.com
```

Always read `.env.local` for actual configured values.

## Application URL Config (`config/app-urls.ts`)

For microservice/microfrontend architectures, **application URLs** (Main App URL, microservice Amplify URLs) are stored in a committed TypeScript config file — NOT as environment variables. This ensures URLs are available at AWS Amplify build time without manual env var setup.

```typescript
// config/app-urls.ts — committed to git, auto-generated from get_project_detail
export const MAIN_APP_URL =
  process.env.NEXT_PUBLIC_HOST_ORIGIN ||
  "https://main.d1234abcde.amplifyapp.com";

export const MICROSERVICE_URLS = {
  "users-app":
    process.env.NEXT_PUBLIC_USERS_APP_URL ||
    "https://main.d5678fghij.amplifyapp.com",
} as const;
```

> **⚠️ CRITICAL — `config/app-urls.ts` Generation Rules:**
>
> 1. The **hardcoded string literal** (right side of `||`) MUST be the **actual deployed Amplify URL** resolved from `get_project_detail`. NEVER use `localhost`, `127.0.0.1`, or any placeholder URL as the hardcoded default.
> 2. The **env var** (left side of `||`) is a **single** `process.env.NEXT_PUBLIC_*` override for local development. NEVER chain multiple env vars.
> 3. Each export line must have **exactly one** `process.env.*` and **exactly one** hardcoded URL string.
>
> ```typescript
> // ❌ WRONG — localhost as default, chained env vars
> process.env.NEXT_PUBLIC_HOST_ORIGIN || process.env.NEXT_PUBLIC_HOST_ORIGIN_MAIN || 'http://localhost:3000'
>
> // ❌ WRONG — localhost as default
> 'users-app': process.env.NEXT_PUBLIC_USERS_APP_URL || 'http://localhost:3001',
>
> // ✅ CORRECT — actual Amplify URL as default, single env var override
> process.env.NEXT_PUBLIC_HOST_ORIGIN || 'https://main.d1234abcde.amplifyapp.com'
> 'users-app': process.env.NEXT_PUBLIC_USERS_APP_URL || 'https://main.d5678fghij.amplifyapp.com',
> ```

| Config Type                             | Where                | Committed? | Amplify Console?               |
| --------------------------------------- | -------------------- | ---------- | ------------------------------ |
| Infrastructure secrets (Supabase, DaaS) | `.env.local`         | No         | Yes (set once at app creation) |
| App URLs (Main App, microservices)      | `config/app-urls.ts` | Yes        | No (baked into code)           |
