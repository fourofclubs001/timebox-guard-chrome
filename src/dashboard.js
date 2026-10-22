import { RANGES, dayBars, formatDuration, relativeTime, summarize } from './metrics.js';
import * as store from './store.js';

/**
 * Read-only dashboard over the usage log: pick a window (today / 7 / 30
 * days / all) and it shows a summary, the restraint rate, a per-day chart,
 * a per-site breakdown, and the most recent reasons typed.
 */

const content = document.getElementById('content');
const rangeButtons = document.querySelectorAll('[data-range]');

let range = 'week';

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function siteLabel(site) {
  return site || 'Unlock prompt';
}

async function render() {
  for (const button of rangeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.range === range));
  }

  const allEvents = await store.getEvents();
  if (allEvents.length === 0) {
    content.replaceChildren(
      el(
        'div',
        { className: 'card muted' },
        el('p', { style: 'margin-top:0' }, 'No activity recorded yet. Open a guarded site and your metrics will show up here.'),
        el('p', { style: 'margin-bottom:0' }, 'Use ', el('a', { href: 'settings.html' }, 'Settings'), ' to choose which sites to guard.'),
      ),
    );
    return;
  }

  const label = RANGES[range].label;
  const s = summarize(allEvents, range);
  const parts = [];

  if (s.events.length === 0) {
    parts.push(el('p', { className: 'muted' }, `Nothing recorded ${label}.`));
  }

  // ---- Summary ----------------------------------------------------------
  const tile = (value, text) => el('div', { className: 'card tile' }, el('div', { className: 'value' }, value), el('div', { className: 'label' }, text));
  parts.push(el('h2', {}, `Summary — ${label}`));
  const tiles = [
    tile(formatDuration(s.focusedMs), 'Focused time on guarded sites'),
    tile(String(s.starts.length), 'Sessions started'),
    tile(String(s.closes.length), 'Closed with “Close tab instead”'),
  ];
  if (s.starts.length > 0) {
    tiles.push(
      tile(formatDuration(s.focusedMs / s.starts.length), 'Avg session (actual)'),
      tile(`${formatDuration(s.plannedMs)} → ${formatDuration(s.focusedMs)}`, 'Planned vs. actual'),
    );
  }
  parts.push(el('div', { className: 'tiles' }, ...tiles));

  // ---- Restraint ---------------------------------------------------------
  if (s.decisions > 0) {
    parts.push(
      el('h2', {}, `Restraint rate — ${s.restraint}%`),
      el(
        'div',
        { className: 'card' },
        el('div', {}, `You backed out of ${s.closes.length} of ${s.decisions} prompts.`),
        el(
          'div',
          { className: 'split', role: 'img', ariaLabel: `${s.closes.length} backed out, ${s.starts.length} went ahead` },
          el('div', { style: `flex:${s.closes.length};background:var(--accent)` }),
          el('div', { style: `flex:${s.starts.length};background:var(--other)` }),
        ),
        el(
          'div',
          { className: 'legend' },
          el('span', { style: '--dot:var(--accent)' }, `Backed out (${s.closes.length})`),
          el('span', { style: '--dot:var(--other)' }, `Went ahead (${s.starts.length})`),
        ),
      ),
    );
  }

  // ---- Per-day chart -----------------------------------------------------
  const days = range === 'month' || range === 'all' ? 14 : 7;
  const bars = dayBars(allEvents, days);
  const maxMs = Math.max(...bars.map((b) => b.ms), 1);
  const dayFormat = new Intl.DateTimeFormat(undefined, days > 7 ? { day: 'numeric' } : { weekday: 'short' });
  parts.push(
    el('h2', {}, `Focused time — last ${days} days`),
    el(
      'div',
      { className: 'card chart' },
      ...bars.map((bar) =>
        el(
          'div',
          { className: 'col', title: `${new Date(bar.dayStart).toLocaleDateString()}: ${formatDuration(bar.ms)}` },
          el('span', { className: 'amount' }, bar.ms >= 60_000 ? formatDuration(bar.ms) : ''),
          el(
            'div',
            { className: 'bar-area' },
            el('div', { className: bar.ms > 0 ? 'bar' : 'bar zero', style: `height:${(bar.ms / maxMs) * 100}%` }),
          ),
          el('span', { className: bar.isToday ? 'day today' : 'day' }, bar.isToday ? 'Today' : dayFormat.format(bar.dayStart)),
        ),
      ),
    ),
  );

  // ---- Per-site breakdown ------------------------------------------------
  if (s.perSite.length > 0) {
    const maxSiteMs = Math.max(...s.perSite.map((p) => p.focusedMs), 1);
    parts.push(
      el('h2', {}, 'By site'),
      el(
        'div',
        { className: 'card' },
        ...s.perSite.map((p) => {
          let stats = `${formatDuration(p.focusedMs)}  ·  ${p.started} started`;
          if (p.closed > 0) stats += `, ${p.closed} closed`;
          const fraction = Math.max(0.02, p.focusedMs / maxSiteMs);
          return el(
            'div',
            { className: 'site-row' },
            el('div', { className: 'top' }, el('span', { className: 'name' }, siteLabel(p.site)), el('span', { className: 'stats' }, stats)),
            el('div', { className: 'track' }, el('div', { style: `width:${fraction * 100}%` })),
          );
        }),
      ),
    );
  }

  // ---- Reasons -----------------------------------------------------------
  if (s.reasons.length > 0) {
    parts.push(
      el('h2', {}, 'Recent reasons'),
      el(
        'div',
        { className: 'card' },
        ...s.reasons.map((e) =>
          el(
            'div',
            { className: 'reason' },
            el('q', {}, e.reason),
            el('small', {}, `${siteLabel(e.site)} · ${e.plannedMin} min · ${relativeTime(e.ts)}`),
          ),
        ),
      ),
    );
  }

  content.replaceChildren(...parts);
}

for (const button of rangeButtons) {
  button.addEventListener('click', () => {
    range = button.dataset.range;
    render();
  });
}

document.getElementById('clear').addEventListener('click', async () => {
  if (!confirm("Clear all usage data?\n\nThis permanently deletes every logged session, reason and close. It can't be undone.")) return;
  await chrome.runtime.sendMessage({ type: 'clearEvents' });
  render();
});

// Keep the numbers live while the page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.events) render();
});

render();
