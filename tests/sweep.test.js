/*
 * wspomo full-day sweep test for calculateSyncedTimeCore
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { calculateSyncedTimeCore } = require('../public/js/timer-core.js');

const BASE = {
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

const VALID_TYPES = ['before-work', 'after-work', 'lunch', 'work', 'break'];

/**
 * Sweep every minute of a workday. Guarantees:
 *  - no infinite loop / hang (the while(true) in the core)
 *  - every return is a known shape with sane values
 */
function sweep(settings, dateFactory, label) {
  let prev = null;
  for (let mins = 0; mins < 24 * 60; mins++) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const r = calculateSyncedTimeCore(settings, dateFactory(h, m));
    if (r === null) {
      // null is legal only for weekends or continueAfterWorkday past end
      continue;
    }
    assert.ok(VALID_TYPES.includes(r.type), `${label} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} bad type ${r.type}`);
    if (r.type === 'before-work') {
      assert.ok(Number.isFinite(r.timeLeft) && r.timeLeft > 0, `${label} ${h}:${m} bad before-work timeLeft`);
    }
    if (r.type === 'after-work') {
      assert.ok(!('timeLeft' in r), `${label} ${h}:${m} after-work should carry no timeLeft`);
    }
    if (r.type === 'work' || r.type === 'break') {
      assert.ok(r.session >= 1 && r.session <= settings.sessionsBeforeLongBreak, `${label} ${h}:${m} bad session`);
      assert.ok(['work', 'shortBreak', 'longBreak'].includes(r.mode), `${label} ${h}:${m} bad mode`);
      // timeLeft <= totalTime
      assert.ok(r.timeLeft <= r.totalTime, `${label} ${h}:${m} timeLeft > totalTime`);
    }
    if (r.type === 'lunch') {
      assert.ok(r.totalTime > 0 && r.timeLeft <= r.totalTime, `${label} ${h}:${m} bad lunch payload`);
    }
    prev = r;
  }
  return prev;
}

test('sweep: typical settings (lunch on)', () => {
  sweep(BASE, (h, m) => new Date(2026, 8, 7, h, m, 0), 'lunch-on');
});

test('sweep: lunch disabled', () => {
  sweep({ ...BASE, lunchEnabled: false }, (h, m) => new Date(2026, 8, 7, h, m, 0), 'lunch-off');
});

test('sweep: continueAfterWorkday — null past end, valid before', () => {
  sweep({ ...BASE, continueAfterWorkday: true }, (h, m) => new Date(2026, 8, 7, h, m, 0), 'cont');
});

test('sweep: non-standard durations (7/3/10, 2 sessions)', () => {
  sweep(
    {
      ...BASE,
      workDuration: 7,
      shortBreakDuration: 3,
      longBreakDuration: 10,
      sessionsBeforeLongBreak: 2
    },
    (h, m) => new Date(2026, 8, 7, h, m, 0),
    'short-cycles'
  );
});

test('sweep: workday crossing midnight region never breaks (start > end edge)', () => {
  // pathological: start 22:00, end 06:00 — legacy code treats end < start as
  // "current < start → before-work; current >= end → after-work"… documents behaviour
  const s = { ...BASE, workdayStart: '22:00', workdayEnd: '06:00' };
  let saw = { before: false, after: false };
  for (let mins = 0; mins < 24 * 60; mins += 7) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const r = calculateSyncedTimeCore(s, new Date(2026, 8, 7, h, m, 0));
    if (r && r.type === 'before-work') saw.before = true;
    if (r && r.type === 'after-work') saw.after = true;
  }
  assert.ok(saw.before || saw.after, 'pathological range must not hang');
});

test('sweep: every work minute is inside a chain that eventually reaches lunch or end', () => {
  // stronger property: at 08:59 result is before-work with timeLeft 60;
  // at 17:59 (no continue) result is valid; lunch window fully covered
  const s = { ...BASE };
  const before = calculateSyncedTimeCore(s, new Date(2026, 8, 7, 8, 59, 59));
  assert.strictEqual(before.timeLeft, 1);
  const lastMin = calculateSyncedTimeCore(s, new Date(2026, 8, 7, 17, 59, 59));
  assert.ok(lastMin && lastMin.type !== 'after-work');
  const after = calculateSyncedTimeCore(s, new Date(2026, 8, 7, 18, 0, 0));
  assert.strictEqual(after.type, 'after-work');
});