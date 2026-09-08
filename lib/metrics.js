/*
 * wspomo metrics — anonymous visit/focus counters, JSON-file storage
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License, or
 * (at your option) any later version.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

function createMetrics({ dataDir, now = () => Date.now(), flushIntervalMs = 30000 }) {
  const file = path.join(dataDir, 'metrics.json');

  let data = load();
  let dirty = false;
  let flushTimer = null;

  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        days: parsed.days || {},
        visitors: parsed.visitors || {}
      };
    } catch (e) {
      // missing or corrupted file → keep corrupted one as .bak, start fresh
      try {
        if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
      } catch (_) { /* best effort */ }
      return { version: 1, days: {}, visitors: {} };
    }
  }

  function todayKey() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function ensureDay(key) {
    if (!data.days[key]) {
      data.days[key] = { visitors: 0, focusMinutes: 0, pomodoros: 0, visitorIds: [] };
    }
    return data.days[key];
  }

  function touchVisitor(uuid, key) {
    let v = data.visitors[uuid];
    if (!v) {
      v = { first: key, last: key, visits: 1 };
      data.visitors[uuid] = v;
      const day = ensureDay(key);
      day.visitors += 1;
      day.visitorIds.push(uuid);
      dirty = true;
      return { isNewVisitor: true, isNewToday: true };
    }
    const isNewDayVisit = v.last !== key;
    if (isNewDayVisit) {
      v.last = key;
      v.visits += 1;
      const day = ensureDay(key);
      if (!day.visitorIds.includes(uuid)) {
        day.visitors += 1;
        day.visitorIds.push(uuid);
      }
      dirty = true;
    }
    return { isNewVisitor: false, isNewDayVisit };
  }

  function addFocusMinutes(_uuid, n) {
    const day = ensureDay(todayKey());
    day.focusMinutes += n;
    dirty = true;
  }

  function addPomodoro() {
    const day = ensureDay(todayKey());
    day.pomodoros += 1;
    dirty = true;
  }

  function publicStats() {
    const key = todayKey();
    const day = data.days[key] || { visitors: 0, focusMinutes: 0, pomodoros: 0 };
    const now = Math.floor(Date.now() / 1000);
    let liveNow = 0;
    for (const v of Object.values(data.visitors)) {
      if (v.lastSeenSec && now - v.lastSeenSec < 5 * 60) liveNow += 1;
    }
    return {
      today: {
        date: key,
        visitors: day.visitors,
        focusMinutes: day.focusMinutes,
        pomodoros: day.pomodoros
      },
      totalVisitors: Object.keys(data.visitors).length,
      liveNow
    };
  }

  function heartbeat(uuid) {
    const v = data.visitors[uuid];
    if (v) {
      v.lastSeenSec = Math.floor(Date.now() / 1000);
      dirty = true;
    }
  }

  function flush() {
    if (!dirty) return;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
      dirty = false;
    } catch (e) {
      // never crash the timer over metrics
      console.error('metrics flush failed:', e.message);
    }
  }

  function startFlushTimer() {
    if (flushTimer) return;
    flushTimer = setInterval(flush, flushIntervalMs);
    if (flushTimer.unref) flushTimer.unref();
  }

  function stop() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    flush();
  }

  return {
    touchVisitor,
    addFocusMinutes,
    addPomodoro,
    heartbeat,
    publicStats,
    flush,
    startFlushTimer,
    stop,
    _debug: {
      get data() { return data; },
      get file() { return file; }
    }
  };
}

module.exports = { createMetrics };