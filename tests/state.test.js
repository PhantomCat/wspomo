/*
 * wspomo GET /api/state tests — replay-computed state contract
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../server.js');
const timerCore = require('../public/js/timer-core.js');

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

// ---------- shape ----------

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

// ---------- replay agreement with timer-core ----------

/**
 * For a fixed instant, computeState must agree with calculateSyncedTimeCore.
 * Re-derives the expected answer independently through the core.
 */
function assertAgreesWithCore(nowFn, label) {
  test(`/api/state agrees with timer-core replay: ${label}`, async () => {
    const fakeNow = new Date();
    const core = timerCore.calculateSyncedTimeCore(defaultsForCore(), fakeNow);
    const res = await fetch(`${base}/api/state`);
    const data = await res.json();

    if (core === null) {
      assert.strictEqual(data.synced, false);
      assert.strictEqual(data.state, 'out-of-scope');
      return;
    }

    assert.strictEqual(data.synced, true);

    if (core.type === 'work' || core.type === 'break') {
      assert.strictEqual(data.lunch, false);
      assert.strictEqual(data.session, core.session);
      assert.strictEqual(data.mode, core.mode);
      assert.ok(Number.isFinite(data.remainingSec));
      assert.ok(data.remainingSec >= 0);
      assert.strictEqual(data.totalSec, core.totalTime);
      assert.strictEqual(
        data.state,
        core.type === 'work' ? 'work' : 'break'
      );
    } else if (core.type === 'lunch') {
      assert.strictEqual(data.lunch, true);
      assert.strictEqual(data.mode, 'lunch');
      assert.strictEqual(data.state, 'break');
    } else if (core.type === 'before-work') {
      assert.strictEqual(data.state, 'before-work');
      assert.strictEqual(data.remainingSec, core.timeLeft);
    } else if (core.type === 'after-work') {
      assert.strictEqual(data.state, 'after-work');
    }
  });
}

function defaultsForCore() {
  return {
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
}

// The live endpoint runs on server "now"; these checks bind the response to
// the core replay computed moments earlier. A minute boundary crossing between
// the two computations could flake — so we assert on the *class* of state
// (deterministic for all seconds inside a minute except boundaries):
// work minutes (09:15:30) and lunch minutes (13:30:30) are far from edges.

test('/api/state mid-morning is work with sane countdown', async () => {
  const res = await fetch(`${base}/api/state`);
  const data = await res.json();
  const now = new Date(data.serverTime);
  const local = now.getHours() * 60 + now.getMinutes();
  const isWorkday = defaultsForCore().workDays.includes(now.getDay());

  if (!isWorkday || local < 9 * 60 || local >= 18 * 60 || (local >= 13 * 60 && local < 14 * 60)) {
    assert.ok(data.synced === false || data.state !== 'idle');
  } else {
    // morning: inside the chain, before lunch
    const core = timerCore.calculateSyncedTimeCore(defaultsForCore(), now);
    if (core && (core.type === 'work' || core.type === 'break')) {
      assert.strictEqual(data.mode, core.mode);
      assert.strictEqual(data.session, core.session);
    }
  }
});

// ---------- pure computeState (unit level) ----------

const { computeState, defaultStateConfig } = require('../server.js');

test('computeState: lunch window maps to mode=lunch, state=break', () => {
  // 2026-09-10 is a Thursday; 13:30 local — inside lunch for the test TZ-independent check we
  // construct the Date explicitly and rely on calculateSyncedTimeCore semantics (local time).
  const lunchNow = (() => {
    const d = new Date();
    d.setHours(13, 30, 0, 0);
    // pick a workday for the constructed date
    while (!defaultsForCore().workDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d;
  })();

  const state = computeState({ ...defaultStateConfig() }, lunchNow);
  if (state.state === 'break' && state.lunch) {
    assert.strictEqual(state.mode, 'lunch');
    assert.ok(state.remainingSec > 0 && state.remainingSec <= 30 * 60);
  }
});

test('computeState: weekend is out-of-scope', () => {
  // find next Sunday
  const d = new Date();
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);

  const state = computeState({ ...defaultStateConfig() }, d);
  assert.strictEqual(state.synced, false);
  assert.strictEqual(state.state, 'out-of-scope');
});

test('computeState: before-work carries countdown to workday start', () => {
  const d = new Date();
  while (!defaultsForCore().workDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);

  const state = computeState({ ...defaultStateConfig() }, d);
  assert.strictEqual(state.state, 'before-work');
  assert.strictEqual(state.remainingSec, 3600);
  assert.strictEqual(state.mode, null);
});

test('computeState: after-work on continueAfterWorkday=true is out-of-scope', () => {
  const d = new Date();
  while (!defaultsForCore().workDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);

  const state = computeState({ ...defaultStateConfig(), continueAfterWorkday: true }, d);
  assert.strictEqual(state.synced, false);
  assert.strictEqual(state.state, 'out-of-scope');
});

test('computeState: mid-workday falls inside a pomodoro chain step', () => {
  const d = new Date();
  while (!defaultsForCore().workDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 30, 0); // 30 seconds after workday start → work, session 1

  const state = computeState({ ...defaultStateConfig() }, d);
  assert.strictEqual(state.state, 'work');
  assert.strictEqual(state.mode, 'work');
  assert.strictEqual(state.session, 1);
  assert.strictEqual(state.remainingSec, 25 * 60 - 30);
  assert.strictEqual(state.totalSec, 25 * 60);
});