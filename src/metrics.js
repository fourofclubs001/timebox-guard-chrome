/**
 * Pure aggregation over the usage log for the dashboard — no DOM, no
 * chrome.* — so it can be unit-tested with plain Node.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RANGES = {
  today: { label: 'today' },
  week: { label: 'last 7 days', windowMs: 7 * DAY },
  month: { label: 'last 30 days', windowMs: 30 * DAY },
  all: { label: 'all time' },
};

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function windowStart(range, now = Date.now()) {
  if (range === 'today') return startOfDay(now);
  if (range === 'all') return 0;
  return now - RANGES[range].windowMs;
}

/** Everything the dashboard shows for [range], computed from [allEvents]. */
export function summarize(allEvents, range, now = Date.now()) {
  const from = windowStart(range, now);
  const events = allEvents.filter((e) => e.ts >= from);
  const starts = events.filter((e) => e.t === 'start');
  const closes = events.filter((e) => e.t === 'close');
  const usages = events.filter((e) => e.t === 'usage');

  const focusedMs = sum(usages, (e) => e.durMs);
  const plannedMs = sum(starts, (e) => e.plannedMin * MINUTE);
  const decisions = starts.length + closes.length;
  const restraint = decisions > 0 ? Math.floor((closes.length * 100) / decisions) : 0;

  const perSite = [...new Set(events.map((e) => e.site))]
    .map((site) => ({
      site,
      focusedMs: sum(usages.filter((e) => e.site === site), (e) => e.durMs),
      started: starts.filter((e) => e.site === site).length,
      closed: closes.filter((e) => e.site === site).length,
    }))
    .sort((a, b) => b.focusedMs - a.focusedMs || b.started + b.closed - (a.started + a.closed));

  const reasons = starts
    .filter((e) => e.reason && e.reason.trim())
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);

  return { events, starts, closes, usages, focusedMs, plannedMs, decisions, restraint, perSite, reasons };
}

/**
 * Focused time for each of the last [days] calendar days, oldest first.
 * Walks real calendar days so DST changes don't shift the buckets.
 */
export function dayBars(allEvents, days, now = Date.now()) {
  const bars = [];
  for (let back = days - 1; back >= 0; back--) {
    const start = new Date(startOfDay(now));
    start.setDate(start.getDate() - back);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const ms = sum(
      allEvents.filter((e) => e.t === 'usage' && e.ts >= start.getTime() && e.ts < end.getTime()),
      (e) => e.durMs,
    );
    bars.push({ dayStart: start.getTime(), isToday: back === 0, ms });
  }
  return bars;
}

export function formatDuration(ms) {
  if (ms < MINUTE) return `${Math.floor(ms / 1000)}s`;
  const totalMin = Math.floor(ms / MINUTE);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function relativeTime(ts, now = Date.now()) {
  const diff = now - ts;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function sum(list, pick) {
  return list.reduce((total, item) => total + (pick(item) || 0), 0);
}
