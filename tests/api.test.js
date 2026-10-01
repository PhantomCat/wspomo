/*
 * wspomo API tests (server.js) — real HTTP on ephemeral port
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
// file-backed path (storage has its own tests against a live database)
delete process.env.DATABASE_URL;

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
// ---------- CORS for connected frontends (task 22.09) ----------

test('OPTIONS preflight on /api/state answers CORS headers', async () => {
  const res = await fetch(`${base}/api/state`, { method: 'OPTIONS' });
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.ok(res.headers.get('access-control-allow-headers').toLowerCase().includes('authorization'));
});

test('GET /api/state carries CORS headers for cross-origin pages', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
});

test('OPTIONS preflight on /api/settings and /api/session', async () => {
  for (const ep of ['/api/settings', '/api/session']) {
    const res = await fetch(`${base}${ep}`, { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204, ep);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*', ep);
  }
});

// ---------- SaaS preseed (task 30.09, variant 1) ----------

test('index.html serves standalone without WSPOMO_SAAS_URL', async () => {
  // this server booted without the env: the marker stays a plain comment
  const res = await fetch(`${base}/`);
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('<!-- WSPOMO_SAAS_PRESEED -->'), 'marker untouched in OSS mode');
  // the page's own JS references the global, so test the assignment itself
  assert.ok(!/<script>window\.WSPOMO_SAAS_URL = /.test(body), 'no preseed injected');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('static files keep flowing with index:false', async () => {
  const res = await fetch(`${base}/js/timer-core.js`);
  assert.strictEqual(res.status, 200);
});

test('demo stack preseeds WSPOMO_DEMO alongside the SaaS URL', async () => {
  // demo flag is read at module load → child process with its own env
  const { spawnSync } = require('node:child_process');
  const out = spawnSync(process.execPath, ['-e', `
    const { app } = require('./server.js');
    app.listen(3299, '127.0.0.1', async () => {
      let body = '';
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          body = await (await fetch('http://127.0.0.1:3299/')).text();
          break;
        } catch (e) { /* still warming up */ }
      }
      console.log(body.includes('window.WSPOMO_DEMO = true') ? 'DEMO' : 'PLAIN');
      process.exit(0);
    });
  `], { env: { ...process.env, WSPOMO_SAAS_URL: 'https://demo.test', WSPOMO_DEMO: '1' }, cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
  assert.ok(out.stdout.includes('DEMO'), `expected demo preseed, got: ${out.stdout} ${out.stderr}`);
}, { skip: false });
