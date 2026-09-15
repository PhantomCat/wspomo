/*
 * wspomo GET /api/state tests — relay-only contract (issue #2, decision 15.09)
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

const SHAPE_KEYS = ['synced', 'state', 'mode', 'session', 'remainingSec', 'totalSec', 'lunch', 'serverTime'];

// ---------- black-box: HTTP contract ----------

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

test('Bearer token on idle state keeps auth field (auth seam placeholder)', async () => {
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

test('unknown ?tz is accepted (schedule replay removed — no tz parsing)', async () => {
  // The relay-only contract has no server-side schedule math left, so the
  // legacy 400 invalid_timezone branch is gone; the query is simply unused.
  const res = await fetch(`${base}/api/state?tz=Mars/Olympus`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.state, 'idle');
});