/*
 * wspomo active-report tests — browser-relayed timer state for /api/state
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// file-backed path (storage has its own tests against a live database)
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

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/wspomo_visitor=([0-9a-f-]{36})/);
  return m ? `wspomo_visitor=${m[1]}` : null;
}

async function newVisitor() {
  const res = await fetch(`${base}/api/track/visit`, { method: 'POST' });
  const cookie = cookieFrom(res);
  assert.ok(cookie, 'visitor cookie must be set');
  visitorCookies.push(cookie);
  return cookie;
}

async function reportActive(cookie, active) {
  const body = active === undefined ? {} : { active };
  return fetch(`${base}/api/track/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body)
  });
}

async function getState(cookie) {
  const res = await fetch(`${base}/api/state`, { headers: cookie ? { cookie } : {} });
  return res.json();
}

// Reports are global pre-auth (single-user semantics, KT-1) — tests share the
// server's activeReports map, so each test clears reports from all previously
// created visitors before asserting on replay fallback.
const visitorCookies = [];

async function clearAllReports() {
  for (const cookie of visitorCookies) {
    await reportActive(cookie, null);
  }
}

// ---------- input validation ----------

test('heartbeat without visitor cookie → 400', async () => {
  const res = await fetch(`${base}/api/track/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: null })
  });
  assert.strictEqual(res.status, 400);
});

test('invalid active report (unknown mode) is ignored — replay stays in charge', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'party', remainingSec: 60, totalSec: 1500 });
  const state = await getState(cookie);
  assert.notStrictEqual(state.source, 'client');
});

test('invalid active report (bad remainingSec) is ignored', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'work', remainingSec: -5, totalSec: 1500 });
  const state = await getState(cookie);
  assert.notStrictEqual(state.source, 'client');
});

// ---------- happy path ----------

test('active report (work, free-form) is relayed by /api/state', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'work', remainingSec: 960, totalSec: 1500, session: 2 });
  const state = await getState(cookie);
  assert.strictEqual(state.source, 'client');
  assert.strictEqual(state.state, 'work');
  assert.strictEqual(state.mode, 'work');
  assert.strictEqual(state.session, 2);
  // snapshot ticks forward server-side (interpolation between relays)
  assert.ok(state.remainingSec <= 960 && state.remainingSec >= 950,
    `expected 950..960 after tick-forward, got ${state.remainingSec}`);
  assert.strictEqual(state.totalSec, 1500);
  assert.strictEqual(state.lunch, false);
  assert.strictEqual(state.synced, true);
});

test('snapshot interpolation: remainingSec decreases with elapsed time', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'work', remainingSec: 300, totalSec: 1500 });
  const first = await getState(cookie);
  await new Promise((r) => setTimeout(r, 2100));
  const second = await getState(cookie);
  assert.strictEqual(second.source, 'client');
  assert.ok(
    second.remainingSec <= first.remainingSec - 2,
    `expected >=2s decay: ${first.remainingSec} -> ${second.remainingSec}`
  );
});

test('active report lunch → state=break, mode=lunch, lunch=true', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'lunch', remainingSec: 600, totalSec: 3600 });
  const state = await getState(cookie);
  assert.strictEqual(state.source, 'client');
  assert.strictEqual(state.state, 'break');
  assert.strictEqual(state.mode, 'lunch');
  assert.strictEqual(state.lunch, true);
});

test('active: null clears the report → replay takes over', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'work', remainingSec: 960, totalSec: 1500, session: 1 });
  let state = await getState(cookie);
  assert.strictEqual(state.source, 'client');

  await reportActive(cookie, null); // browser signals idle
  state = await getState(cookie);
  assert.notStrictEqual(state.source, 'client');
});

test('Bearer token on active-report state keeps auth field', async () => {
  await clearAllReports();
  const cookie = await newVisitor();
  await reportActive(cookie, { mode: 'work', remainingSec: 100, totalSec: 1500 });
  const res = await fetch(`${base}/api/state`, {
    headers: { cookie, authorization: 'Bearer tok' }
  });
  const state = await res.json();
  assert.strictEqual(state.source, 'client');
  assert.strictEqual(state.auth, 'recognized');
});

test('another visitor does not see someone else active report is out of scope pre-auth (documented behaviour)', async () => {
  // pre-auth: reports are global (single-user standalone semantics, KT-1).
  // This test documents current behaviour: last report wins for any caller.
  const cookieA = await newVisitor();
  const cookieB = await newVisitor();
  await reportActive(cookieA, { mode: 'work', remainingSec: 100, totalSec: 1500 });
  const stateB = await getState(cookieB);
  assert.strictEqual(stateB.source, 'client');
});