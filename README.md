# Buildpad Copilot

A **Rapid Application Development (RAD) platform** with AI-assisted development. This boilerplate provides **Agent Skills**, **steering files**, reference documentation, and templates to accelerate building DaaS (Data-as-a-Service) applications.

Supports both **VS Code (GitHub Copilot)** and **Kiro IDE** out of the box.

## 🚀 Quick Start

### VS Code + GitHub Copilot

1. **Open this project in VS Code** with GitHub Copilot enabled.

2. **Open GitHub Copilot Chat** (⌃⌘I on macOS / Ctrl+Shift+I on Windows/Linux) and start prompting:

   ```
   /create-project Design a task management application with teams and projects
   ```

   The built-in **system prompt and agent skills** will automatically guide you through prerequisites, project bootstrapping, DaaS backend setup, and component installation.

> **Tip:** Type `/` in Copilot Chat to see all available skills, or just describe what you want to build and the agent will pick the right skill for you.

### Kiro IDE

1. **Open this project in Kiro IDE.**

2. Kiro automatically loads **steering files** from `.kiro/steering/` and discovers **skills** from `.kiro/skills/`.

3. **Open Kiro Chat** and start prompting:

   ```
   /create-project Design a task management application with teams and projects
   ```

4. Configure your DaaS backend URL and token as environment variables (see `.kiro/settings/mcp.json`):
   ```bash
   export DAAS_ACCESS_TOKEN="your-token-here"
   ```

> **Tip:** Type `/` in Kiro Chat to see all available skills as slash commands. Kiro also activates skills automatically based on your request context.

## 🏗️ Architecture

Generated applications use a **two-tier architecture**:

```
┌─────────────────┐      ┌─────────────────────────┐      ┌──────────────┐
│  Frontend App   │ ──── │  DaaS   │ ──── │   Supabase   │
│  (Generated)    │ API  │  (DaaS Backend)         │      │  (Database)  │
└─────────────────┘      └─────────────────────────┘      └──────────────┘
```

- **Frontend App** - Next.js 16, Mantine v8, TypeScript 5.x
- **DaaS Backend** - Buildpad DaaS (REST API server)
- **Database** - Supabase PostgreSQL with Row Level Security

## 📁 What's Included

```
.github/                               # GitHub Copilot (VS Code) configuration
├── copilot-instructions.md            # Core rules & skill index
├── skills/                            # Agent Skills (28 total) — SHARED source
│   ├── create-project/                # /create-project — Bootstrap new DaaS project
│   │   ├── SKILL.md
│   │   └── references/                # Detailed reference docs
│   ├── create-feature/                # /create-feature — Plan & implement a feature
│   ├── create-collection/             # /create-collection — Collection + API + UI + tests
│   ├── create-api-route/              # /create-api-route — REST proxy routes
│   ├── create-component/              # /create-component — Buildpad-first check
│   ├── create-migration/              # /create-migration — Supabase migrations + RLS
│   ├── create-workflow/               # /create-workflow — Workflow state machines
│   ├── create-rbac/                   # /create-rbac — Roles & permissions via MCP
│   ├── create-tests/                  # /create-tests — Playwright E2E & Vitest
│   ├── add-buildpad/                  # /add-buildpad — Install components via CLI
│   ├── add-multitenancy/              # /add-multitenancy — Tenant isolation setup
│   ├── start-phase/                   # /start-phase — Begin a development phase
│   ├── review-code/                   # /review-code — Multi-dimensional code review
│   ├── generate-docs/                 # /generate-docs — Generate/update documentation
│   ├── idea-refine/                   # /idea-refine — Divergent/convergent thinking
│   ├── spec-driven-development/       # /spec-driven-development — PRD before code
│   ├── planning-and-task-breakdown/   # /planning-and-task-breakdown — Task decomposition
│   ├── daas-platform/                 # (background) Architecture & MCP tools
│   ├── authentication-proxy/          # (background) Auth proxy pattern
│   ├── buildpad-reference/            # (background) 40+ component catalog
│   ├── hooks-extensions/              # (background) Runtime extensions & hooks
│   ├── security-and-hardening/        # (background) OWASP security boundaries
│   ├── performance-optimization/      # (background) Core Web Vitals & profiling
│   ├── debugging-and-error-recovery/  # (background) Systematic debugging
│   ├── git-workflow-and-versioning/   # (background) Trunk-based dev & CI/CD
│   ├── incremental-implementation/    # (background) Thin vertical slices
│   ├── code-simplification/           # (background) Reduce complexity
│   └── context-engineering/           # (background) Agent context management
├── references/                        # Pre-flight checklists
│   ├── accessibility-checklist.md     # WCAG 2.1 AA compliance
│   ├── security-checklist.md          # OWASP Top 10 & DaaS security
│   ├── performance-checklist.md       # Core Web Vitals & optimization
│   └── testing-patterns.md           # AAA, mocking, E2E patterns
├── agents/                            # Specialized review personas
│   ├── code-reviewer.md              # Senior Staff Engineer review
│   ├── test-engineer.md              # QA Engineer — Prove-It pattern
│   └── security-auditor.md           # Security Engineer audit
└── templates/                         # Project templates
    ├── minimal/                       # Simple apps, prototypes
    ├── standard/                      # Business apps, admin panels
    └── enterprise/                    # Complex systems

.kiro/                                 # Kiro IDE configuration
├── steering/                          # Persistent project knowledge
│   ├── product.md                     # Product overview (always included)
│   ├── tech.md                        # Technology stack (always included)
│   ├── structure.md                   # Project structure & conventions (always included)
│   ├── api-standards.md               # API rules (included for api/** files)
│   └── component-standards.md         # Component rules (included for *.tsx files)
├── skills/                            # Symlinks to .github/skills/* (18 skills)
│   ├── create-project/ → .github/skills/create-project/
│   ├── create-feature/ → .github/skills/create-feature/
│   └── ...                            # All 18 skills symlinked
└── settings/
    └── mcp.json                       # MCP server configuration for Kiro

.vscode/                               # VS Code configuration
├── mcp.json                           # MCP server configuration for VS Code
├── settings.json                      # VS Code settings
├── launch.json                        # Debug configurations
└── extensions.json                    # Recommended extensions
```

## 📋 Features

**Core Methodology:**

- **Phased Development** - All projects built in 6 phases (Foundation → Data → UI → Logic → Relations → Polish)
- **Phase Tracking** - `PHASES.md` file tracks progress and exit criteria per phase
- **Tests Per Phase** - Tests are part of each phase, not a separate activity
- **Incremental Delivery** - Working software at each phase gate

### CI/CD & Deployment (AWS Amplify)

- **Amplify build spec included** — a ready-to-use `amplify.yml` is provided in the `project-starter` template for pnpm-based Next.js apps.
- **Build steps** — `preBuild: corepack pnpm install`, `build: pnpm build`.
- **Artifacts** — `.next` is used as the deployment artifact (Amplify `baseDirectory`).
- **Usage** — Connect your Git repo in AWS Amplify Console; Amplify will use `amplify.yml` for continuous deployments. Commit the `amplify.yml` at the repository root or template location when bootstrapping.

**Latest Features:**

- **Aggregate Functions** - DaaS aggregate API with count, sum, avg, min, max operations, groupBy support, and permission-aware filtering
- **CollectionList Sub-Components** - Refactored into composable sub-components: CollectionListToolbar, CollectionListFooter, BulkActionsBar, DeleteConfirmModal, BottomPagination
- **Built-in Delete Workflow** - `enableDelete` prop with confirmation modal, permission gating, and `onDeleteSuccess` callback
- **Archive Filtering** - Archive filter dropdown (all/archived/unarchived) via `archiveField`, `archiveValue`, `unarchiveValue` props
- **Field-Type Cell Rendering** - Booleans → ✓/✗, dates → formatted, numbers → localized, JSON → badge, UUID → truncated with tooltip
- **npm Published Tools** - CLI (`@buildpad/cli`) and MCP (`@buildpad/mcp`) are on npm — use via `npx` without local clone
- **Bootstrap Command** - Single `npx @buildpad/cli@latest bootstrap` creates a complete project (Next.js + 40+ components + deps)
- **VTable Dynamic Tables** - Dynamic table component with sorting, selection, drag-drop, header context menus, and DaaS Playground
- **FilterPanel** - Field-type-aware filter builder producing DaaS-compatible JSON with AND/OR logic, nested groups, panel/inline/collapsible modes
- **CollectionList Full-Featured Toolbar** - Integrated action toolbar with search, FilterPanel toggle (badge count), permission-gated create button, bulk actions with `requiredPermission`, and DaaS-style pagination (10/25/50/100)
- **CollectionList → VTable Composition** - CollectionList now composes VTable internally for column sorting, resizing, reordering, and header context menus
- **Token-Based Design System** - CSS custom properties (`--ds-*` prefix) with Mantine theme mapping
- **Server-Side Proxy Auth** - All auth and API calls go through Next.js proxy routes (no CORS)
- **Multitenancy** - Tenant-scoped data isolation with dynamic permission filters and tenant selector UI
- **RBAC Setup** - Role-based access control with permission enforcement at API and UI levels
- **Content Versioning** - Create and manage multiple versions of items with delta-based updates
- **Workflow State Machines** - Define approval workflows with states, commands, and permissions
- **Version-Aware Workflows** - Track versions through workflow states independently
- **Automatic Instance Creation** - Workflows auto-create when items/versions match assignment rules
- **Policy-Based Transitions** - Require specific roles/permissions for state transitions
- **Transition History** - Complete audit trail of all workflow transitions
- **Buildpad Component Library** - 40+ DaaS-compatible field interfaces with hooks integration
- **VForm Dynamic Forms** - Dynamic form system with permission enforcement
- **Authentication Hooks** - `useAuth` and `usePermissions` for DaaS-compatible auth state
- **DaaSProvider & API Utilities** - Direct DaaS API access for Storybook and testing
- **Copy & Own Distribution** - Components installed as source code via CLI (`npx @buildpad/cli@latest`)
- **Two-Tier Testing Strategy** - Storybook tests (isolated) + DaaS E2E tests (integration)
- **VForm DaaS Playground** - Test VForm with real DaaS schemas in Storybook
- **CLI Auto-Fix** - `buildpad fix` auto-repairs untransformed imports, broken paths, missing CSS
- **Component Updates** - `buildpad outdated` checks for newer component versions
- **Auto-Generated Documentation** - Documentation is created/updated with every code change
- **E2E Testing Prompts** - Dedicated Playwright E2E test generation
- **Agent Skills** - Migrated from agents/prompts/instructions to the open [Agent Skills](https://agentskills.io) standard with 28 skills (17 slash commands + 11 background), 4 reference checklists, and 3 agent personas
- **Dual IDE Support** - Works with both VS Code (GitHub Copilot) and Kiro IDE via shared Agent Skills, Kiro steering files, and per-IDE MCP configuration

## 🔄 Phased Development

All generated applications follow a **mandatory phased development approach**:

| Phase | Name            | Focus                                    | Exit Criteria              |
| ----- | --------------- | ---------------------------------------- | -------------------------- |
| **0** | Foundation      | Project setup, auth, test infrastructure | App runs, tests configured |
| **1** | Data Foundation | Schema, API routes, types                | All APIs tested            |
| **2** | Core UI         | List/detail pages, forms, navigation     | Pages render, tests pass   |
| **3** | Business Logic  | Validation, workflows, permissions       | Rules enforced             |
| **4** | Relations       | M2O, M2M, O2M, files, search             | Relations work             |
| **5** | Polish          | Errors, performance, a11y, docs, E2E     | Production ready           |

### Phase Rules

1. **Complete each phase before moving to the next**
2. **Tests are part of each phase, not separate**
3. **Document as you go, not at the end**
4. **Validate with phase gate checklist**
5. **Track progress in `PHASES.md`**

### Using the `/start-phase` Prompt

```
User: /start-phase
> Phase Number: 1
> Context: Building a task management app, Phase 0 complete
```

Use `/start-phase` skill for complete methodology. See `.github/skills/start-phase/` for details.

## 📝 Documentation System

This project uses a **single-source-of-truth** approach to documentation:

### DaaS API Documentation (Authoritative)

**The DaaS backend (`DaaS`) is the single source of truth for API documentation.**

Access API documentation through:

- **MCP Server** - Query the `daas` MCP server for live schema and API information
- **DaaS Docs** - See `DaaS/docs/` for complete API reference

```
# Query DaaS MCP in Copilot Chat:
"List all collections"
"Show schema for articles collection"
"What fields does users have?"
```

### Project-Specific Documentation

```
docs/
├── README.md              # Documentation index (with DaaS links)
├── ARCHITECTURE.md        # This project's architecture
├── COMPONENTS.md          # Project-specific components
├── HOOKS.md               # Custom hooks
├── COLLECTIONS.md         # Project data models
├── WORKFLOWS.md           # Project workflow definitions
├── CHANGELOG.md           # Change history
├── components/            # Component docs
├── features/              # Feature docs
├── guides/                # How-to guides
└── schemas/               # Project JSON schemas
```

> **Note:** API documentation is NOT duplicated here. Use the DaaS MCP server or `DaaS/docs/` for API reference.

### Documentation Is Required

Every implementation automatically includes:

- Component documentation with props and examples
- Schema files for data models
- Changelog entries for all changes

Use `/generate-docs` prompt to generate documentation for existing code.

## 🤖 Using Skills

Type `/` in Copilot Chat to invoke a skill, or let the model auto-load background skills as needed.

### Slash Commands (User-Invokable)

| Skill                          | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `/create-project`              | Bootstrap a new DaaS project (Phase 0)        |
| `/create-feature`              | Plan and implement a complete feature         |
| `/create-collection`           | Create collection with fields, API, UI, tests |
| `/create-api-route`            | DaaS-compatible REST proxy routes             |
| `/create-component`            | Check Buildpad first, then create if needed   |
| `/create-migration`            | Supabase PostgreSQL migrations with RLS       |
| `/create-workflow`             | DaaS workflow state machines                  |
| `/create-rbac`                 | Roles, policies, permissions via MCP          |
| `/create-tests`                | Playwright E2E and Vitest unit tests          |
| `/add-buildpad`                | Install Buildpad components via CLI           |
| `/add-multitenancy`            | Tenant isolation setup                        |
| `/start-phase`                 | Begin/continue a development phase            |
| `/review-code`                 | Multi-dimensional code review                 |
| `/generate-docs`               | Generate/update documentation                 |
| `/idea-refine`                 | Refine vague ideas into concrete proposals    |
| `/spec-driven-development`     | Write specs/PRD before code                   |
| `/planning-and-task-breakdown` | Decompose specs into verifiable tasks         |

### Background Skills (Auto-Loaded)

| Skill                          | Description                                        |
| ------------------------------ | -------------------------------------------------- |
| `daas-platform`                | Architecture, MCP tools, API patterns              |
| `authentication-proxy`         | Auth proxy pattern reference                       |
| `buildpad-reference`           | 40+ component catalog, hooks, services             |
| `hooks-extensions`             | Runtime extensions, special fields                 |
| `security-and-hardening`       | OWASP security boundaries, input validation        |
| `performance-optimization`     | Core Web Vitals, profiling, Next.js/DaaS patterns  |
| `debugging-and-error-recovery` | Systematic debugging, DaaS issue triage            |
| `git-workflow-and-versioning`  | Trunk-based development, Amplify CI/CD             |
| `incremental-implementation`   | Thin vertical slices, risk-first delivery          |
| `code-simplification`          | Reduce complexity, inline over-abstractions        |
| `context-engineering`          | Feed agents the right context — skills, MCP, files |

### Reference Checklists

Pre-flight checklists in `.github/references/` for quick validation:

| Reference                    | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `accessibility-checklist.md` | WCAG 2.1 AA — keyboard, screen reader, visual, forms          |
| `security-checklist.md`      | OWASP Top 10, auth, input validation, DaaS proxy pattern      |
| `performance-checklist.md`   | Core Web Vitals, frontend/backend optimization, budgets       |
| `testing-patterns.md`        | AAA structure, mocking, React/API/E2E patterns, anti-patterns |

### Agent Personas

Specialized review personas in `.github/agents/` that can be invoked for focused reviews:

| Agent                 | Description                                                 |
| --------------------- | ----------------------------------------------------------- |
| `code-reviewer.md`    | Senior Staff Engineer — five-axis review + DaaS compliance  |
| `test-engineer.md`    | QA Engineer — Prove-It pattern, coverage analysis           |
| `security-auditor.md` | Security Engineer — six-area audit, severity classification |

## 🎨 Project Templates

Choose based on complexity:

### Minimal

- Basic Next.js + Supabase setup
- Single collection CRUD
- Simple authentication
- **Best for:** Prototypes, learning, simple apps

### Standard

- Full DaaS foundation
- Multiple collections with relations
- Role-based access control (RBAC)
- File management
- **Best for:** Business apps, admin panels

### Enterprise

- Everything in Standard plus:
- Workflow/state machine support
- Versioning and audit trails
- Multitenancy with tenant-scoped data isolation
- **Best for:** Complex enterprise systems

## ⚙️ Environment Variables

Generated apps require these environment variables (auto-generated by Buildpad Platform see https://buildpad-dev.xtremax.com/docs/ai-dev/github-copilot):

```env
# Supabase (for authentication)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.buildpad-supabase.xtremax.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# DaaS Backend (for data operations)
NEXT_PUBLIC_BUILDPAD_DAAS_URL=https://your-project.buildpad-daas.xtremax.com
```

## 🔌 MCP Servers (AI-Assisted Development)

The platform integrates with Model Context Protocol (MCP) servers for AI-assisted development.

**⚠️ IMPORTANT: The DaaS MCP server is the authoritative source for API documentation.**

| Server       | Purpose                | Key Capabilities                                                                    |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------- |
| **daas**     | API & Schema Discovery | Live schema introspection, API documentation, permissions                           |
| **buildpad** | Component Library      | Component discovery, CLI commands, code generation (via `npx @buildpad/mcp@latest`) |

### Buildpad MCP Tools

| Tool                  | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `list_components`     | List all available components with descriptions                 |
| `list_packages`       | List all Buildpad packages with their exports                   |
| `get_component`       | Get source code and details for a component                     |
| `get_install_command` | Get CLI command to install components                           |
| `copy_component`      | Get source code and file structure to manually copy a component |
| `generate_form`       | Generate a CollectionForm for a collection                      |
| `generate_interface`  | Generate a field interface component                            |
| `get_usage_example`   | Get usage examples with local imports                           |
| `get_copy_own_info`   | Get info about the Copy & Own distribution model                |
| `get_rbac_pattern`    | Get RBAC setup patterns (own_items, role_hierarchy, etc.)       |

### DaaS MCP Tools

| Tool            | Description                                       |
| --------------- | ------------------------------------------------- |
| `items`         | CRUD + aggregate operations on collection items   |
| `schema`        | Read collection and field schema                  |
| `collections`   | Create/update/delete database tables (admin)      |
| `fields`        | Create/update/delete table columns (admin)        |
| `relations`     | Manage foreign key relationships                  |
| `files`         | Manage uploaded files and metadata                |
| `folders`       | Manage file folders and organization              |
| `assets`        | Retrieve file content as base64 for AI processing |
| `roles`         | CRUD on role definitions                          |
| `policies`      | CRUD on access policies                           |
| `permissions`   | CRUD on permission rules                          |
| `access`        | Manage access entries linking policies to roles   |
| `extensions`    | CRUD on runtime hooks (filter/action hooks)       |
| `logs`          | Read, search, tail, and clear application logs    |
| `system-prompt` | Load DaaS-specific platform context and knowledge |

### Example MCP Queries

```
# DaaS API queries:
"List all collections"
"Show schema for articles collection"
"What fields does users have?"
"Get permissions for current user"
"Count orders grouped by status"
"Sum amount for completed orders"

# Buildpad queries:
"List all Buildpad components"
"Show me how to use the Input component"
"Generate a CollectionForm for products"
"Get the CLI command to add all components"
```

### Configuration

MCP servers are pre-configured for both IDEs:

#### VS Code (`.vscode/mcp.json`)

```jsonc
{
  "servers": {
    "buildpad": {
      "command": "npx",
      "args": ["-y", "@buildpad/mcp@latest"],
    },
    "daas": {
      "type": "http",
      "url": "https://${input:daas-url}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${input:daas-token}",
      },
    },
  },
  "inputs": [
    {
      "id": "daas-url",
      "type": "promptString",
      "description": "DaaS Backend URL (e.g., localhost:3000)",
      "default": "localhost:3000",
    },
    {
      "id": "daas-token",
      "type": "promptString",
      "description": "DaaS Access Token",
      "password": true,
    },
  ],
}
```

VS Code will prompt for **daas-url** and **daas-token** when MCP servers start.

#### Kiro IDE (`.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "buildpad": {
      "command": "npx",
      "args": ["-y", "@buildpad/mcp@latest"]
    },
    "daas": {
      "url": "https://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer ${DAAS_ACCESS_TOKEN}"
      }
    }
  }
}
```

For Kiro, set environment variables before launching:

```bash
# Set your DaaS access token
export DAAS_ACCESS_TOKEN="your-token-here"
```

Edit `.kiro/settings/mcp.json` to change the DaaS URL if not using localhost:3000.

> **Tip:** Generate a DaaS access token in Users → Edit User → Generate Token.

## 📚 Technology Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript 5.x
- **UI Framework:** Mantine v8 with TipTap extensions for rich text
- **Backend:** Buildpad DaaS (REST API Server)
- **Database:** Supabase PostgreSQL with RLS policies
- **Components:** Buildpad UI Packages (Copy & Own via `npx @buildpad/cli@latest`)
- **AI Integration:** GitHub Copilot (VS Code) + Kiro IDE — both with MCP servers (`@buildpad/mcp` on npm)
- **Testing:** Two-tier strategy - Playwright (Storybook + E2E), Vitest (Unit)
- **Design System:** Token-based CSS custom properties (`--ds-*`) with Mantine theme mapping

## 🧪 Two-Tier Testing Strategy

Buildpad uses a comprehensive testing approach:

| Tier                  | Purpose                    | Auth Required | Command               |
| --------------------- | -------------------------- | ------------- | --------------------- |
| **Tier 1: Storybook** | Isolated component testing | No            | `pnpm storybook:form` |
| **Tier 2: DaaS E2E**  | Full integration testing   | Yes           | `pnpm test:e2e`       |

**Storybook Testing:**

- VForm stories with mocked data for all 40+ interface types
- DaaS Playground story for testing with real API credentials
- No authentication required - fast feedback loop

**DaaS E2E Testing:**

- Real Supabase backend integration
- Authentication and permission testing
- Complete workflow and versioning validation

See `buildpad-ui/docs/TESTING.md` for complete testing guide.

## � Troubleshooting

### Module Not Found Errors

**Type 1: Missing sibling component** - `Can't resolve '../upload'`

```bash
cd /path/to/buildpad-ui
pnpm cli add upload --cwd /path/to/your-project
```

**Type 2: Import not transformed** - `Can't resolve '@buildpad/services'`

```bash
# Reinitialize and reinstall
cd /path/to/buildpad-ui
pnpm cli init --cwd /path/to/your-project
pnpm cli add list-o2m --overwrite --cwd /path/to/your-project
```

### Component Dependency Matrix

| Component                                      | Required Dependencies                                     |
| ---------------------------------------------- | --------------------------------------------------------- |
| `file-image`, `file`, `files`                  | `upload`                                                  |
| `list-m2m`, `list-m2o`, `list-o2m`, `list-m2a` | `hooks`, `services`, `collection-form`, `collection-list` |
| `vform`                                        | All 32+ interface components                              |
| `collection-form`                              | `vform` + all interfaces                                  |

### Prevention

- **ALWAYS** use CLI commands, never manually copy component files
- Run `pnpm build` after adding components to catch errors early
- Use `pnpm cli status` to verify installations
- Install all components upfront during Phase 0 to avoid mid-development issues

See `.github/skills/add-buildpad/` for complete troubleshooting guide.

## 🖥️ IDE Support

This template works out of the box with both **VS Code (GitHub Copilot)** and **Kiro IDE**.

### How It Works

| Feature              | VS Code (Copilot)                 | Kiro IDE                                                  |
| -------------------- | --------------------------------- | --------------------------------------------------------- |
| **System prompt**    | `.github/copilot-instructions.md` | `.kiro/steering/*.md` (5 steering files)                  |
| **Agent Skills**     | `.github/skills/` (28 skills)     | `.kiro/skills/` (symlinks to `.github/skills/`)           |
| **MCP config**       | `.vscode/mcp.json`                | `.kiro/settings/mcp.json`                                 |
| **Skill invocation** | Type `/` in Copilot Chat          | Type `/` in Kiro Chat                                     |
| **Auto-activation**  | Background skills auto-load       | Skills match by description; steering has inclusion modes |

### Kiro Steering Files

Kiro uses **steering files** (`.kiro/steering/`) to provide persistent workspace knowledge. These are organized by inclusion mode:

| File                     | Mode                  | Purpose                                    |
| ------------------------ | --------------------- | ------------------------------------------ |
| `product.md`             | Always                | Product overview, skills index             |
| `tech.md`                | Always                | Technology stack, constraints              |
| `structure.md`           | Always                | Project structure, conventions, core rules |
| `api-standards.md`       | File match (`api/**`) | API proxy route standards                  |
| `component-standards.md` | File match (`*.tsx`)  | Component standards, Buildpad-first rule   |

### Shared Skills (Agent Skills Standard)

Both IDEs use the same skills following the [Agent Skills](https://agentskills.io) standard. Skills are authored in `.github/skills/` and symlinked to `.kiro/skills/` to avoid duplication. The project also includes reference checklists (`.github/references/`) and agent personas (`.github/agents/`) for focused reviews.

To regenerate symlinks (e.g., after adding a new skill):

```bash
for skill in .github/skills/*/; do
  ln -sfn "../../.github/skills/$(basename "$skill")" ".kiro/skills/$(basename "$skill")"
done
```

### Windows Compatibility

On Windows, Git may not preserve symlinks by default. If `.kiro/skills/` symlinks don't work:

1. **Option A:** Enable symlinks in Git: `git config core.symlinks true` and re-clone
2. **Option B:** Copy instead of symlink:
   ```powershell
   Get-ChildItem .github\skills -Directory | ForEach-Object {
     Copy-Item -Recurse $_.FullName ".kiro\skills\$($_.Name)"
   }
   ```

## �🔗 Related Projects

- [Buildpad](https://buildpad-dev.xtremax.com/docs) - Rapid Application Development Platform
- [buildpad-ui](https://buildpad-ui.xtremax.com) - Component library (use via `npx @buildpad/cli@latest` or local clone)

---

**Last Updated:** July 2025

## 📄 License

MIT
