/*
 * wspomo timer-core — pure timer logic, no DOM
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

/**
 * 'HH:MM' → minutes since midnight, or null if invalid.
 */
function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Raw digits (e.g. '930', '0930') → normalized 'HH:MM', or null if invalid.
 */
function normalizeRawTime(raw) {
  if (typeof raw !== 'string') return null;
  let h;
  let m;
  if (raw.length === 1 || raw.length === 2) {
    h = parseInt(raw, 10);
    m = 0;
  } else if (raw.length === 3) {
    h = parseInt(raw.slice(0, 1), 10);
    m = parseInt(raw.slice(1, 3), 10);
  } else if (raw.length === 4) {
    h = parseInt(raw.slice(0, 2), 10);
    m = parseInt(raw.slice(2, 4), 10);
  } else {
    return null;
  }
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Raw digit input → masked 'HH:MM'-style display value (never null — for live typing).
 */
function maskTimeValue(raw) {
  const digits = String(raw).replace(/[^\d]/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

/**
 * Validate lunch vs workday boundaries.
 * Pure: reads settings fields as strings, returns reason codes (no human text).
 *
 * reason codes:
 *  - 'lunchEndBeforeStart'
 *  - 'lunchEndsBeforeWorkdayStart'
 *  - 'lunchStartsAfterWorkdayEnd'
 *  - 'lunchCoversWholeWorkday'
 *  - 'lunchCrossesWorkdayStart'
 *  - 'lunchCrossesWorkdayEnd'
 *  - 'lunchStartsAtWorkdayStart'
 *  - 'lunchEndsAtWorkdayEnd'
 */
function validateLunchTimes(settingsObj) {
  const ws = parseTimeToMinutes(settingsObj.workdayStart);
  const we = parseTimeToMinutes(settingsObj.workdayEnd);
  const ls = parseTimeToMinutes(settingsObj.lunchStart);
  const le = parseTimeToMinutes(settingsObj.lunchEnd);

  if (ws === null || we === null || ls === null || le === null) {
    return { valid: false, reasonCode: 'invalidTime' };
  }

  if (le <= ls) {
    return { valid: false, reasonCode: 'lunchEndBeforeStart' };
  }

  if (le <= ws) {
    return { valid: false, reasonCode: 'lunchEndsBeforeWorkdayStart' };
  }

  if (ls >= we) {
    return { valid: false, reasonCode: 'lunchStartsAfterWorkdayEnd' };
  }

  if (ls <= ws && le >= we) {
    return { valid: false, reasonCode: 'lunchCoversWholeWorkday' };
  }

  if (ls < ws && le > ws && le < we) {
    return {
      valid: false,
      reasonCode: 'lunchCrossesWorkdayStart',
      adjustedWorkdayStart: settingsObj.lunchEnd
    };
  }

  if (ls >= ws && ls < we && le > we) {
    return {
      valid: false,
      reasonCode: 'lunchCrossesWorkdayEnd',
      adjustedWorkdayEnd: settingsObj.lunchStart
    };
  }

  if (ls === ws && le < we) {
    return {
      valid: false,
      reasonCode: 'lunchStartsAtWorkdayStart',
      adjustedWorkdayStart: settingsObj.lunchEnd
    }
  }

  if (le === we && ls > ws) {
    return {
      valid: false,
      reasonCode: 'lunchEndsAtWorkdayEnd',
      adjustedWorkdayEnd: settingsObj.lunchStart
    };
  }

  return { valid: true };
}

/**
 * Pure next-mode transition (no state mutation).
 * Returns { nextMode, nextSession } — nextSession is the value to store AFTER
 * entering nextMode.
 *
 * Semantics (matches legacy UI behaviour):
 *  - work  → shortBreak (same session) or longBreak when session >= N
 *  - shortBreak → work (session + 1)
 *  - longBreak  → work (session reset to 1)
 */
function getNextModeCore(mode, session, sessionsBeforeLongBreak) {
  if (mode === 'work') {
    const next = session >= sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak';
    return { nextMode: next, nextSession: session };
  }
  if (mode === 'shortBreak') {
    return { nextMode: 'work', nextSession: session + 1 };
  }
  // longBreak or anything else → work, reset
  return { nextMode: 'work', nextSession: 1 };
}

/**
 * Workday-synced interval calculation.
 * Pure: settings in, `now` (Date) in, result out. No globals, no Date.now().
 *
 * Returns:
 *  - null                       → out of sync scope (weekend, or continueAfterWorkday past end)
 *  - { type: 'before-work', timeLeft }
 *  - { type: 'after-work' }
 *  - { type: 'lunch', timeLeft, totalTime }
 *  - { type: 'work'|'break', timeLeft, totalTime, mode, session }
 *
 * Documented behaviour (kept 1:1 with legacy UI):
 *  - Lunch is not counted towards the pomodoro chain: after lunch the chain
 *    restarts from session 1 (elapsed = now - lunchEnd).
 */
function calculateSyncedTimeCore(settings, now) {
  const workDays = settings.workDays || [1, 2, 3, 4, 5];
  if (!workDays.includes(now.getDay())) {
    return null;
  }

  const ws = parseTimeToMinutes(settings.workdayStart);
  const we = parseTimeToMinutes(settings.workdayEnd);
  if (ws === null || we === null) return null;

  const workdayStartSec = ws * 60;
  const workdayEndSec = we * 60;
  const currentSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  if (currentSec < workdayStartSec) {
    return { type: 'before-work', timeLeft: Math.ceil(workdayStartSec - currentSec) };
  }

  if (currentSec >= workdayEndSec) {
    return settings.continueAfterWorkday ? null : { type: 'after-work' };
  }

  let elapsed;

  if (settings.lunchEnabled) {
    const ls = parseTimeToMinutes(settings.lunchStart);
    const le = parseTimeToMinutes(settings.lunchEnd);
    if (ls === null || le === null) return null;

    const lunchStartSec = ls * 60;
    const lunchEndSec = le * 60;

    if (currentSec < lunchStartSec) {
      elapsed = currentSec - workdayStartSec;
    } else if (currentSec < lunchEndSec) {
      return {
        type: 'lunch',
        timeLeft: Math.ceil(lunchEndSec - currentSec),
        totalTime: lunchEndSec - lunchStartSec
      };
    } else {
      elapsed = currentSec - lunchEndSec;
    }
  } else {
    elapsed = currentSec - workdayStartSec;
  }

  const workSec = settings.workDuration * 60;
  const shortBreakSec = settings.shortBreakDuration * 60;
  const longBreakSec = settings.longBreakDuration * 60;

  let accumulated = 0;
  let session = 1;

  while (true) {
    const workEnd = accumulated + workSec;
    if (elapsed < workEnd) {
      return {
        type: 'work',
        timeLeft: Math.ceil(workEnd - elapsed),
        totalTime: workSec,
        mode: 'work',
        session
      };
    }
    accumulated = workEnd;

    const isLongBreak = session >= settings.sessionsBeforeLongBreak;
    const breakSec = isLongBreak ? longBreakSec : shortBreakSec;
    const breakEnd = accumulated + breakSec;

    if (elapsed < breakEnd) {
      return {
        type: 'break',
        timeLeft: Math.ceil(breakEnd - elapsed),
        totalTime: breakSec,
        mode: isLongBreak ? 'longBreak' : 'shortBreak',
        session
      };
    }
    accumulated = breakEnd;

    if (isLongBreak) session = 1;
    else session++;
  }
}

const timerCore = {
  parseTimeToMinutes,
  normalizeRawTime,
  maskTimeValue,
  validateLunchTimes,
  getNextModeCore,
  calculateSyncedTimeCore
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = timerCore;
}
if (typeof window !== 'undefined') {
  window.TimerCore = timerCore;
}