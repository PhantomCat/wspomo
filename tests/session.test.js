/*
 * wspomo server-authoritative session tests — live Postgres (21.09)
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(TEST_DATABASE_URL);

// Server must boot WITH a database for the auth branches — set before require.
if (hasDb) process.env.DATABASE_URL = TEST_DATABASE_URL;

const { app, storage } = require('../server.js');

let server;
let base;

test.before(async () => {
  if (!hasDb) return;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  // The server already runs storage.init() (fail-fast on misconfig). Do NOT
  // init again here: two concurrent CREATE TABLE IF NOT EXISTS against a
  // fresh database race on the pg_type catalog (duplicate key) and killed CI.
  // Wait until the schema is actually usable instead.
  for (let i = 0; i < 50; i++) {
    try {
      await storage.pool.query('SELECT 1 FROM users LIMIT 1');
      break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  // only this file's fixtures ('sess-%' users) — storage.test.js runs in
  // parallel on the same database and a global TRUNCATE there races with us
  await storage.pool.query("DELETE FROM users WHERE email LIKE 'sess-%'");
  await storage.pool.query('TRUNCATE active_sessions');
});

test.after(async () => {
  if (!hasDb) return;
  server.close();
  await storage.close();
});

// ---------- storage: active_sessions row ----------

test('active session: start, get, upsert restarts, stop', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-1@example.com']);
  const uid = u.rows[0].id;

  assert.strictEqual(await storage.getActiveSession(uid), null);

  await storage.startActiveSession(uid, 'synced');
  let row = await storage.getActiveSession(uid);
  assert.strictEqual(row.mode, 'synced');
  assert.ok(row.started_at instanceof Date);

  // re-start with another mode → upsert (one row per user, fresh started_at)
  await new Promise((r) => setTimeout(r, 10));
  await storage.startActiveSession(uid, 'freeform');
  row = await storage.getActiveSession(uid);
  assert.strictEqual(row.mode, 'freeform');

  assert.strictEqual(await storage.stopActiveSession(uid), true);
  assert.strictEqual(await storage.getActiveSession(uid), null);
  assert.strictEqual(await storage.stopActiveSession(uid), false); // idempotent
});

// ---------- POST /api/session (black-box) ----------

test('POST /api/session without token → 401', { skip: !hasDb }, async () => {
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', mode: 'synced' })
  });
  assert.strictEqual(res.status, 401);
});

test('POST /api/session invalid action → 400', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-2@example.com']);
  await storage.createSession(u.rows[0].id, 'api', 'sess-token-2');
  const res = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sess-token-2' },
    body: JSON.stringify({ action: 'pause' })
  });
  assert.strictEqual(res.status, 400);
});

test('session start → /api/state replays schedule; stop → idle', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-3@example.com']);
  const uid = u.rows[0].id;
  await storage.createSession(uid, 'api', 'sess-token-3');

  // per-user settings: workday 09:00–18:00 Moscow, no lunch → deterministic math
  await storage.setSettings(uid, {
    workdayStart: '09:00', workdayEnd: '18:00', lunchEnabled: false,
    workdaySync: true, timezone: 'Europe/Moscow', workDays: [1, 2, 3, 4, 5]
  });

  const auth = { 'content-type': 'application/json', authorization: 'Bearer sess-token-3' };

  // No active session → idle (relay-only still holds without a session row)
  let res = await fetch(`${base}/api/state`, { headers: auth });
  let data = await res.json();
  assert.strictEqual(data.state, 'idle');
  assert.strictEqual(data.auth, 'recognized');

  // Start the synced chain → replay computes from the schedule
  res = await fetch(`${base}/api/session`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start', mode: 'synced' }) });
  assert.strictEqual((await res.json()).ok, true);

  res = await fetch(`${base}/api/state`, { headers: auth });
  data = await res.json();
  assert.strictEqual(data.auth, 'recognized');
  // The replay now runs on real "now": inside a workday → work/break/lunch/...;
  // outside → before-work/after-work/out-of-scope. It must NOT be idle.
  assert.ok(data.state !== 'idle', `expected non-idle replay, got: ${data.state}`);
  if (data.state === 'work' || data.state === 'break') {
    assert.strictEqual(data.synced, true);
    assert.strictEqual(data.source, 'server');
    assert.ok(Number.isFinite(data.remainingSec));
    assert.ok(Number.isFinite(data.totalSec));
  }

  // free-form chain: never computed server-side → idle, but recognized
  await fetch(`${base}/api/session`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'start', mode: 'freeform' }) });
  res = await fetch(`${base}/api/state`, { headers: auth });
  data = await res.json();
  assert.strictEqual(data.state, 'idle');
  assert.strictEqual(data.auth, 'recognized');

  // Stop → back to idle
  await fetch(`${base}/api/session`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'stop' }) });
  res = await fetch(`${base}/api/state`, { headers: auth });
  data = await res.json();
  assert.strictEqual(data.state, 'idle');
});

// ---------- /api/settings auth branch ----------

test('settings: Bearer GET/POST round-trip via DB', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-4@example.com']);
  const uid = u.rows[0].id;
  await storage.createSession(uid, 'api', 'sess-token-4');
  const auth = { 'content-type': 'application/json', authorization: 'Bearer sess-token-4' };

  // GET without a stored row → defaults
  let res = await fetch(`${base}/api/settings`, { headers: auth });
  let data = await res.json();
  assert.strictEqual(data.workdayStart, '09:00');
  assert.strictEqual(data.workDuration, 25);

  // POST stores the full body
  res = await fetch(`${base}/api/settings`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ workdayStart: '08:30', workDuration: 50 })
  });
  assert.deepStrictEqual(await res.json(), { ok: true, stored: 'db' });

  res = await fetch(`${base}/api/settings`, { headers: auth });
  data = await res.json();
  assert.strictEqual(data.workdayStart, '08:30');
  assert.strictEqual(data.workDuration, 50);
  assert.strictEqual(data.shortBreakDuration, 5); // default merged back
});

test('settings: POST with token does not set cookies', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-5@example.com']);
  await storage.createSession(u.rows[0].id, 'api', 'sess-token-5');
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sess-token-5' },
    body: JSON.stringify({ workDuration: 30 })
  });
  assert.ok(!(res.headers.get('set-cookie') || '').includes('wspomo_main'));
});

test('settings: invalid token falls through to the cookie path', { skip: !hasDb }, async () => {
  const res = await fetch(`${base}/api/settings`, {
    headers: { authorization: 'Bearer no-such-token' }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.workDuration, 25); // defaults (no cookies sent)
  assert.ok(!('stored' in data));
});