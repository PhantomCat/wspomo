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
app.use(express.json());

// ---------- SaaS assembly (KT-1, task 30.09; owner picked variant 1) ----------
// One codebase: the SaaS build is the OSS build + a preseeded Connection
// section. WSPOMO_SAAS_URL (server env) tells the page where its own API
// lives, so a demo/new user lands connected — self-host builds just leave
// the env out and keep the empty-connection OSS behavior.
const SAAS_URL = (process.env.WSPOMO_SAAS_URL || '').trim();
const STATIC_DIR = path.join(__dirname, 'public');

let indexHtmlCache = null;
function indexHtml() {
  if (indexHtmlCache === null) {
    indexHtmlCache = require('fs').readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8');
  }
  if (!SAAS_URL) return indexHtmlCache;
  const preseed = `<script>window.WSPOMO_SAAS_URL = ${JSON.stringify(SAAS_URL)};</script>`;
  return indexHtmlCache.replace('<!-- WSPOMO_SAAS_PRESEED -->', preseed);
}

// / served through the preseed renderer (no-store: the preseed must never be
// cached into a page it does not belong to); the rest stays static.
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(indexHtml());
});
app.use(express.static(STATIC_DIR, { index: false, extensions: ['html'] }));

// CORS for connected frontends (task 22.09): an OSS page served elsewhere
// polls /api/state and manages /api/session with a Bearer token — browsers
// require CORS and a preflight for the Authorization header. Auth itself is
// the token, not the origin, so these endpoints stay public.
function corsOpen(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600'
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
app.use('/api/state', corsOpen);
app.use('/api/session', corsOpen);
app.use('/api/settings', corsOpen);

// ---------- GET /api/settings ----------
// Auth branch (KT-1, 21.09; auth skeleton 29.09): an authenticated principal
// (Bearer API token OR web-session cookie) reads/writes the per-user DB
// settings row. Anonymous cookies keep the standalone single-user path.
app.get('/api/settings', async (req, res) => {
  const session = await authRequest(req);
  if (session) {
    const meta = await storage.getSettingsMeta(session.user_id);
    const payload = { ...getDefaultSettings(), ...(meta.data || {}) };
    // revision marker so clients can detect cross-client changes (28.09)
    if (meta.data) payload.settingsRev = settingsRevision(meta.data, meta.updatedAt);
    return res.json(payload);
  }

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

app.post('/api/settings', async (req, res) => {
  const { language, workDays, theme, ...main } = req.body || {};

  // Auth branch: authenticated principal → upsert full body into the user's
  // DB row (full replace, matching storage.setSettings semantics).
  const session = await authRequest(req);
  if (session) {
    await storage.setSettings(session.user_id, req.body || {});
    const meta = await storage.getSettingsMeta(session.user_id);
    // the writer gets the fresh revision immediately; other clients pick it
    // up from /api/state ticks (28.09)
    return res.json({ ok: true, stored: 'db', settingsRev: settingsRevision(meta.data, meta.updatedAt) });
  }

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
// client reports. TTL ~90s: no fresh report → /api/state answers idle.
// OSS standalone has no server-side timer (issue #2, decision 15.09) —
// nothing ticks without a running client. Until auth (26.09) the report is
// global (standalone is single-user); with API tokens this becomes per-user.

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
// Relay-only contract (issue #2, decision 15.09): state comes exclusively from
// a fresh client active-report; nothing runs server-side in OSS standalone.
// Auth seam: API tokens arrive as Bearer headers (implemented 26.09); for now
// every caller shares the single-user report — the shape below is already
// token-aware so headless clients never change their integration.

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function emptyState(now) {
  return {
    synced: false,
    state: 'idle',
    mode: null,
    session: null,
    remainingSec: null,
    totalSec: null,
    lunch: false,
    source: 'server',
    serverTime: now.toISOString()
  };
}

// ---------- server-authoritative replay (KT-1, task 21.09) ----------
// Replay = pure schedule calculation (timer-core) anchored to the workday
// grid; the active_sessions row only marks WHICH chain the user activated.
// Auth-gated: valid Bearer → per-user session row + settings; no token →
// relay-only (issue #2 holds for OSS standalone).

function stateFromSynced(core, now) {
  return {
    synced: true,
    state: core.type === 'work' ? 'work' : 'break',
    mode: core.mode,
    session: core.session,
    remainingSec: core.timeLeft,
    totalSec: core.totalTime,
    lunch: false,
    source: 'server',
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

// Current time inside a named IANA timezone, as a Date whose local getters
// (getHours/getDay/...) yield the target zone's wall time. Null if unknown.
// (KT-1/11.09: schedules are computed in the user's timezone, not the host's.)
function nowInTz(tzName) {
  if (!tzName) return new Date();
  try {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date())) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    const dayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    if (dayIdx < 0) return null;
    // local-component constructor: getDay/getHours then match the target zone
    return new Date(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second), 0
    );
  } catch (e) {
    return null; // unknown IANA zone
  }
}

function isValidTimezone(tzName) {
  return Boolean(tzName) && nowInTz(tzName) !== null;
}

// Resolve an API token (Bearer header) to a user row; null on any miss.
// Kept for /api/session's strict Bearer-only contract.
async function authUser(req) {
  const token = readBearerToken(req);
  if (!token || !metricsDb) return null;
  return storage.findSessionByToken(token);
}

// Resolve ANY authenticated principal (auth skeleton, 29.09): Bearer API
// token first, then the web session cookie. Returns the sessions row or
// null. Single funnel — endpoints stop hand-rolling token lookups.
async function authRequest(req) {
  if (!metricsDb) return null;

  // 1. headless clients: Authorization: Bearer <api-token>
  const bearer = readBearerToken(req);
  if (bearer) return storage.findSessionByToken(bearer);

  // 2. the browser: wspomo_session cookie (httpOnly web session token)
  const cookieToken = typeof req.cookies.wspomo_session === 'string' ? req.cookies.wspomo_session : null;
  if (cookieToken) return storage.findSessionByToken(cookieToken);

  return null;
}

// ---------- web sessions (auth skeleton, 29.09) ----------
// A logged-in browser carries the wspomo_session cookie (httpOnly, 30 days).
// The raw token lives only in the cookie; the DB stores its sha256 hash.
// Auth itself comes with email OTP (30.09, Resend); for now the only entry
// point is the dev-only mint endpoint below, gated off production.

const WEB_SESSION_COOKIE = 'wspomo_session';
const WEB_SESSION_DAYS = 30;
const WEB_COOKIE_OPTS = {
  maxAge: WEB_SESSION_DAYS * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  // secure is set in production behind caddy (HTTPS); dev on :3000 is plain
  secure: process.env.NODE_ENV === 'production'
};

// Find or create the user by email (unique key).
function findOrCreateUser(email) {
  return storage.findOrCreateUser(email);
}

// Dev-only session mint (removed once email OTP lands, 30.09) — gated off by
// WSPOMO_DEV_AUTH being unset AND a database being configured. On prod this
// answers 404. Body: { email } → sets the web-session cookie + returns it
// once in the response so tests and local dev can use it as Bearer too.
app.post('/api/auth/dev-mint', async (req, res) => {
  if (!metricsDb || process.env.WSPOMO_DEV_AUTH !== '1') {
    return res.status(404).json({ ok: false });
  }
  const email = (req.body && typeof req.body.email === 'string' ? req.body.email : '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  const user = await findOrCreateUser(email);
  const token = crypto.randomBytes(24).toString('hex');
  await storage.createSession(user.id, 'web', token, { label: 'dev-mint' });
  res.cookie(WEB_SESSION_COOKIE, token, WEB_COOKIE_OPTS);
  res.json({ ok: true, email: user.email, token }); // token returned for tests/headless convenience
});

// ---------- profile + API token management (auth part 2, 29.09) ----------
// Any authenticated principal (web cookie or an existing API token) may
// inspect the profile and mint/revoke API tokens. The raw token travels to
// the client exactly once (creation response); the DB keeps its sha256.

// CORS for the connected OSS frontend: profile/token endpoints are same-
// origin on the SaaS page, but a connected OSS page lists/revokes its tokens
// cross-origin too (owner decision 29.09: token UI lives on wspomo.work,
// but the OSS page still shows "who am I" via the connection token).
app.use('/api/auth/me', corsOpen);
app.use('/api/auth/tokens', corsOpen);
app.use('/api/auth/logout', corsOpen);

const MAX_ACTIVE_API_TOKENS = 10;

app.get('/api/auth/me', async (req, res) => {
  if (!metricsDb) return res.status(404).json({ ok: false, error: 'no_database' });
  const session = await authRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const user = await storage.getUser(session.user_id);
  const sessions = await storage.listSessions(session.user_id, { includeRevoked: false });
  return res.json({
    ok: true,
    email: user ? user.email : null,
    currentSessionId: session.id,
    sessionType: session.type,
    apiTokens: sessions
      .filter(s => s.type === 'api')
      .map(s => ({ id: s.id, label: s.label, createdAt: s.created_at }))
  });
});

app.post('/api/auth/tokens', async (req, res) => {
  if (!metricsDb) return res.status(404).json({ ok: false, error: 'no_database' });
  const session = await authRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const label = (req.body && typeof req.body.label === 'string' ? req.body.label.trim() : '');
  if (!label || label.length > 50) {
    return res.status(400).json({ ok: false, error: 'invalid_label' });
  }

  const active = await storage.listSessions(session.user_id, { includeRevoked: false });
  const apiCount = active.filter(s => s.type === 'api').length;
  if (apiCount >= MAX_ACTIVE_API_TOKENS) {
    return res.status(429).json({ ok: false, error: 'too_many_tokens' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  await storage.createSession(session.user_id, 'api', token, { label });
  return res.json({
    ok: true,
    token, // shown exactly once; the DB stores only the sha256
    hint: 'copy-now-shown-once'
  });
});

app.delete('/api/auth/tokens/:id', async (req, res) => {
  if (!metricsDb) return res.status(404).json({ ok: false, error: 'no_database' });
  const session = await authRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'invalid_id' });
  }

  // only own tokens are revocable — cross-user manipulation would be a
  // security hole even if the id came from somebody else's traffic
  const row = await storage.getSession(id);
  if (!row || row.user_id !== session.user_id || row.type !== 'api') {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  if (row.id === session.id) {
    return res.status(400).json({ ok: false, error: 'cannot_revoke_self' });
  }
  await storage.revokeSession(id);
  return res.json({ ok: true });
});

app.delete('/api/auth/tokens', async (req, res) => {
  // bulk: revoke every api token of this user (profile "revoke all")
  if (!metricsDb) return res.status(404).json({ ok: false, error: 'no_database' });
  const session = await authRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const n = await storage.revokeApiTokens(session.user_id);
  return res.json({ ok: true, revoked: n });
});

app.post('/api/auth/logout', async (req, res) => {
  if (!metricsDb) return res.status(404).json({ ok: false, error: 'no_database' });
  const cookieToken = typeof req.cookies.wspomo_session === 'string' ? req.cookies.wspomo_session : null;
  if (cookieToken) {
    const session = await storage.findSessionByToken(cookieToken);
    if (session && session.type === 'web') {
      await storage.revokeSession(session.id);
    }
  }
  res.clearCookie(WEB_SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// ---------- settings revision hash (task 28.09, owner request) ----------
// Connected clients keep a local copy of the per-user settings and watch a
// short revision hash in every /api/state tick; when it differs, they re-fetch
// /api/settings. Hash = first 5 hex chars of sha256(data) + updated_at —
// collision-safe enough for a handful of clients, ~10 bytes on the wire.

function settingsRevision(data, updatedAt) {
  const h = crypto.createHash('sha256').update(JSON.stringify(data) + '|' + (updatedAt || '')).digest('hex');
  return h.slice(0, 5);
}

// POST /api/session { action: 'start'|'stop', mode: 'synced'|'freeform' }
// Marks the user's timer chain active/inactive in the DB. Replay in
// GET /api/state then serves headless clients (waybar/TUI) without a browser.
app.post('/api/session', async (req, res) => {
  // Bearer-only by design: a web session cookie on a shared browser must not
  // silently activate the user's headless schedule chain.
  const user = await authUser(req);
  if (!user) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const action = req.body && req.body.action;
  if (action === 'start') {
    const mode = req.body.mode === 'freeform' ? 'freeform' : 'synced';
    await storage.startActiveSession(user.user_id, mode);
    return res.json({ ok: true, active: true, mode });
  }
  if (action === 'stop') {
    const stopped = await storage.stopActiveSession(user.user_id);
    return res.json({ ok: true, active: false, stopped });
  }
  return res.status(400).json({ ok: false, error: 'invalid_action' });
});

app.get('/api/state', async (req, res) => {
  // Priority 1: fresh client active-report (browser relays free-form AND
  // synced runs) — always wins, zero latency, matches what the user sees.
  const active = latestActiveReport();
  const token = readBearerToken(req);

  if (active) {
    if (token) active.auth = 'recognized';
    return res.json(active);
  }

  // Priority 2 (server-authoritative, KT-1): authenticated principal → the
  // user's active session row + their settings → schedule replay. Anonymous
  // callers stay idle: OSS standalone never replays a schedule (issue #2).
  const user = await authRequest(req);
  if (user) {
    const row = await storage.getActiveSession(user.user_id);
    if (row && row.mode === 'synced') {
      const meta = await storage.getSettingsMeta(user.user_id);
      const merged = { ...getDefaultSettings(), ...(meta.data || {}), workdaySync: true };
      const tz = isValidTimezone(merged.timezone) ? merged.timezone : null;
      const now = nowInTz(tz);
      if (now === null) {
        return res.status(400).json({ ok: false, error: 'invalid_timezone' });
      }
      const state = computeState(merged, now);
      state.auth = 'recognized';
      // settings revision for multi-client sync (28.09)
      if (meta.data) state.settingsRev = settingsRevision(meta.data, meta.updatedAt);
      return res.json(state);
    }
    if (row && row.mode === 'freeform') {
      // free-form is never computed by the server (KT-1); mark recognized
      const state = emptyState(new Date());
      state.auth = 'recognized';
      return res.json(state);
    }
  }

  const state = emptyState(new Date());
  if (token) {
    state.auth = 'recognized'; // placeholder until token store (26.09)
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
    theme: 'mocha',
    timezone: null // browser fills via Intl on first save
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

module.exports = { app, getDefaultSettings, metrics, computeState, storage, nowInTz, isValidTimezone };
