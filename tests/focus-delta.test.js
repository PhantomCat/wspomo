/*
 * wspomo client focus-delta accumulation test (extracted logic)
 * Copyright (C) 2026 Serge Mymrikov (PhantomCat)
 * License GPL-3.0-or-later — see project LICENSE
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Reimplementation of the client accumulation contract (public/index.html):
//   delta = min(now - last, 5000); focusMs += delta;
//   on focusMs >= 60000 → send floor(focusMs/60000) minutes, keep remainder
// Tested here because the real block lives inline in index.html's script.
// If this test and the inline block drift apart, this test fails by inspection.

function makeAccumulator() {
  let focusMs = 0;
  let lastFocusMs = null;
  const sent = [];
  function tickFocus(nowMs, running, mode) {
    if (running && mode === 'work') {
      if (lastFocusMs !== null) {
        const deltaMs = Math.min(nowMs - lastFocusMs, 5000);
        focusMs += deltaMs;
        if (focusMs >= 60000) {
          const minutes = Math.floor(focusMs / 60000);
          focusMs -= minutes * 60000;
          sent.push(minutes);
        }
      }
      lastFocusMs = nowMs;
    } else {
      lastFocusMs = null;
    }
  }
  return { tickFocus, get sent() { return sent; }, get focusMs() { return focusMs; } };
}

test('first tick only sets anchor — no minute sent', () => {
  const acc = makeAccumulator();
  acc.tickFocus(1000, true, 'work');
  assert.strictEqual(acc.sent.length, 0);
});

test('130 ticks × 1s → exactly 2 minutes sent (no off-by-one, no drift)', () => {
  const acc = makeAccumulator();
  for (let i = 1; i <= 130; i++) {
    acc.tickFocus(1000 + i * 1000, true, 'work');
  }
  // 129 deltas × 1s (first tick only anchors) → minutes at 60s and 120s
  assert.deepStrictEqual(acc.sent, [1, 1]);
  assert.strictEqual(acc.focusMs, 9 * 1000); // 129 - 120 = 9s remainder
});

test('pause stops accumulation; resume does not credit pause time', () => {
  const acc = makeAccumulator();
  for (let i = 1; i <= 30; i++) acc.tickFocus(1000 + i * 1000, true, 'work'); // 30s
  acc.tickFocus(31000, false, 'work'); // paused 200s wall-clock → anchor cleared
  acc.tickFocus(231000, true, 'work'); // resume: first tick re-anchors, no delta credited
  for (let i = 1; i <= 35; i++) acc.tickFocus(232000 + i * 1000, true, 'work'); // 35s more
  // 30s (before) + 35s (after) = 65s → exactly one minute sent, 5s remainder
  assert.deepStrictEqual(acc.sent, [1]);
  assert.strictEqual(acc.focusMs, 5 * 1000);
});

test('tab throttling cap: giant gap counts as max 5s', () => {
  const acc = makeAccumulator();
  acc.tickFocus(1000, true, 'work');
  // browser throttled: next tick 47s later → only 5s counted
  acc.tickFocus(48000, true, 'work');
  acc.tickFocus(49000, true, 'work');
  assert.strictEqual(acc.sent.length, 0); // 5+1 = 6s total, no minute yet
});

test('multi-minute send in one delta (long focus, capped deltas sum up)', () => {
  const acc = makeAccumulator();
  acc.tickFocus(0, true, 'work');
  for (let i = 1; i <= 125; i++) acc.tickFocus(i * 1000, true, 'work'); // 125s → 2 minutes
  assert.deepStrictEqual(acc.sent, [1, 1]);
});

test('focus in sync mode (mode work, running) accumulates; lunch/break do not', () => {
  const acc = makeAccumulator();
  for (let i = 1; i <= 61; i++) acc.tickFocus(1000 + i * 1000, true, 'work'); // 61s → 1 minute
  assert.deepStrictEqual(acc.sent, [1]);
  acc.tickFocus(63000, true, 'break'); // break → resets anchor
  for (let i = 0; i < 60; i++) acc.tickFocus(64000 + i * 1000, true, 'break');
  assert.deepStrictEqual(acc.sent, [1]); // no more minutes in break
  for (let i = 0; i < 61; i++) acc.tickFocus(125000 + i * 1000, true, 'work');
  assert.deepStrictEqual(acc.sent, [1, 1]); // back to work → next minute
});