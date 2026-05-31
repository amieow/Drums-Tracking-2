-- ============================================================
-- Drums Tracking — Initial Schema Migration
-- Requirements: 4.2, 5.4, 10.2, 14.1
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Locations ────────────────────────────────────────────────────────────────
-- Requirement 14.1: Location records with zone_id, name, type, capacity, current_count
CREATE TABLE locations (
  zone_id            TEXT PRIMARY KEY,                          -- e.g., 'COLD-A', 'QC-01', 'RECEIVING'
  name               TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('standard','cold','hazard','qc','production')),
  temperature_target NUMERIC,                                   -- °C, required when type='cold'
  capacity           INTEGER NOT NULL DEFAULT 0,               -- 0 = unlimited
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cold_zone_requires_temp CHECK (
    type != 'cold' OR (temperature_target IS NOT NULL AND temperature_target BETWEEN -30 AND 10)
  )
);

-- Requirement 3.1 / 14.1: Seed the required RECEIVING zone
-- All newly registered items start in this zone
INSERT INTO locations (zone_id, name, type, capacity)
VALUES ('RECEIVING', 'Receiving Dock', 'standard', 0);

-- ─── Lot ID Sequences (collision-safe counter per year) ───────────────────────
-- Requirement 4.2: Supports SELECT ... FOR UPDATE locking for collision-safe Lot ID generation
CREATE TABLE lot_id_sequences (
  year          INTEGER PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Items ────────────────────────────────────────────────────────────────────
-- Requirement 4.2: items table with lot_id unique constraint
-- Requirement 5.4: current_status updated atomically with updated_at
CREATE TABLE items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         TEXT NOT NULL UNIQUE,                          -- LOT-YYYY-NNNNN
  material_type  TEXT NOT NULL CHECK (char_length(material_type) BETWEEN 1 AND 100),
  supplier       TEXT NOT NULL CHECK (char_length(supplier) BETWEEN 1 AND 100),
  intake_date    DATE NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'received'
                   CHECK (current_status IN (
                     'received','qc_pending','qc_pass','qc_fail',
                     'in_production','finished','cold_storage','dispatched','archived'
                   )),
  location_zone  TEXT NOT NULL REFERENCES locations(zone_id),
  created_by     UUID NOT NULL,                                 -- Supabase auth.users.id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_lot_id         ON items(lot_id);
CREATE INDEX idx_items_location_zone  ON items(location_zone);
CREATE INDEX idx_items_current_status ON items(current_status);
CREATE INDEX idx_items_intake_date    ON items(intake_date);

-- ─── Audit Logs (append-only, WORM) ──────────────────────────────────────────
-- Requirement 10.2: Database enforces append-only access — no UPDATE or DELETE policies defined
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID REFERENCES items(id),                    -- NULL for non-item events
  action         TEXT NOT NULL CHECK (action IN (
                   'item_created','item_status_changed','item_location_changed',
                   'item_bulk_updated','user_login','user_logout',
                   'audit_exported','forbidden_attempt'
                 )),
  previous_state TEXT,                                          -- JSON string or NULL
  new_state      TEXT,                                          -- JSON string or NULL
  user_id        UUID NOT NULL,
  user_email     TEXT NOT NULL,
  ip_address     TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB
);

CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_item_id   ON audit_logs(item_id);
CREATE INDEX idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action    ON audit_logs(action);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs  ENABLE ROW LEVEL SECURITY;

-- Items: authenticated users can read; operators and admins can insert; operators, qc, and admins can update
CREATE POLICY items_select ON items FOR SELECT TO authenticated USING (true);
CREATE POLICY items_insert ON items FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' IN ('operator', 'admin'));
CREATE POLICY items_update ON items FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' IN ('operator', 'qc', 'admin'));

-- Locations: all authenticated users can read; admin can insert or update
CREATE POLICY locations_select ON locations FOR SELECT TO authenticated USING (true);
CREATE POLICY locations_insert ON locations FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY locations_update ON locations FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');

-- Audit logs: WORM — INSERT only, no UPDATE/DELETE for any role
-- Requirement 10.2: Only INSERT policy is defined; UPDATE and DELETE are blocked by absence of policy
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'role' = 'admin');
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);
-- No UPDATE or DELETE policies defined → effectively blocked for all roles

-- ─── Computed current_count view ─────────────────────────────────────────────
-- Requirement 14.1: current_count is computed as COUNT(items WHERE location_zone = zone_id)
CREATE OR REPLACE VIEW location_counts AS
  SELECT
    l.zone_id,
    l.name,
    l.type,
    l.temperature_target,
    l.capacity,
    COUNT(i.id) AS current_count
  FROM locations l
  LEFT JOIN items i ON i.location_zone = l.zone_id
  GROUP BY l.zone_id, l.name, l.type, l.temperature_target, l.capacity;
