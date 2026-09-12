/*
 * wspomo storage tests — real Postgres (black-box, KT-1: no ORM)
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createStorage } = require('../lib/storage.js');

const DATABASE_URL = process.env.TEST_DATABASE_URL;

// These tests run against a live Postgres (docker-compose postgres or CI
// services block). Skip cleanly when no database is configured.
const hasDb = Boolean(DATABASE_URL);

let storage;

if (hasDb) {
  test.before(async () => {
    storage = createStorage({ databaseUrl: DATABASE_URL });
    await storage.init();
    // fresh slate: tests assert exact aggregate values
    await storage.pool.query('TRUNCATE metrics_visitors, metrics_daily, sessions, settings, users');
  });
  test.after(async () => {
    await storage.close();
  });
}

// ---------- metrics: daily aggregates ----------

test('metrics: unique visitor counted once per day', { skip: !hasDb }, async () => {
  const day = '2026-09-12';
  const uuid = '11111111-1111-1111-1111-111111111111';
  await storage.touchVisitor(uuid, day);
  await storage.touchVisitor(uuid, day); // duplicate — must not double-count
  const stats = await storage.publicStats(day);
  assert.strictEqual(stats.today.visitors, 1);
  assert.strictEqual(stats.totalVisitors, 1);
});

test('metrics: same uuid on another day counts again', { skip: !hasDb }, async () => {
  await storage.touchVisitor('11111111-1111-1111-1111-111111111111', '2026-09-13');
  const stats = await storage.publicStats('2026-09-13');
  assert.strictEqual(stats.today.visitors, 1);
  assert.strictEqual(stats.totalVisitors, 2); // two distinct days
});

test('metrics: focus minutes and pomodoros accumulate', { skip: !hasDb }, async () => {
  const day = '2026-09-12';
  await storage.addFocusMinutes(day, 5);
  await storage.addFocusMinutes(day, 3);
  await storage.addPomodoro(day);
  await storage.addPomodoro(day);
  await storage.addPomodoro(day);
  const stats = await storage.publicStats(day);
  assert.strictEqual(stats.today.focusMinutes, 8);
  assert.strictEqual(stats.today.pomodoros, 3);
});

test('metrics: empty day returns zeros', { skip: !hasDb }, async () => {
  const stats = await storage.publicStats('2030-01-01');
  assert.deepStrictEqual(stats.today, { date: '2030-01-01', visitors: 0, focusMinutes: 0, pomodoros: 0 });
  assert.strictEqual(stats.totalVisitors, 2); // earlier days still counted
});

// ---------- settings ----------

test('settings: set then get, upsert overwrites', { skip: !hasDb }, async () => {
  const user = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['st-1@example.com']);
  const uid = user.rows[0].id;
  await storage.setSettings(uid, { workdayStart: '08:30', timezone: 'Europe/Moscow' });
  await storage.setSettings(uid, { workdayStart: '09:00' }); // upsert
  const data = await storage.getSettings(uid);
  assert.strictEqual(data.workdayStart, '08:00'.replace('08:00', '09:00'));
  assert.strictEqual(data.timezone, undefined); // full replace, not merge
  assert.strictEqual(await storage.getSettings(999999), null);
});

// ---------- sessions / API tokens ----------

test('sessions: create, find by token, wrong token, revoke', { skip: !hasDb }, async () => {
  const user = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['st-2@example.com']);
  const uid = user.rows[0].id;
  await storage.createSession(uid, 'api', 'token-abc', { label: 'waybar' });
  const found = await storage.findSessionByToken('token-abc');
  assert.strictEqual(found.type, 'api');
  assert.strictEqual(found.label, 'waybar');
  assert.strictEqual(found.user_id, uid);
  assert.strictEqual(await storage.findSessionByToken('token-wrong'), null);
  await storage.revokeSession(found.id);
  assert.strictEqual(await storage.findSessionByToken('token-abc'), null);
});

test('sessions: web and api kinds coexist', { skip: !hasDb }, async () => {
  const user = await storage.pool.query("INSERT INTO users (email) VALUES ($1) RETURNING id", ['st-3@example.com']);
  const uid = user.rows[0].id;
  await storage.createSession(uid, 'web', 'web-token');
  await storage.createSession(uid, 'api', 'api-token');
  assert.strictEqual((await storage.findSessionByToken('web-token')).type, 'web');
  assert.strictEqual((await storage.findSessionByToken('api-token')).type, 'api');
});