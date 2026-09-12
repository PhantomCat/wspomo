/*
 * wspomo storage — thin Postgres layer (KT-1: no ORM)
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

function createStorage({ databaseUrl, logger = console }) {
  if (!databaseUrl) return null;

  const pool = new Pool({ connectionString: databaseUrl, max: 10 });

  async function init() {
    // apply schema.sql once (idempotent CREATE TABLE IF NOT EXISTS)
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    const client = await pool.connect();
    try {
      await client.query(schema);
    } finally {
      client.release();
    }
  }

  // ---------- metrics (daily aggregates) ----------

  async function touchVisitor(uuid, day) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const up = await c.query(
        `INSERT INTO metrics_daily (day, visitors) VALUES ($1, 1)
         ON CONFLICT (day) DO NOTHING RETURNING day`,
        [day]
      );
      if (up.rowCount === 0) {
        // row exists — count the visitor only if uuid unseen today
        const seen = await c.query(
          'INSERT INTO metrics_visitors (day, uuid) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING uuid',
          [day, uuid]
        );
        if (seen.rowCount > 0) {
          await c.query('UPDATE metrics_daily SET visitors = visitors + 1 WHERE day = $1', [day]);
        }
      } else {
        await c.query(
          'INSERT INTO metrics_visitors (day, uuid) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [day, uuid]
        );
      }
      await c.query('COMMIT');
      return true;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function addFocusMinutes(day, minutes) {
    await pool.query(
      `INSERT INTO metrics_daily (day, focus_minutes) VALUES ($1, $2)
       ON CONFLICT (day) DO UPDATE SET focus_minutes = metrics_daily.focus_minutes + $2`,
      [day, minutes]
    );
  }

  async function addPomodoro(day) {
    await pool.query(
      `INSERT INTO metrics_daily (day, pomodoros) VALUES ($1, 1)
       ON CONFLICT (day) DO UPDATE SET pomodoros = metrics_daily.pomodoros + 1`,
      [day]
    );
  }

  async function publicStats(today) {
    const dayRow = await pool.query(
      'SELECT day::text, visitors, focus_minutes, pomodoros FROM metrics_daily WHERE day = $1',
      [today]
    );
    const totalRow = await pool.query('SELECT COALESCE(SUM(visitors), 0) AS n FROM metrics_daily');
    const day = dayRow.rows[0] || { visitors: 0, focus_minutes: 0, pomodoros: 0 };
    return {
      today: {
        date: today,
        visitors: Number(day.visitors),
        focusMinutes: Number(day.focus_minutes),
        pomodoros: Number(day.pomodoros)
      },
      totalVisitors: Number(totalRow.rows[0].n),
      liveNow: 0 // live presence moves to the DB layer in phase 2 (auth/sessions)
    };
  }

  // ---------- settings (per-user; phase 2, schema ready today) ----------

  async function getSettings(userId) {
    const r = await pool.query('SELECT data FROM settings WHERE user_id = $1', [userId]);
    return r.rows[0] ? r.rows[0].data : null;
  }

  async function setSettings(userId, data) {
    await pool.query(
      `INSERT INTO settings (user_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`,
      [userId, JSON.stringify(data)]
    );
  }

  // ---------- sessions / API tokens (phase 2, schema ready today) ----------

  async function createSession(userId, type, token, { label = null, expiresAt = null } = {}) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await pool.query(
      'INSERT INTO sessions (user_id, type, token_hash, label, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, type, hash, label, expiresAt]
    );
    return r.rows[0].id;
  }

  async function findSessionByToken(token) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await pool.query(
      `SELECT id, user_id, type, label FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())`,
      [hash]
    );
    return r.rows[0] || null;
  }

  async function revokeSession(id) {
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [id]);
  }

  async function close() {
    await pool.end();
  }

  return {
    pool,
    init,
    touchVisitor,
    addFocusMinutes,
    addPomodoro,
    publicStats,
    getSettings,
    setSettings,
    createSession,
    findSessionByToken,
    revokeSession,
    close
  };
}

module.exports = { createStorage };