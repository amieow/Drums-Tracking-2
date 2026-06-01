# Drums Tracker

Enterprise-grade centralized inventory management system for Sima Arome's warehouse and production floor. Tracks every drum of raw material and finished extract through its complete lifecycle with real-time visibility, QR scanning, and immutable audit compliance.

## Features

### Core Capabilities

- **Floor Plan** — Visual warehouse map showing real-time drum counts per zone with capacity warnings. WebSocket-powered live updates.
- **Scan Mode** — Mobile-optimized bulk QR scanning for fast drum status and location updates.
- **Register Drum** — Intake new drums with auto-generated Lot ID (`LOT-YYYY-NNNNN`) and printable QR label.
- **Search** — Look up any drum by Lot ID and view its complete lifecycle history.
- **Audit Log** — Immutable, append-only compliance trail (admin only) with CSV export.

### Role-Based Access

| Role | Permissions |
|------|-------------|
| **Operator** | Register drums, scan/update status, read items |
| **QC Staff** | QC pass/fail transitions, read items |
| **PPIC** | Read-only access to all items and production schedules |
| **Admin** | Full access including user management and audit export |

### Drum Lifecycle States

`received` → `qc_pending` → `qc_pass` / `qc_fail` → `in_production` / `cold_storage` → `finished` → `cold_storage` / `dispatched` → `archived`

### State Machine Enforcement

Invalid transitions are rejected with clear error messages. Status cannot regress (e.g., from `qc_fail` back to `qc_pending`).

### Offline Scan Buffering

Scans are queued in localStorage when offline and auto-synced on reconnect. Up to 500 queued scans, 3 retries at 5-second intervals.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4, CSS variables |
| UI Components | Radix UI, shadcn |
| Auth | Supabase (JWT, RBAC) |
| Database | Supabase PostgreSQL with RLS |
| Real-time | WebSocket client |
| QR Scanning | html5-qrcode |
| QR Generation | qrcode |
| Testing | Vitest |
| Auth Crypto | bcryptjs, jose |

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project

### Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Run Tests

```bash
npm test
```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes (auth, items, locations, audit, QR)
│   ├── dashboard/         # Floor plan page
│   ├── scan/             # Bulk scan mode
│   ├── register/         # Drum registration
│   ├── search/           # Drum search
│   └── audit/            # Audit log (admin)
├── components/           # UI components (ZoneCard, QrScanner, etc.)
├── lib/                  # Utilities, auth context, RBAC, WebSocket client
├── types/                # TypeScript type definitions
supabase/
└── migrations/           # Database schema migrations
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Authenticate user |
| GET | `/api/items` | List items (with filters) |
| POST | `/api/items` | Register new drum |
| PATCH | `/api/items/[id]` | Update drum status/location |
| POST | `/api/items/bulk-scan` | Bulk scan (up to 50) |
| GET | `/api/locations` | List warehouse zones |
| GET | `/api/locations/[zone_id]` | Get zone with item list |
| GET | `/api/search?lot_id=` | Search drum by Lot ID |
| GET | `/api/audit-logs` | List audit entries (admin) |
| GET | `/api/audit-logs/export` | Export audit CSV (admin) |
| GET | `/api/qr/[lot_id]` | Generate QR code PNG |
| GET | `/api/health` | Health check |
| GET | `/api/readiness` | Readiness check |

## Database Schema

Key tables: `users`, `items`, `locations`, `audit_logs`. RLS policies enforce row-level security per role. Append-only policy enforced on `audit_logs` (WORM).

See `supabase/migrations/` for full schema.