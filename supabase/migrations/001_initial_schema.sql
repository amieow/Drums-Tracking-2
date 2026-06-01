-- ============================================================
-- Drums Tracking — Initial Schema Migration
-- Requirements: 4.2, 5.4, 10.2, 14.1
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Locations ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  zone_id            TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('standard','cold','hazard','qc','production')),
  temperature_target NUMERIC,
  capacity           INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cold_zone_requires_temp CHECK (
    type != 'cold' OR (temperature_target IS NOT NULL AND temperature_target BETWEEN -30 AND 10)
  )
);

INSERT INTO locations (zone_id, name, type, capacity)
VALUES ('RECEIVING', 'Receiving Dock', 'standard', 0)
ON CONFLICT (zone_id) DO NOTHING;

-- ─── Lot ID Sequences ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lot_id_sequences (
  year          INTEGER PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Items ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         TEXT NOT NULL UNIQUE,
  material_type  TEXT NOT NULL CHECK (char_length(material_type) BETWEEN 1 AND 100),
  supplier       TEXT NOT NULL CHECK (char_length(supplier) BETWEEN 1 AND 100),
  intake_date    DATE NOT NULL,
  current_status TEXT NOT NULL DEFAULT 'received'
                   CHECK (current_status IN (
                     'received','qc_pending','qc_pass','qc_fail',
                     'in_production','finished','cold_storage','dispatched','archived'
                   )),
  location_zone  TEXT NOT NULL REFERENCES locations(zone_id),
  created_by     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_items_lot_id         ON items(lot_id);
CREATE INDEX IF NOT EXISTS idx_items_location_zone  ON items(location_zone);
CREATE INDEX IF NOT EXISTS idx_items_current_status ON items(current_status);
CREATE INDEX IF NOT EXISTS idx_items_intake_date    ON items(intake_date);

-- ─── Audit Logs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID REFERENCES items(id),
  action         TEXT NOT NULL CHECK (action IN (
                   'item_created','item_status_changed','item_location_changed',
                   'item_bulk_updated','user_login','user_logout',
                   'audit_exported','forbidden_attempt'
                 )),
  previous_state TEXT,
  new_state      TEXT,
  user_id        UUID NOT NULL,
  user_email     TEXT NOT NULL,
  ip_address     TEXT NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_item_id   ON audit_logs(item_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON audit_logs(action);

-- ─── location_counts view ─────────────────────────────────────────────────────
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
