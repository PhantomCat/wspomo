/*
 * wspomo GET /api/state tests — relay + server-authoritative replay (21.09)
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// file-backed path for the relay-only branch (storage has its own tests)
delete process.env.DATABASE_URL;

const { app } = require('../server.js');

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

// ---------- black-box: HTTP contract (no DB → relay-only) ----------

test('GET /api/state without a running client → idle (no phantom schedule)', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  for (const key of SHAPE_KEYS) {
    assert.ok(key in data, `missing key: ${key}`);
  }
  assert.strictEqual(data.state, 'idle');
  assert.strictEqual(data.synced, false);
  assert.strictEqual(data.source, 'server');
  assert.strictEqual(data.mode, null);
  assert.strictEqual(data.remainingSec, null);
  assert.strictEqual(typeof data.serverTime, 'string');
  assert.ok(!isNaN(Date.parse(data.serverTime)));
});

test('Bearer token on idle state keeps auth field (no DB → still idle)', async () => {
  const res = await fetch(`${base}/api/state`, {
    headers: { authorization: 'Bearer test-token-abc' }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.state, 'idle');
  assert.strictEqual(data.auth, 'recognized');
});

test('request without Bearer has no auth field', async () => {
  const res = await fetch(`${base}/api/state`);
  const data = await res.json();
  assert.ok(!('auth' in data));
});

test('unknown ?tz is accepted when no token (relay-only has no tz parsing)', async () => {
  const res = await fetch(`${base}/api/state?tz=Mars/Olympus`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.state, 'idle');
});

// ---------- computeState: pure replay math (restored 21.09) ----------

const { computeState, getDefaultSettings } = require('../server.js');

function at(hours, minutes, seconds = 0, day = 3) { // Wed
  return new Date(2026, 8, day, hours, minutes, seconds, 0);
}

test('replay: work inside the first pomodoro', () => {
  const s = { ...getDefaultSettings(), workdaySync: true, workdayStart: '09:00', lunchEnabled: false };
  const state = computeState(s, at(9, 10));
  assert.strictEqual(state.synced, true);
  assert.strictEqual(state.state, 'work');
  assert.strictEqual(state.mode, 'work');
  assert.strictEqual(state.session, 1);
  assert.strictEqual(state.remainingSec, 15 * 60);
  assert.strictEqual(state.totalSec, 25 * 60);
  assert.strictEqual(state.source, 'server');
});

test('replay: lunch window → lunch mode with lunch flag', () => {
  const s = { ...getDefaultSettings(), workdaySync: true };
  const state = computeState(s, at(13, 30));
  assert.strictEqual(state.state, 'break');
  assert.strictEqual(state.mode, 'lunch');
  assert.strictEqual(state.lunch, true);
  assert.strictEqual(state.remainingSec, 30 * 60);
  assert.strictEqual(state.totalSec, 60 * 60);
});

test('replay: before-work counts down to the workday start', () => {
  const s = { ...getDefaultSettings(), workdaySync: true };
  const state = computeState(s, at(8, 30));
  assert.strictEqual(state.state, 'before-work');
  assert.strictEqual(state.remainingSec, 30 * 60);
});

test('replay: after-work when continueAfterWorkday is off', () => {
  const s = { ...getDefaultSettings(), workdaySync: true };
  const state = computeState(s, at(18, 5));
  assert.strictEqual(state.state, 'after-work');
});

test('replay: weekend is out-of-scope', () => {
  const s = { ...getDefaultSettings(), workdaySync: true };
  const state = computeState(s, at(10, 0, 0, 6)); // Saturday
  assert.strictEqual(state.state, 'out-of-scope');
  assert.strictEqual(state.synced, false);
});

test('replay: chain progression matches timer-core (breaks and sessions)', () => {
  const s = { ...getDefaultSettings(), workdaySync: true, lunchEnabled: false };
  // 25w + 5b = 30min blocks; session 2 work starts at 30min elapsed
  const work2 = computeState(s, at(9, 31));
  assert.strictEqual(work2.mode, 'work');
  assert.strictEqual(work2.session, 2);
  const short = computeState(s, at(9, 26));
  assert.strictEqual(short.mode, 'shortBreak');
  assert.strictEqual(short.session, 1);
  // long break after session 4: 4*(25+5)=120 → 11:00–11:15
  const long = computeState(s, at(11, 5));
  assert.strictEqual(long.mode, 'longBreak');
  assert.strictEqual(long.session, 4);
  const workAfterLong = computeState(s, at(11, 16));
  assert.strictEqual(workAfterLong.mode, 'work');
  assert.strictEqual(workAfterLong.session, 1);
});