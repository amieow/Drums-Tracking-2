-- ============================================================
-- Drums Tracking — Users Table Migration
-- Replaces Supabase Auth with a direct users table.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('operator', 'qc', 'ppic', 'admin')),
  banned_until  TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── Stored procedure for lot ID sequence (if not already created) ────────────
CREATE OR REPLACE FUNCTION increment_lot_sequence(p_year INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sequence INTEGER;
BEGIN
  INSERT INTO lot_id_sequences (year, last_sequence, updated_at)
  VALUES (p_year, 0, NOW())
  ON CONFLICT (year) DO NOTHING;

  SELECT last_sequence INTO v_sequence
  FROM lot_id_sequences
  WHERE year = p_year
  FOR UPDATE;

  v_sequence := v_sequence + 1;

  IF v_sequence > 99999 THEN
    RAISE EXCEPTION 'SEQUENCE_OVERFLOW';
  END IF;

  UPDATE lot_id_sequences
  SET last_sequence = v_sequence, updated_at = NOW()
  WHERE year = p_year;

  RETURN v_sequence;
END;
$$;
