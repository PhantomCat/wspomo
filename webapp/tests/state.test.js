/*
 * wspomo GET /api/state tests — replay-computed state contract
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// file-backed path (storage has its own tests against a live database)
delete process.env.DATABASE_URL;

const { app, computeState } = require('../server.js');

let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server.close();
});

const SHAPE_KEYS = ['synced', 'state', 'mode', 'session', 'remainingSec', 'totalSec', 'lunch', 'serverTime'];

// ---------- black-box: HTTP contract ----------

test('GET /api/state returns token-aware shape', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  for (const key of SHAPE_KEYS) {
    assert.ok(key in data, `missing key: ${key}`);
  }
  assert.strictEqual(typeof data.serverTime, 'string');
  assert.ok(!isNaN(Date.parse(data.serverTime)));
});

test('Bearer token is accepted (auth seam placeholder)', async () => {
  const res = await fetch(`${base}/api/state`, {
    headers: { authorization: 'Bearer test-token-abc' }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.auth, 'recognized');
});

test('request without Bearer has no auth field', async () => {
  const res = await fetch(`${base}/api/state`);
  const data = await res.json();
  assert.ok(!('auth' in data));
});

// ---------- unit: computeState (input → result, fixed dates) ----------

const SETTINGS = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  sessionsBeforeLongBreak: 4,
  workdaySync: true,
  workdayStart: '09:00',
  lunchEnabled: true,
  lunchStart: '13:00',
  lunchEnd: '14:00',
  workdayEnd: '18:00',
  continueAfterWorkday: false,
  workDays: [1, 2, 3, 4, 5]
};

/** Next Thursday from a fixed base date — Thursday is in workDays. */
function thursday(hours, minutes, seconds) {
  // 2026-09-10 is a Thursday; fixed base keeps tests deterministic
  const d = new Date(2026, 8, 10, hours, minutes, seconds, 0);
  return d;
}

test('computeState: 09:00:30 → work, session 1, countdown from 25:00', () => {
  const state = computeState({ ...SETTINGS }, thursday(9, 0, 30));
  assert.strictEqual(state.state, 'work');
  assert.strictEqual(state.mode, 'work');
  assert.strictEqual(state.session, 1);
  assert.strictEqual(state.remainingSec, 25 * 60 - 30);
  assert.strictEqual(state.totalSec, 25 * 60);
  assert.strictEqual(state.lunch, false);
  assert.strictEqual(state.synced, true);
});

test('computeState: 09:26 → shortBreak, session 1', () => {
  const state = computeState({ ...SETTINGS }, thursday(9, 26, 0));
  assert.strictEqual(state.state, 'break');
  assert.strictEqual(state.mode, 'shortBreak');
  assert.strictEqual(state.session, 1);
  assert.strictEqual(state.totalSec, 5 * 60);
});

test('computeState: 13:30 → lunch (state=break, mode=lunch)', () => {
  const state = computeState({ ...SETTINGS }, thursday(13, 30, 0));
  assert.strictEqual(state.state, 'break');
  assert.strictEqual(state.lunch, true);
  assert.strictEqual(state.mode, 'lunch');
  assert.strictEqual(state.remainingSec, 30 * 60); // half of the lunch window left
  assert.strictEqual(state.totalSec, 60 * 60); // full lunch window 13:00–14:00
});

test('computeState: 08:00 → before-work with 1h countdown, no mode', () => {
  const state = computeState({ ...SETTINGS }, thursday(8, 0, 0));
  assert.strictEqual(state.state, 'before-work');
  assert.strictEqual(state.remainingSec, 3600);
  assert.strictEqual(state.mode, null);
  assert.strictEqual(state.session, null);
});

test('computeState: 19:00 → after-work', () => {
  const state = computeState({ ...SETTINGS }, thursday(19, 0, 0));
  assert.strictEqual(state.state, 'after-work');
  assert.strictEqual(state.mode, null);
  assert.strictEqual(state.remainingSec, null);
});

test('computeState: 19:00 with continueAfterWorkday → out-of-scope', () => {
  const state = computeState({ ...SETTINGS, continueAfterWorkday: true }, thursday(19, 0, 0));
  assert.strictEqual(state.synced, false);
  assert.strictEqual(state.state, 'out-of-scope');
});

test('computeState: Sunday 12:00 → out-of-scope (weekend)', () => {
  // 2026-09-13 is a Sunday
  const d = new Date(2026, 8, 13, 12, 0, 0, 0);
  const state = computeState({ ...SETTINGS }, d);
  assert.strictEqual(state.synced, false);
  assert.strictEqual(state.state, 'out-of-scope');
});