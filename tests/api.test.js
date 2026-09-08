/*
 * wspomo API tests (server.js) — real HTTP on ephemeral port
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { app, getDefaultSettings } = require('../server.js');

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

// ---------- GET /api/settings ----------

test('GET /api/settings returns defaults on empty cookies', async () => {
  const res = await fetch(`${base}/api/settings`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), getDefaultSettings());
});

test('GET /api/settings merges wspomo_main cookie over defaults', async () => {
  const saved = {
    workDuration: 50,
    workdaySync: true,
    workdayStart: '08:30',
    lunchEnabled: false,
    continueAfterWorkday: true
  };
  const res = await fetch(`${base}/api/settings`, {
    headers: {
      cookie: `wspomo_main=${encodeURIComponent(JSON.stringify(saved))}`
    }
  });
  const data = await res.json();
  assert.strictEqual(data.workDuration, 50);
  assert.strictEqual(data.workdaySync, true);
  assert.strictEqual(data.workdayStart, '08:30');
  assert.strictEqual(data.lunchEnabled, false);
  assert.strictEqual(data.continueAfterWorkday, true);
  // untouched fields stay default
  assert.strictEqual(data.shortBreakDuration, 5);
  assert.strictEqual(data.theme, 'mocha');
});

test('GET /api/settings reads legacy pomodoro_settings cookie', async () => {
  const legacy = {
    workDuration: 40,
    language: 'en',
    workDays: [1, 6]
  };
  const res = await fetch(`${base}/api/settings`, {
    headers: {
      cookie: `pomodoro_settings=${encodeURIComponent(JSON.stringify(legacy))}`
    }
  });
  const data = await res.json();
  assert.strictEqual(data.workDuration, 40);
  assert.strictEqual(data.language, 'en');
  assert.deepStrictEqual(data.workDays, [1, 6]);
});

test('GET /api/settings prefers new cookies over legacy', async () => {
  const main = { workDuration: 33 };
  const legacy = { workDuration: 40 };
  const res = await fetch(`${base}/api/settings`, {
    headers: {
      cookie: [
        `wspomo_main=${encodeURIComponent(JSON.stringify(main))}`,
        `wspomo_lang=en`,
        `wspomo_days=${encodeURIComponent(JSON.stringify([1]))}`
      ].join('; ')
    }
  });
  const data = await res.json();
  assert.strictEqual(data.workDuration, 33);
  assert.strictEqual(data.language, 'en');
  assert.deepStrictEqual(data.workDays, [1]);
});

test('GET /api/settings survives malformed cookie JSON', async () => {
  const res = await fetch(`${base}/api/settings`, {
    headers: { cookie: 'wspomo_main=not-json-at-all' }
  });
  const data = await res.json();
  // parseCookie returns null on bad JSON → defaults shine through
  assert.deepStrictEqual(data, getDefaultSettings());
});

// ---------- POST /api/settings ----------

test('POST /api/settings stores main cookie and echoes ok', async () => {
  const payload = {
    workDuration: 45,
    workdaySync: true,
    workdayStart: '10:00',
    lunchEnabled: false,
    workdayEnd: '19:00',
    language: 'en',
    theme: 'latte',
    workDays: [1, 2, 3]
  };
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });

  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('wspomo_main=')));
  assert.ok(cookies.some((c) => c.startsWith('wspomo_lang=en')));
  assert.ok(cookies.some((c) => c.startsWith('wspomo_days=')));
  assert.ok(cookies.some((c) => c.startsWith('wspomo_theme=latte')));

  // round-trip: saved settings come back
  const mainCookie = cookies.find((c) => c.startsWith('wspomo_main='));
  const jar = mainCookie.split(';')[0];
  const round = await fetch(`${base}/api/settings`, {
    headers: { cookie: jar }
  });
  const data = await round.json();
  const saved = JSON.parse(decodeURIComponent(jar.split('=')[1]));
  assert.strictEqual(data.workDuration, saved.workDuration);
  assert.strictEqual(data.workDuration, 45);
  // language lives in its own cookie, not in wspomo_main → not merged from jar alone
  assert.strictEqual(data.language, null);
});

test('POST /api/settings without language/days/theme skips those cookies', async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workDuration: 15 })
  });
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('wspomo_main=')));
  assert.ok(!cookies.some((c) => c.startsWith('wspomo_lang=')));
  assert.ok(!cookies.some((c) => c.startsWith('wspomo_days=')));
  assert.ok(!cookies.some((c) => c.startsWith('wspomo_theme=')));
});

test('POST /api/settings ignores non-array workDays', async () => {
  const res = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workDuration: 25, workDays: 'mon-fri' })
  });
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('wspomo_main=')));
  assert.ok(!cookies.some((c) => c.startsWith('wspomo_days=')));
});