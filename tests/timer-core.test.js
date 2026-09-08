/*
 * wspomo timer-core tests
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  parseTimeToMinutes,
  normalizeRawTime,
  maskTimeValue,
  validateLunchTimes,
  getNextModeCore,
  calculateSyncedTimeCore
} = require('../public/js/timer-core.js');

// ---------- helpers ----------

const BASE_SETTINGS = {
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

function settingsAt(overrides) {
  return { ...BASE_SETTINGS, ...overrides };
}

// Monday 2026-09-07 is a workday; Sunday 2026-09-06 is not.
function at(h, m, s = 0) {
  return new Date(2026, 8, 7, h, m, s);
}

function atSunday(h, m, s = 0) {
  return new Date(2026, 8, 6, h, m, s);
}

// ---------- parseTimeToMinutes ----------

test('parseTimeToMinutes: valid values', () => {
  assert.strictEqual(parseTimeToMinutes('09:00'), 540);
  assert.strictEqual(parseTimeToMinutes('0:30'), 30);
  assert.strictEqual(parseTimeToMinutes('23:59'), 1439);
  assert.strictEqual(parseTimeToMinutes('00:00'), 0);
});

test('parseTimeToMinutes: invalid values', () => {
  assert.strictEqual(parseTimeToMinutes('24:00'), null);
  assert.strictEqual(parseTimeToMinutes('12:60'), null);
  assert.strictEqual(parseTimeToMinutes('abc'), null);
  assert.strictEqual(parseTimeToMinutes('1200'), null);
  assert.strictEqual(parseTimeToMinutes(''), null);
  assert.strictEqual(parseTimeToMinutes(null), null);
  assert.strictEqual(parseTimeToMinutes(930), null);
});

// ---------- normalizeRawTime ----------

test('normalizeRawTime: digit lengths', () => {
  assert.strictEqual(normalizeRawTime('9'), '09:00');
  assert.strictEqual(normalizeRawTime('12'), '12:00');
  assert.strictEqual(normalizeRawTime('930'), '09:30');
  assert.strictEqual(normalizeRawTime('0930'), '09:30');
  assert.strictEqual(normalizeRawTime('2359'), '23:59');
});

test('normalizeRawTime: invalid input', () => {
  assert.strictEqual(normalizeRawTime('12345'), null); // > 4 digits
  assert.strictEqual(normalizeRawTime('9930'), null); // h > 23
  assert.strictEqual(normalizeRawTime('0965'), null); // m > 59
  assert.strictEqual(normalizeRawTime(''), null);
  assert.strictEqual(normalizeRawTime(null), null);
});

// ---------- maskTimeValue ----------

test('maskTimeValue: live typing masks', () => {
  assert.strictEqual(maskTimeValue('9'), '9');
  assert.strictEqual(maskTimeValue('93'), '93');
  assert.strictEqual(maskTimeValue('931'), '93:1'); // legacy mask: 2 digits + rest
  assert.strictEqual(maskTimeValue('9310'), '93:10');
  assert.strictEqual(maskTimeValue('99310'), '99:31'); // truncated to 4 digits
  assert.strictEqual(maskTimeValue('ab12x34'), '12:34'); // non-digits stripped
  assert.strictEqual(maskTimeValue(''), '');
});

// ---------- validateLunchTimes ----------

test('validateLunchTimes: valid typical case', () => {
  const r = validateLunchTimes(settingsAt({}));
  assert.deepStrictEqual(r, { valid: true });
});

test('validateLunchTimes: lunch end before lunch start', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '14:00', lunchEnd: '13:00' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchEndBeforeStart');
});

test('validateLunchTimes: lunch ends before workday starts', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '07:00', lunchEnd: '08:30' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchEndsBeforeWorkdayStart');
});

test('validateLunchTimes: lunch starts after workday ends', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '18:30', lunchEnd: '19:00' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchStartsAfterWorkdayEnd');
});

test('validateLunchTimes: lunch covers whole workday', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '08:00', lunchEnd: '19:00' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchCoversWholeWorkday');
});

test('validateLunchTimes: lunch crosses workday start → adjusted start', () => {
  const r = validateLunchTimes(settingsAt({ workdayStart: '08:00', lunchStart: '07:30', lunchEnd: '08:30' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchCrossesWorkdayStart');
  assert.strictEqual(r.adjustedWorkdayStart, '08:30');
});

test('validateLunchTimes: lunch crosses workday end → adjusted end', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '17:30', lunchEnd: '18:30' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchCrossesWorkdayEnd');
  assert.strictEqual(r.adjustedWorkdayEnd, '17:30');
});

test('validateLunchTimes: lunch starts exactly at workday start', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '09:00', lunchEnd: '10:00' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchStartsAtWorkdayStart');
  assert.strictEqual(r.adjustedWorkdayStart, '10:00');
});

test('validateLunchTimes: lunch ends exactly at workday end', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '17:00', lunchEnd: '18:00' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'lunchEndsAtWorkdayEnd');
  assert.strictEqual(r.adjustedWorkdayEnd, '17:00');
});

test('validateLunchTimes: invalid time strings', () => {
  const r = validateLunchTimes(settingsAt({ lunchStart: '99:99' }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reasonCode, 'invalidTime');
});

// ---------- getNextModeCore ----------

test('getNextModeCore: work → shortBreak within cycle', () => {
  const r = getNextModeCore('work', 1, 4);
  assert.deepStrictEqual(r, { nextMode: 'shortBreak', nextSession: 1 });
});

test('getNextModeCore: work → longBreak at Nth session', () => {
  assert.deepStrictEqual(getNextModeCore('work', 4, 4), { nextMode: 'longBreak', nextSession: 4 });
  assert.deepStrictEqual(getNextModeCore('work', 5, 4), { nextMode: 'longBreak', nextSession: 5 });
});

test('getNextModeCore: shortBreak → work with session increment', () => {
  assert.deepStrictEqual(getNextModeCore('shortBreak', 2, 4), { nextMode: 'work', nextSession: 3 });
});

test('getNextModeCore: longBreak → work with session reset', () => {
  assert.deepStrictEqual(getNextModeCore('longBreak', 4, 4), { nextMode: 'work', nextSession: 1 });
});

// ---------- calculateSyncedTimeCore ----------

test('synced: weekend → null', () => {
  assert.strictEqual(calculateSyncedTimeCore(settingsAt({}), atSunday(10, 0)), null);
});

test('synced: non-default workDays respected (0 = Sunday, JS getDay)', () => {
  const s = settingsAt({ workDays: [0] }); // Sunday only
  assert.strictEqual(calculateSyncedTimeCore(s, at(10, 0)), null); // Monday
  const r = calculateSyncedTimeCore(s, atSunday(10, 0));
  assert.strictEqual(r.type, 'work');
});

test('synced: before workday start', () => {
  const r = calculateSyncedTimeCore(settingsAt({}), at(8, 0));
  assert.deepStrictEqual(r, { type: 'before-work', timeLeft: 3600 });
});

test('synced: after workday end → after-work', () => {
  const r = calculateSyncedTimeCore(settingsAt({}), at(18, 0, 1));
  assert.deepStrictEqual(r, { type: 'after-work' });
});

test('synced: after workday end with continueAfterWorkday → null (manual timer)', () => {
  const s = settingsAt({ continueAfterWorkday: true });
  assert.strictEqual(calculateSyncedTimeCore(s, at(18, 0, 1)), null);
});

test('synced: first work session in progress', () => {
  // 09:10 → 10 min elapsed → 15 min left of 25
  const r = calculateSyncedTimeCore(settingsAt({}), at(9, 10));
  assert.deepStrictEqual(r, {
    type: 'work', timeLeft: 15 * 60, totalTime: 25 * 60, mode: 'work', session: 1
  });
});

test('synced: boundary — exactly workday start', () => {
  const r = calculateSyncedTimeCore(settingsAt({}), at(9, 0));
  assert.deepStrictEqual(r, {
    type: 'work', timeLeft: 25 * 60, totalTime: 25 * 60, mode: 'work', session: 1
  });
});

test('synced: lunch in progress', () => {
  const r = calculateSyncedTimeCore(settingsAt({}), at(13, 30));
  assert.deepStrictEqual(r, { type: 'lunch', timeLeft: 30 * 60, totalTime: 60 * 60 });
});

test('synced: lunch boundaries — exactly lunchStart → lunch; exactly lunchEnd → work restart', () => {
  assert.deepStrictEqual(
    calculateSyncedTimeCore(settingsAt({}), at(13, 0)).type,
    'lunch'
  );
  // after lunch the chain restarts: session 1, full work duration
  assert.deepStrictEqual(calculateSyncedTimeCore(settingsAt({}), at(14, 0)), {
    type: 'work', timeLeft: 25 * 60, totalTime: 25 * 60, mode: 'work', session: 1
  });
});

test('synced: lunch disabled — plain chain from workday start', () => {
  const s = settingsAt({ lunchEnabled: false });
  // 13:10 → 250 min elapsed. Full chain: w1 0–25, s 25–30, w2 30–55, s 55–60,
  // w3 60–85, s 85–90, w4 90–115, long 115–130 (reset), then repeat:
  // 245–260 is the 2nd iteration's long break → 10 min left, session 4
  const r = calculateSyncedTimeCore(s, at(13, 10));
  assert.deepStrictEqual(r, {
    type: 'break', timeLeft: 10 * 60, totalTime: 15 * 60, mode: 'longBreak', session: 4
  });
});

test('synced: long break on 4th session', () => {
  const s = settingsAt({ lunchEnabled: false });
  // elapsed for 4 work sessions + 3 short breaks = 25*4 + 5*3 = 115 min → in long break 115..130
  // pick middle of long break: 122 min after start → 11:02 with 09:00 start
  const r = calculateSyncedTimeCore(s, at(11, 2));
  assert.strictEqual(r.mode, 'longBreak');
  assert.strictEqual(r.session, 4);
});

test('synced: cycle reset after long break → session 1', () => {
  const s = settingsAt({ lunchEnabled: false });
  // after long break: 130 min → 11:10 starts session 1 again
  const r = calculateSyncedTimeCore(s, at(11, 10));
  assert.deepStrictEqual(r, {
    type: 'work', timeLeft: 25 * 60, totalTime: 25 * 60, mode: 'work', session: 1
  });
});

test('synced: boundary — elapsed exactly equals work end → next interval', () => {
  const s = settingsAt({ lunchEnabled: false });
  // exactly 25 min after start → first short break
  const r = calculateSyncedTimeCore(s, at(9, 25));
  assert.strictEqual(r.type, 'break');
  assert.strictEqual(r.mode, 'shortBreak');
});

test('synced: afternoon — after lunch chain position', () => {
  // 14:30 → exactly 30 min after lunch end: work 25 + short break 5 → second work session starts
  const r = calculateSyncedTimeCore(settingsAt({}), at(14, 30));
  assert.deepStrictEqual(r, {
    type: 'work', timeLeft: 25 * 60, totalTime: 25 * 60, mode: 'work', session: 2
  });
});

test('synced: late afternoon — 4th work session near workday end', () => {
  // 17:59 → 239 min after lunch end: 3rd long break cycle ended at 220 → 4th work session (220..245)
  const r = calculateSyncedTimeCore(settingsAt({}), at(17, 59));
  assert.deepStrictEqual(r, {
    type: 'work', timeLeft: 6 * 60, totalTime: 25 * 60, mode: 'work', session: 4
  });
});