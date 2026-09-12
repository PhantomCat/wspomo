/*
 * wspomo — Workday Synchronized Pomodoro Timer
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { createMetrics } = require('./lib/metrics.js');
const { createStorage } = require('./lib/storage.js');
const timerCore = require('./public/js/timer-core.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL || '';

const metrics = createMetrics({ dataDir: DATA_DIR });
metrics.startFlushTimer();

// Postgres storage (KT-1: schema ready, metrics migrate JSON -> DB).
// Without DATABASE_URL the server runs file-backed (standalone docker
// without the pg service) — every metrics call falls through to JSON.
const storage = createStorage({ databaseUrl: DATABASE_URL });
const metricsDb = storage !== null; // DB present → aggregates go to Postgres

if (metricsDb) {
  storage.init().catch((e) => {
    console.error('storage init failed:', e.message);
    process.exit(1); // misconfigured DB must fail fast, not silently degrade
  });
}

// Metrics write path: DB when configured, JSON otherwise. Reads prefer the
// DB; the JSON store still flushes so a DB-less instance keeps working.
async function trackVisitor(uuid, day) {
  if (metricsDb) {
    await storage.touchVisitor(uuid, day);
    return;
  }
  metrics.touchVisitor(uuid, day);
}
async function trackFocusMinutes(uuid, day, minutes) {
  if (metricsDb) {
    await storage.addFocusMinutes(day, minutes);
    return;
  }
  metrics.addFocusMinutes(uuid, minutes);
}
async function trackPomodoro(day) {
  if (metricsDb) {
    await storage.addPomodoro(day);
    return;
  }
  metrics.addPomodoro();
}
async function getPublicStats(today) {
  if (metricsDb) {
    try {
      return await storage.publicStats(today);
    } catch (e) {
      console.error('metrics db read failed:', e.message);
      // fall through to JSON snapshot
    }
  }
  return metrics.publicStats();
}

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const COOKIE_OPTS = { maxAge: COOKIE_MAX_AGE, httpOnly: false, sameSite: 'lax', path: '/' };
const VISITOR_COOKIE_OPTS = { maxAge: COOKIE_MAX_AGE, httpOnly: true, sameSite: 'lax', path: '/' };

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/settings', (req, res) => {
  const main = parseCookie(req.cookies.wspomo_main);
  const lang = req.cookies.wspomo_lang;
  const days = parseCookie(req.cookies.wspomo_days);
  const theme = req.cookies.wspomo_theme;

  // Migration: read old pomodoro_settings cookie if new ones don't exist
  let legacy = null;
  if (!main && !lang && !days && !theme) {
    legacy = parseCookie(req.cookies.pomodoro_settings);
  }

  const defaults = getDefaultSettings();

  res.json({
    ...defaults,
    ...(legacy || main),
    ...(lang || (legacy && legacy.language) ? { language: lang || (legacy && legacy.language) } : {}),
    ...(days || (legacy && legacy.workDays) ? { workDays: days || (legacy && legacy.workDays) } : {}),
    ...(theme || (legacy && legacy.theme) ? { theme: theme || (legacy && legacy.theme) } : {})
  });
});

app.post('/api/settings', (req, res) => {
  const { language, workDays, theme, ...main } = req.body;

  res.cookie('wspomo_main', JSON.stringify(main), COOKIE_OPTS);

  if (language) {
    res.cookie('wspomo_lang', language, COOKIE_OPTS);
  }

  if (Array.isArray(workDays)) {
    res.cookie('wspomo_days', JSON.stringify(workDays), COOKIE_OPTS);
  }

  if (theme) {
    res.cookie('wspomo_theme', theme, COOKIE_OPTS);
  }

  res.json({ ok: true });
});

// ---------- anonymous metrics ----------

function getVisitorId(req) {
  return typeof req.cookies.wspomo_visitor === 'string' && req.cookies.wspomo_visitor.length === 36
    ? req.cookies.wspomo_visitor
    : null;
}

app.post('/api/track/visit', async (req, res) => {
  let uuid = getVisitorId(req);
  let isNew = false;

  if (!uuid) {
    uuid = crypto.randomUUID();
    isNew = true;
    res.cookie('wspomo_visitor', uuid, VISITOR_COOKIE_OPTS);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  try {
    await trackVisitor(uuid, todayKey);
  } catch (e) {
    console.error('track visit failed:', e.message);
    metrics.touchVisitor(uuid, todayKey); // best-effort fallback to file store
  }
  res.json({ ok: true, isNewVisitor: isNew });
});

// ---------- active-report: browser relays its running timer state ----------
// KT-1: free-form lives in the browser; the server only re-broadcasts what a
// client reports. TTL ~90s: browser closed → report expires → /api/state
// falls back to schedule replay. Until auth (11.10) the report is global
// (standalone is single-user); with API tokens this becomes per-user.

const ACTIVE_TTL_MS = 90 * 1000;
const activeReports = new Map(); // uuid → { report, seenMs }

function readVisitorId(req) {
  return getVisitorId(req);
}

function parseActiveReport(body) {
  if (!body || typeof body !== 'object') return null;
  const mode = body.mode;
  const remainingSec = Math.floor(Number(body.remainingSec));
  const totalSec = Math.floor(Number(body.totalSec));
  if (!['work', 'shortBreak', 'longBreak', 'lunch'].includes(mode)) return null;
  if (!Number.isFinite(remainingSec) || remainingSec < 0 || remainingSec > 24 * 3600) return null;
  if (!Number.isFinite(totalSec) || totalSec <= 0 || totalSec > 24 * 3600) return null;
  const report = {
    synced: true,
    state: mode === 'work' ? 'work' : 'break',
    mode,
    session: body.session != null ? Math.floor(Number(body.session)) || null : null,
    remainingSec,
    totalSec,
    lunch: mode === 'lunch',
    source: 'client',
    serverTime: new Date().toISOString()
  };
  return report;
}

app.post('/api/track/heartbeat', async (req, res) => {
  const uuid = getVisitorId(req);
  if (!uuid) {
    return res.status(400).json({ ok: false });
  }
  metrics.heartbeat(uuid);
  const todayKey = new Date().toISOString().slice(0, 10);
  if (req.body && req.body.active !== undefined) {
    if (req.body.active === null) {
      activeReports.delete(uuid); // browser signalled idle → drop report
    } else {
      const report = parseActiveReport(req.body.active);
      if (report) activeReports.set(uuid, { report, seenMs: Date.now() });
    }
  }
  try {
    if (req.body && req.body.focus) {
      const minutes = Math.min(Math.max(Math.floor(Number(req.body.minutes) || 1), 1), 10);
      await trackFocusMinutes(uuid, todayKey, minutes);
    }
    if (req.body && req.body.pomodoro) {
      await trackPomodoro(todayKey);
    }
  } catch (e) {
    console.error('heartbeat metrics failed:', e.message);
    // metrics are best-effort: presence and active-report already accepted
  }
  res.json({ ok: true });
});

function latestActiveReport() {
  const cutoff = Date.now() - ACTIVE_TTL_MS;
  let best = null;
  for (const [uuid, entry] of activeReports) {
    if (entry.seenMs < cutoff) {
      activeReports.delete(uuid);
      continue;
    }
    if (entry.report && (!best || entry.seenMs > best.seenMs)) {
      best = entry;
    }
  }
  if (!best) return null;
  // The report is a snapshot taken at seenMs (relays arrive every ~60s).
  // Tick it forward so pollers see a live countdown instead of a stale one.
  const elapsed = Math.floor((Date.now() - best.seenMs) / 1000);
  const remainingSec = Math.max(0, best.report.remainingSec - elapsed);
  return { ...best.report, remainingSec, serverTime: new Date().toISOString() };
}

app.get('/api/metrics/public', async (req, res) => {
  try {
    res.json(await getPublicStats(new Date().toISOString().slice(0, 10)));
  } catch (e) {
    console.error('public stats failed:', e.message);
    res.json(metrics.publicStats());
  }
});

// ---------- GET /api/state (headless clients: waybar, TUI, ...) ----------
// Replay-computed timer state from the workday schedule (KT-1 decision 09.09).
// Auth seam: API tokens arrive as Bearer headers (implemented 11.10); for now
// every caller shares the standalone (single-user) settings — the shape below
// is already token-aware so headless clients never change their integration.

function stateFromSynced(core, now) {
  return {
    synced: true,
    state: core.type === 'work' ? 'work' : 'break',
    mode: core.mode,
    session: core.session,
    remainingSec: core.timeLeft,
    totalSec: core.totalTime,
    lunch: false,
    serverTime: now.toISOString()
  };
}

function emptyState(now) {
  return {
    synced: true,
    state: 'idle',
    mode: null,
    session: null,
    remainingSec: null,
    totalSec: null,
    lunch: false,
    serverTime: now.toISOString()
  };
}

function computeState(settings, now) {
  const core = timerCore.calculateSyncedTimeCore(settings, now);

  if (core === null) {
    // weekend or continueAfterWorkday past end — no timer chain running
    return { ...emptyState(now), synced: false, state: 'out-of-scope' };
  }

  if (core.type === 'work' || core.type === 'break') {
    return stateFromSynced(core, now);
  }
  if (core.type === 'lunch') {
    const lunchState = stateFromSynced(
      { type: 'break', mode: 'lunch', session: null, timeLeft: core.timeLeft, totalTime: core.totalTime },
      now
    );
    lunchState.mode = 'lunch';
    lunchState.lunch = true;
    return lunchState;
  }
  if (core.type === 'before-work') {
    const state = emptyState(now);
    state.state = 'before-work';
    state.remainingSec = core.timeLeft;
    return state;
  }
  // core.type === 'after-work' — the only remaining contract value
  const state = emptyState(now);
  state.state = 'after-work';
  return state;
}

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

app.get('/api/state', (req, res) => {
  // auth seam (KT-1): per-user settings + server-authoritative chain lookup
  // arrive with API tokens (11.10); standalone callers run on defaults today.
  const token = readBearerToken(req);

  // Priority: fresh client active-report (browser relays free-form AND synced
  // runs) → schedule replay. Free-form is never computed by the server (KT-1).
  const active = latestActiveReport();
  if (active) {
    if (token) active.auth = 'recognized';
    return res.json(active);
  }

  // State is always computed in workday-sync mode (KT-1: server-authoritative
  // only for schedule chains); everything else comes from shared defaults.
  const settings = { ...getDefaultSettings(), workdaySync: true };
  const now = new Date();
  const state = computeState(settings, now);

  if (token) {
    state.auth = 'recognized'; // placeholder until token store (11.10)
  }
  res.json(state);
});

function parseCookie(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function getDefaultSettings() {
  return {
    workDuration: 25,
    shortBreakDuration: 5,
    longBreakDuration: 15,
    sessionsBeforeLongBreak: 4,
    workdaySync: false,
    workdayStart: '09:00',
    lunchEnabled: true,
    lunchStart: '13:00',
    lunchEnd: '14:00',
    workdayEnd: '18:00',
    continueAfterWorkday: false,
    workDays: [1, 2, 3, 4, 5],
    soundEnabled: true,
    browserNotification: true,
    language: null,
    theme: 'mocha'
  };
}

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`wspomo running on http://0.0.0.0:${PORT}`);
  });

  process.on('SIGTERM', () => {
    metrics.stop();
    if (storage) storage.close().catch(() => {});
    process.exit(0);
  });
  process.on('SIGINT', () => {
    metrics.stop();
    process.exit(0);
  });
}

module.exports = { app, getDefaultSettings, metrics, computeState, storage };
