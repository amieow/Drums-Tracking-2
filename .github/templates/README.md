# DaaS Project Templates

**Configuration-only templates.** All code generation uses `buildpad-ui` CLI.

## 🔴 CRITICAL: No Code Templates Here

This folder contains **metadata-only** template definitions:

- `template.json` files define features, environment variables, and structure hints
- **NO `.ts`/`.tsx` code files** - CLI handles all code generation
- **NO API route templates** - CLI provides these via `buildpad add`
- **NO type templates** - CLI installs types from `packages/types`

## How It Works

```
┌────────────────────┐     References     ┌──────────────────────────┐
│  buildpad-copilot│  ─────────────────▶│  buildpad-ui  │
│  (templates/)      │                    │  (CLI + Source)          │
├────────────────────┤                    ├──────────────────────────┤
│ minimal/           │                    │ packages/cli/            │
│   template.json    │                    │   - buildpad init      │
│ standard/          │                    │   - buildpad add       │
│   template.json    │                    │   - buildpad validate  │
│ enterprise/        │                    │ packages/ui-interfaces/  │
│   template.json    │                    │ packages/ui-form/        │
└────────────────────┘                    │ packages/hooks/          │
                                          │ packages/services/       │
                                          │ packages/types/          │
                                          └──────────────────────────┘
```

## Template Types

### Minimal (`minimal/template.json`)

- Basic Next.js + Supabase setup
- Single collection CRUD
- Simple authentication
- Best for: Small apps, prototypes, learning

### Standard (`standard/template.json`)

- Full DaaS foundation
- Multiple collections with relations
- Role-based access control
- File management
- Best for: Business applications, admin panels

### Enterprise (`enterprise/template.json`)

- Everything in Standard plus:
- Workflow/state machine support
- Versioning and audit trails
- Multi-tenant support
- Advanced permissions
- Best for: Complex enterprise applications

## Key Differences

| Aspect         | Minimal    | Standard                         | Enterprise                             |
| -------------- | ---------- | -------------------------------- | -------------------------------------- |
| **Features**   | Auth, CRUD | + RBAC, Relations, Files         | + Workflows, Versioning, Audit         |
| **API Routes** | Items only | + Collections, Fields, Relations | + Users, Roles, Permissions, Workflows |
| **Testing**    | Basic      | Playwright + Vitest              | + Load testing (k6)                    |
| **Components** | **ALL**    | **ALL**                          | **ALL**                                |

> **Note:** All templates install ALL 40+ Buildpad UI components. The difference is in features, not components.

## Usage by Skills

When `/create-project` or `/create-feature` skills process a template:

### Step 1: Read Template Config

```typescript
const template = require("./minimal/template.json");
// Get features, env vars, structure hints
```

### Step 2: Initialize Project with CLI

```bash
# From buildpad-ui directory
cd /path/to/buildpad-ui

# Initialize new project
pnpm cli init --cwd /path/to/new-project

# Install ALL components (recommended for DaaS apps)
pnpm cli add --all --cwd /path/to/new-project

# Validate installation
pnpm cli validate --cwd /path/to/new-project
```

### Step 3: Agent Generates Project-Specific Code

- Pages based on entities
- Migrations based on schema
- Custom business logic
- Tests for all features

## What template.json Contains

Each `template.json` defines:

```json
{
  "name": "template-name",
  "description": "What this template is for",
  "features": ["auth", "rbac", "workflow"],
  "environment": {
    "required": [...],
    "optional": [...]
  },
  "structure": {
    "directories": ["app/...", "lib/..."],
    "hints": [...]
  }
}
```

## See Also

- [buildpad-ui/docs/CLI.md](../../../buildpad-ui/docs/CLI.md) - CLI commands reference
- [buildpad-ui/docs/ARCHITECTURE.md](../../../buildpad-ui/docs/ARCHITECTURE.md) - Component architecture
- [buildpad-ui/docs/DISTRIBUTION.md](../../../buildpad-ui/docs/DISTRIBUTION.md) - Distribution model

- `{{PROJECT_NAME}}` - Project name (kebab-case)
- `{{PROJECT_TITLE}}` - Project title (Title Case)
- `{{DESCRIPTION}}` - Project description
- `{{AUTHOR}}` - Author name
- `{{YEAR}}` - Current year
