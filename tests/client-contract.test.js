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
test('active-report: relay fires at every timer state change', () => {
  // every start/transition/stop path must relay immediately — otherwise waybar
  // shows the previous mode for up to 60s (regression fixed 12.09)
  const calls = [...html.matchAll(/sendActiveReport\(\)/g)];
  // definition + all call sites across startTimer, startTimerLocal, tick,
  // transitions, stop paths and the W-mode Stop button (28.09)
  assert.strictEqual(calls.length, 24,
    `expected definition + 23 call sites, found ${calls.length}`);
  // key sites: start (3 branches + final), transitions in tick (both halves), stop paths
  const tickBody = html.slice(html.indexOf('function tick()'), html.indexOf('function calculateSyncedTime()'));
  const tickCalls = [...tickBody.matchAll(/sendActiveReport\(\)/g)].length;
  assert.ok(tickCalls >= 6, `tick() must relay on every transition, found ${tickCalls}`);
  const startBody = html.slice(html.indexOf('function startTimer'), html.indexOf('function resetTimer'));
  const startCalls = [...startBody.matchAll(/sendActiveReport\(\)/g)].length;
  assert.ok(startCalls >= 5, `startTimer must relay on every branch, found ${startCalls}`);
  const resetBody = html.slice(html.indexOf('function resetTimer'), html.indexOf('function skipSession'));
  assert.ok(resetBody.includes('sendActiveReport()'), 'resetTimer must relay');
  const skipBody = html.slice(html.indexOf('function skipSession'), html.indexOf('async function loadSettings'));
  assert.ok(skipBody.includes('sendActiveReport()'), 'skipSession must relay');
});

// ---------- connected mode (task 22.09) ----------

test('connected: W decides the engine — synced→server, freeform→browser', () => {
  const startBody = html.slice(html.indexOf('function startTimer'), html.indexOf('function resetTimer'));
  assert.ok(startBody.includes('if (settings.workdaySync) return startConnected();'),
    'W on + connected → server synced chain');
  assert.ok(startBody.includes('return startFreeformConnected();'),
    'W off + connected → free-form stays in the browser');
  const ffBody = html.slice(html.indexOf('function startFreeformConnected'), html.indexOf('function startTimerLocal'));
  assert.ok(ffBody.includes('stopConnectedPoll()'), 'free-form must stop the 5s poll');
  assert.ok(ffBody.includes("'stop'"), 'free-form must stop any leftover server chain');
  const relayBody = html.slice(html.indexOf('function sendActiveReport'), html.indexOf('function trackPomodoroCompleted'));
  assert.ok(relayBody.includes('if (isConnected() && settings.workdaySync) return;'),
    'relay silenced only for connected synced mode; free-form relays (KT-1)');
});

test('connected: toggleSync switches engines, both never run', () => {
  const body = html.slice(html.indexOf('function toggleSync'), html.indexOf("$('syncToggle').addEventListener"));
  assert.ok(body.includes('resetConnected()'), 'W off must stop the server chain');
  assert.ok(body.includes('stopConnectedPoll()'), 'W on must stop the local poll/free-form');
});

test('connected: Start/Reset route to server chain, skip is guarded', () => {
  const startBody = html.slice(html.indexOf('function startTimer'), html.indexOf('function resetTimer'));
  assert.ok(startBody.includes('if (isConnected()) {'), 'startTimer must branch on connection');
  const resetBody = html.slice(html.indexOf('function resetTimer'), html.indexOf('function skipSession'));
  assert.ok(resetBody.includes('if (isConnected() && settings.workdaySync) return resetConnected();'),
    'resetTimer must delegate in connected synced mode');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.ok(css.includes('body.connected #skipBtn'), 'CSS guard for skip in connected mode');
});

test('connected: creds live in localStorage, never in the settings payload', () => {
  assert.ok(html.includes('localStorage.setItem'), 'creds must persist in localStorage');
  const saveBody = html.slice(html.indexOf('async function saveSettings'), html.indexOf('function saveConnectedInputs'));
  assert.ok(!saveBody.includes('connectedToken'), 'token must not travel inside POST /api/settings body');
  assert.ok(!saveBody.includes('connectedUrl'), 'url must not travel inside POST /api/settings body');
});

test('connected: all settings fetches go through settingsEndpoint()', () => {
  assert.ok(html.includes('function settingsEndpoint()'), 'endpoint helper must exist');
  assert.strictEqual([...html.matchAll(/fetch\('\/api\/settings'/g)].length, 0,
    'every settings fetch must route via settingsEndpoint() (per-user on SaaS, cookies locally)');
});

test('connected: relay is silenced while connected', () => {
  const relayBody = html.slice(html.indexOf('function sendActiveReport'), html.indexOf('function trackPomodoroCompleted'));
  assert.ok(relayBody.includes('if (isConnected() && settings.workdaySync) return;'),
    'relay silenced only for connected synced mode; free-form relays (KT-1)');
});

test('connected: poll + interpolation loop exist', () => {
  assert.ok(html.includes('setInterval(pollServerState, 5000)'), '5s state poll');
  assert.ok(html.includes('setInterval(connectedMirror, 1000)'), '1s interpolation mirror');
});

test('connected: W-mode controls — single Stop replaces Start/Reset/Skip', () => {
  const btn = html.slice(html.indexOf('id="stopBtn"'), html.indexOf('</button>', html.indexOf('id="stopBtn"')));
  assert.ok(btn.includes('stopModeHint'), 'Stop must carry the sub-caption');
  const upd = html.slice(html.indexOf('function updateControls'), html.indexOf('function formatTime'));
  assert.ok(upd.includes("'stopBtn'") && upd.includes("'startBtn'"), 'updateControls swaps the control set');
  assert.ok(html.includes("$('stopBtn').addEventListener"), 'Stop has a handler');
  const stopBody = html.slice(html.indexOf("$('stopBtn').addEventListener"), html.indexOf("$('settingsToggle').addEventListener"));
  assert.ok(stopBody.includes('workdaySync = false'), 'Stop ends the workday mode');
  assert.ok(stopBody.includes('resetConnected()'), 'Stop ends the server chain when active');
});

test('connected: settings revision sync (server row is the source of truth)', () => {
  assert.ok(html.includes('checkSettingsRev(data.settingsRev)'), 'each tick checks the revision');
  assert.ok(html.includes('function refetchSettings'), 'refetch on mismatch');
  assert.ok(html.includes('connected.settingsRev = data.settingsRev'), 'POST/load adopt the fresh revision');
  const refetch = html.slice(html.indexOf('async function refetchSettings'), html.indexOf('function initTracking'));
  assert.ok(refetch.includes('applySettings()'), 'refetched settings are applied');
});
