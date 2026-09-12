/*
 * wspomo metrics API tests
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// fresh DATA_DIR per run
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wspomo-metrics-'));
process.env.DATA_DIR = dataDir;
// these tests verify the file-backed path — force it even when a DATABASE_URL
// is exported in the environment (storage path has its own tests)
delete process.env.DATABASE_URL;

const { app, metrics } = require('../server.js');

let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function cookieOf(res, name) {
  const c = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return c ? c.split(';')[0] : null;
}

test('visit: issues visitor cookie, counts one visitor', async () => {
  const res = await fetch(`${base}/api/track/visit`, { method: 'POST' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.isNewVisitor, true);

  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('wspomo_visitor='));
  assert.ok(cookie, 'visitor cookie set');
  const uuid = cookie.split(';')[0].split('=')[1];
  assert.match(uuid, /^[0-9a-f-]{36}$/);
  assert.ok(cookie.includes('HttpOnly'));

  const pub = await (await fetch(`${base}/api/metrics/public`)).json();
  assert.strictEqual(pub.today.visitors, 1);
  assert.strictEqual(pub.totalVisitors, 1);
});

test('visit: same cookie on same day does not double-count', async () => {
  const before = (await (await fetch(`${base}/api/metrics/public`)).json()).today.visitors;

  const first = await fetch(`${base}/api/track/visit`, { method: 'POST' });
  const jar = first.headers.getSetCookie().find((c) => c.startsWith('wspomo_visitor=')).split(';')[0];
  await fetch(`${base}/api/track/visit`, { method: 'POST', headers: { cookie: jar } });
  await fetch(`${base}/api/track/visit`, { method: 'POST', headers: { cookie: jar } });

  const after = (await (await fetch(`${base}/api/metrics/public`)).json()).today.visitors;
  assert.strictEqual(after - before, 1); // exactly one unique visitor added
});

test('heartbeat: focus minute and pomodoro counted; live now visible', async () => {
  const visit = await fetch(`${base}/api/track/visit`, { method: 'POST' });
  const jar = visit.headers.getSetCookie().find((c) => c.startsWith('wspomo_visitor=')).split(';')[0];

  const hb = await fetch(`${base}/api/track/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: jar },
    body: JSON.stringify({ focus: true, minutes: 2, pomodoro: true })
  });
  assert.strictEqual((await hb.json()).ok, true, 'heartbeat ok');

  const stats = await (await fetch(`${base}/api/metrics/public`)).json();
  assert.strictEqual(stats.today.focusMinutes, 2);
  assert.strictEqual(stats.today.pomodoros, 1);
  assert.ok(stats.liveNow >= 1);
});

test('heartbeat without visitor cookie → 400', async () => {
  const res = await fetch(`${base}/api/track/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ focus: true })
  });
  assert.strictEqual(res.status, 400);
});

test('heartbeat without body still touches live presence', async () => {
  const visit = await fetch(`${base}/api/track/visit`, { method: 'POST' });
  const jar = visit.headers.getSetCookie().find((c) => c.startsWith('wspomo_visitor=')).split(';')[0];
  const res = await fetch(`${base}/api/track/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: jar },
    body: JSON.stringify({})
  });
  assert.strictEqual(res.status, 200);
});

test('metrics persist across restart (file storage)', async () => {
  const stats1 = await (await fetch(`${base}/api/metrics/public`)).json();
  const focusBefore = stats1.today.focusMinutes;

  // simulate restart: flush to disk, stop, re-require fresh instance on same DATA_DIR
  metrics.flush();
  server.close();
  delete require.cache[require.resolve('../server.js')];
  delete require.cache[require.resolve('../lib/metrics.js')];
  const mod = require('../server.js');
  server = mod.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const stats2 = await (await fetch(`${base}/api/metrics/public`)).json();
  assert.strictEqual(stats2.today.focusMinutes, focusBefore);
  assert.ok(stats2.totalVisitors >= 1);
});

test('metrics file exists in DATA_DIR and is valid JSON', () => {
  const file = path.join(dataDir, 'metrics.json');
  assert.ok(fs.existsSync(file));
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(parsed.days);
  assert.ok(parsed.visitors);
});