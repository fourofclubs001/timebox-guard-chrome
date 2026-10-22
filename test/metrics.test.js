import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayBars, formatDuration, relativeTime, summarize } from '../src/metrics.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const now = new Date(2026, 9, 22, 15, 0).getTime(); // Oct 22 2026, 15:00 local

const events = [
  { t: 'start', site: 'youtube.com', ts: now - 2 * DAY, reason: 'old tutorial', plannedMin: 30 },
  { t: 'usage', site: 'youtube.com', ts: now - 2 * DAY + 40 * MIN, durMs: 40 * MIN },
  { t: 'start', site: 'youtube.com', ts: now - 60 * MIN, reason: 'music', plannedMin: 15 },
  { t: 'usage', site: 'youtube.com', ts: now - 40 * MIN, durMs: 20 * MIN },
  { t: 'close', site: 'reddit.com', ts: now - 30 * MIN },
  { t: 'close', site: 'reddit.com', ts: now - 20 * MIN },
  { t: 'start', site: '', ts: now - 10 * MIN, reason: '  ', plannedMin: 5 },
];

test('summarize today', () => {
  const s = summarize(events, 'today', now);
  assert.equal(s.starts.length, 2);
  assert.equal(s.closes.length, 2);
  assert.equal(s.focusedMs, 20 * MIN);
  assert.equal(s.plannedMs, 20 * MIN);
  assert.equal(s.restraint, 50);
  assert.deepEqual(s.reasons.map((e) => e.reason), ['music']); // blank reason skipped
  assert.deepEqual(s.perSite.map((p) => p.site), ['youtube.com', 'reddit.com', '']);
});

test('summarize week includes older events', () => {
  const s = summarize(events, 'week', now);
  assert.equal(s.focusedMs, 60 * MIN);
  assert.equal(s.starts.length, 3);
  assert.equal(s.restraint, 40); // 2 closes of 5 decisions
  assert.deepEqual(s.reasons.map((e) => e.reason), ['music', 'old tutorial']);
});

test('summarize with no events in range', () => {
  const s = summarize([], 'all', now);
  assert.equal(s.decisions, 0);
  assert.equal(s.restraint, 0);
  assert.deepEqual(s.perSite, []);
});

test('dayBars buckets usage by calendar day, oldest first', () => {
  const bars = dayBars(events, 7, now);
  assert.equal(bars.length, 7);
  assert.ok(bars[6].isToday);
  assert.equal(bars[6].ms, 20 * MIN);
  assert.equal(bars[4].ms, 40 * MIN);
  assert.equal(bars.reduce((t, b) => t + b.ms, 0), 60 * MIN);
  for (const bar of bars) assert.equal(new Date(bar.dayStart).getHours(), 0);
});

test('formatDuration', () => {
  assert.equal(formatDuration(42_000), '42s');
  assert.equal(formatDuration(5 * MIN), '5m');
  assert.equal(formatDuration(125 * MIN), '2h 5m');
});

test('relativeTime', () => {
  assert.equal(relativeTime(now - 10_000, now), 'just now');
  assert.equal(relativeTime(now - 5 * MIN, now), '5m ago');
  assert.equal(relativeTime(now - 3 * 60 * MIN, now), '3h ago');
  assert.equal(relativeTime(now - 2 * DAY, now), '2d ago');
});
