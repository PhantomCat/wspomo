-- wspomo schema (v1)
-- KT-1 (09.09): users, settings, sessions (incl. API tokens), metrics.
-- Metrics are stored as daily aggregates, never as raw event rows.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One table for both web sessions (cookie token) and API tokens (Bearer),
-- distinguished by kind. API tokens get a label ('waybar', 'laptop', ...).
CREATE TABLE IF NOT EXISTS sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('web', 'api')),
  token_hash  TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Daily aggregates: one row per day, updated in place.
CREATE TABLE IF NOT EXISTS metrics_daily (
  day           DATE PRIMARY KEY,
  visitors      INTEGER NOT NULL DEFAULT 0,
  focus_minutes INTEGER NOT NULL DEFAULT 0,
  pomodoros     INTEGER NOT NULL DEFAULT 0
);

-- Unique visitors per day (uuid list is small; cap checked app-side).
CREATE TABLE IF NOT EXISTS metrics_visitors (
  day      DATE NOT NULL REFERENCES metrics_daily(day) ON DELETE CASCADE,
  uuid     UUID NOT NULL,
  PRIMARY KEY (day, uuid)
);