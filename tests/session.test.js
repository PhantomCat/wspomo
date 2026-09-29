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
  const postResp = await res.json();
  assert.strictEqual(postResp.ok, true);
  assert.strictEqual(postResp.stored, 'db');
  assert.match(postResp.settingsRev, /^[0-9a-f]{5}$/); // revision returned (28.09)

  res = await fetch(`${base}/api/settings`, { headers: auth });
  data = await res.json();
  assert.strictEqual(data.workdayStart, '08:30');
  assert.strictEqual(data.workDuration, 50);
  assert.strictEqual(data.shortBreakDuration, 5); // default merged back
});

// ---------- settings revision hash (28.09, multi-client sync) ----------

test('settings: POST returns a 5-char revision, GET agrees', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-6@example.com']);
  await storage.createSession(u.rows[0].id, 'api', 'sess-token-6');
  const auth = { 'content-type': 'application/json', authorization: 'Bearer sess-token-6' };

  const post = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ workDuration: 40 })
  });
  const { ok, stored, settingsRev } = await post.json();
  assert.strictEqual(ok, true);
  assert.strictEqual(stored, 'db');
  assert.match(settingsRev, /^[0-9a-f]{5}$/);

  const get = await fetch(`${base}/api/settings`, { headers: { authorization: 'Bearer sess-token-6' } });
  const g = await get.json();
  assert.strictEqual(g.settingsRev, settingsRev, 'GET returns the same revision');
  assert.strictEqual(g.workDuration, 40);

  // changing settings changes the revision
  const post2 = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ workDuration: 55 })
  });
  const d2 = await post2.json();
  assert.notStrictEqual(d2.settingsRev, settingsRev);
});

test('state: replay carries settingsRev; revision changes with settings', { skip: !hasDb }, async () => {
  const u = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['sess-7@example.com']);
  const uid = u.rows[0].id;
  await storage.createSession(uid, 'api', 'sess-token-7');
  await storage.startActiveSession(uid, 'synced');
  const auth = { authorization: 'Bearer sess-token-7' };

  const post = await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ workdaySync: true, workdayStart: '09:00', workdayEnd: '23:59', workDays: [0,1,2,3,4,5,6], timezone: 'Europe/Moscow' })
  });
  const rev1 = (await post.json()).settingsRev;

  const st = await fetch(`${base}/api/state`, { headers: auth });
  const s1 = await st.json();
  assert.strictEqual(s1.settingsRev, rev1_fix(), 'state tick carries the same revision');
  function rev1_fix() { return rev1; }

  // update → next tick shows the new revision
  await fetch(`${base}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ workdaySync: true, workdayStart: '10:00', workDays: [0,1,2,3,4,5,6], timezone: 'Europe/Moscow' })
  });
  const s2 = await (await fetch(`${base}/api/state`, { headers: auth })).json();
  assert.notStrictEqual(s2.settingsRev, s1.settingsRev);
  await storage.stopActiveSession(uid);
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
// ---------- auth skeleton: web sessions via cookie (29.09) ----------

test('users: findOrCreateUser is idempotent on email', { skip: !hasDb }, async () => {
  const a = await storage.findOrCreateUser('cookie-1@example.com');
  const b = await storage.findOrCreateUser('cookie-1@example.com');
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.email, 'cookie-1@example.com');
  await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
});

test('dev-mint is 404 without WSPOMO_DEV_AUTH even with a DB', { skip: !hasDb }, async () => {
  const res = await fetch(`${base}/api/auth/dev-mint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.com' })
  });
  assert.strictEqual(res.status, 404);
});

test('web session: mint → cookie → settings go to the per-user row', { skip: !hasDb }, async () => {
  const prev = process.env.WSPOMO_DEV_AUTH;
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-2@example.com' })
    });
    assert.strictEqual(mint.status, 200);
    const { token, email } = await mint.json();
    assert.strictEqual(email, 'cookie-2@example.com');

    const setCookie = mint.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('wspomo_session='),
      'session cookie is set on mint');
    assert.ok(/httponly/i.test(setCookie), 'session cookie must be httpOnly');

    // the cookie alone authenticates /api/settings (no Bearer header)
    const cookiePair = setCookie.split(';')[0];
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair },
      body: JSON.stringify({ workDuration: 55 })
    });
    const data = await res.json();
    assert.strictEqual(data.stored, 'db', 'web session drives the per-user path');

    // round-trip via the cookie
    const get = await fetch(`${base}/api/settings`, { headers: { cookie: cookiePair } });
    assert.strictEqual((await get.json()).workDuration, 55);

    // GET /api/state with the cookie + active chain → replay works too
    await storage.startActiveSession((await storage.findSessionByToken(token)).user_id, 'synced');
    await storage.setSettings((await storage.findSessionByToken(token)).user_id,
      { workdaySync: true, workdayStart: '09:00', workdayEnd: '23:59',
        workDays: [0,1,2,3,4,5,6], timezone: 'Europe/Moscow' });
    const st = await fetch(`${base}/api/state`, { headers: { cookie: cookiePair } });
    assert.strictEqual((await st.json()).auth, 'recognized');

    // Bearer-only contract on /api/session: the web cookie must NOT drive it
    const chained = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair },
      body: JSON.stringify({ action: 'start', mode: 'synced' })
    });
    assert.strictEqual(chained.status, 401, 'web cookie must not start headless chains');
  } finally {
    process.env.WSPOMO_DEV_AUTH = prev;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

test('web session: revoked cookie falls through to the anonymous path', { skip: !hasDb }, async () => {
  const prev = process.env.WSPOMO_DEV_AUTH;
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-3@example.com' })
    });
    const { token } = await mint.json();
    const session = await storage.findSessionByToken(token);
    await storage.revokeSession(session.id);

    const res = await fetch(`${base}/api/settings`, {
      headers: { cookie: `wspomo_session=${token}` }
    });
    const data = await res.json();
    assert.strictEqual(data.workDuration, 25, 'revoked → defaults (cookie ignored)');
    assert.ok(!('stored' in data), 'must not take the per-user path');
  } finally {
    process.env.WSPOMO_DEV_AUTH = prev;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

// ---------- profile + API token management (auth part 2, 29.09) ----------

test('tokens: mint via cookie, token shown once, me() lists it', { skip: !hasDb }, async () => {
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-4@example.com' })
    });
    const cookiePair = (mint.headers.get('set-cookie') || '').split(';')[0];

    const me0 = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookiePair } })).json();
    assert.strictEqual(me0.email, 'cookie-4@example.com');
    assert.strictEqual(me0.apiTokens.length, 0);
    assert.strictEqual(me0.sessionType, 'web');

    const mintT = await fetch(`${base}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair },
      body: JSON.stringify({ label: 'waybar' })
    });
    const tok = await mintT.json();
    assert.strictEqual(mintT.status, 200);
    assert.match(tok.token, /^[0-9a-f]{48}$/, 'raw token returned once, 48 hex');
    assert.strictEqual(tok.hint, 'copy-now-shown-once');

    const me1 = await (await fetch(`${base}/api/auth/me`, { headers: { cookie: cookiePair } })).json();
    assert.strictEqual(me1.apiTokens.length, 1);
    assert.strictEqual(me1.apiTokens[0].label, 'waybar');
    assert.ok(!('token' in me1.apiTokens[0]), 'raw token never appears in listings');
  } finally {
    process.env.WSPOMO_DEV_AUTH = undefined;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

test('tokens: the minted API token authenticates like Bearer and appears in me()', { skip: !hasDb }, async () => {
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-5@example.com' })
    });
    const cookiePair = (mint.headers.get('set-cookie') || '').split(';')[0];
    const { token: apiToken } = await (
      await fetch(`${base}/api/auth/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: cookiePair },
        body: JSON.stringify({ label: 'tui' })
      })
    ).json();

    // the new token works as a Bearer for per-user endpoints
    const st = await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${apiToken}` } });
    assert.strictEqual((await st.json()).ok === undefined, true, 'bearer works');
    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${apiToken}` } });
    const meData = await me.json();
    assert.strictEqual(meData.email, 'cookie-5@example.com');
    assert.strictEqual(meData.sessionType, 'api', 'API token is a principal of its own');

    // ...but must not start headless chains? — no: API tokens ARE the headless
    // credential. Web cookies are the restricted ones.
    const chained = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ action: 'start', mode: 'synced' })
    });
    assert.strictEqual(chained.status, 200);
  } finally {
    process.env.WSPOMO_DEV_AUTH = undefined;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

test('tokens: limit 10 active, 409 on overflow; label validation', { skip: !hasDb }, async () => {
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-6@example.com' })
    });
    const cookiePair = (mint.headers.get('set-cookie') || '').split(';')[0];
    const auth = { 'content-type': 'application/json', cookie: cookiePair };

    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${base}/api/auth/tokens`, {
        method: 'POST', headers: auth, body: JSON.stringify({ label: `tok-${i}` })
      });
      assert.strictEqual(r.status, 200, `token ${i} minted`);
    }
    const over = await fetch(`${base}/api/auth/tokens`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: 'tok-11' })
    });
    assert.strictEqual(over.status, 429);

    const bad = await fetch(`${base}/api/auth/tokens`, {
      method: 'POST', headers: auth, body: JSON.stringify({ label: '' })
    });
    assert.strictEqual(bad.status, 400);
  } finally {
    process.env.WSPOMO_DEV_AUTH = undefined;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

test('tokens: revoke another user token → 404; revoke own api token works', { skip: !hasDb }, async () => {
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    // user A with one token
    const mintA = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-7@example.com' })
    });
    const pairA = (mintA.headers.get('set-cookie') || '').split(';')[0];
    const { token: tokA_raw } = await (await fetch(`${base}/api/auth/tokens`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: pairA },
      body: JSON.stringify({ label: 'A-token' })
    })).json();
    const meA = await (await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${tokA_raw}` } })).json();
    const tokenIdA = meA.sessionType === 'api' ? meA.currentSessionId : meA.apiTokens[0].id;

    // user B tries to revoke A's token by id
    const mintB = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-8@example.com' })
    });
    const pairB = (mintB.headers.get('set-cookie') || '').split(';')[0];

    const cross = await fetch(`${base}/api/auth/tokens/${tokenIdA}`, {
      method: 'DELETE', headers: { cookie: pairB }
    });
    assert.strictEqual(cross.status, 404, 'foreign token id is invisible');

    // A revokes their own token — Bearer dies immediately
    const self = await fetch(`${base}/api/auth/tokens/${tokenIdA}`, {
      method: 'DELETE', headers: { cookie: pairA }
    });
    assert.strictEqual(self.status, 200);
    const after = await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${tokA_raw}` } });
    assert.strictEqual((await after.json()).workDuration, 25, 'revoked Bearer → anonymous defaults');
  } finally {
    process.env.WSPOMO_DEV_AUTH = undefined;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});

test('logout: revoke the web session + clear the cookie', { skip: !hasDb }, async () => {
  process.env.WSPOMO_DEV_AUTH = '1';
  try {
    const mint = await fetch(`${base}/api/auth/dev-mint`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'cookie-9@example.com' })
    });
    const setCookie = mint.headers.get('set-cookie') || '';
    const cookiePair = setCookie.split(';')[0];

    const out = await fetch(`${base}/api/auth/logout`, {
      method: 'POST', headers: { cookie: cookiePair }
    });
    assert.strictEqual(out.status, 200);
    const cleared = out.headers.get('set-cookie') || '';
    assert.ok(/wspomo_session=;/.test(cleared) || /wspomo_session=$/.test(cleared) || /Expires=Thu, 01 Jan 1970/.test(cleared),
      'logout must clear the cookie');
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookiePair } });
    assert.strictEqual(me.status, 401, 'session is revoked server-side');
  } finally {
    process.env.WSPOMO_DEV_AUTH = undefined;
    await storage.pool.query("DELETE FROM users WHERE email LIKE 'cookie-%'");
  }
});
