/*
 * wspomo client contract guard — keeps pomodoro hook single-funneled
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('pomodoro hook: trackPomodoroCompleted is called only inside registerModeTransition', () => {
  const calls = [...html.matchAll(/trackPomodoroCompleted\(\)/g)];
  // 1 definition line (function trackPomodoroCompleted) + exactly 1 call inside the funnel
  assert.strictEqual(calls.length, 2, `expected definition + single call inside funnel, found ${calls.length}`);
  const funnelBody = html.slice(
    html.indexOf('function registerModeTransition'),
    html.indexOf('function switchMode')
  );
  assert.ok(funnelBody.includes('trackPomodoroCompleted()'), 'call must live inside the funnel');
});

test('pomodoro hook: every mode-transition site uses the funnel', () => {
  const callSites = [...html.matchAll(/registerModeTransition\((?!newMode)/g)];
  assert.ok(callSites.length >= 5, `expected >= 5 transition call sites, found ${callSites.length}`);
  // the legacy scattered hook must not be back
  assert.ok(!html.includes("if (state.mode === 'work') trackPomodoroCompleted()"), 'scattered hook returned');
});

test('pomodoro hook: focus delta runs before early returns in tick()', () => {
  const tickBody = html.slice(html.indexOf('function tick()'), html.indexOf('function calculateSyncedTime()'));
  assert.ok(tickBody.includes('trackFocusDelta();'), 'trackFocusDelta must be first in tick()');
});