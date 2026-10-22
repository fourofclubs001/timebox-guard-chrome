import { formatDuration } from './metrics.js';
import { guardedPattern, matchPattern, normalizePattern } from './sites.js';
import * as store from './store.js';

/**
 * Toolbar popup: the current tab's status at a glance, a one-click
 * "Guard this site", "End session now" for a running session, and links
 * to the dashboard and settings.
 */

const $ = (id) => document.getElementById(id);
const siteEl = $('site');
const statusEl = $('status');
const action = $('action');

const PROMPT_PAGE = chrome.runtime.getURL('prompt.html');

function showAction(label, onClick, primary = false) {
  action.textContent = label;
  action.className = primary ? 'primary' : '';
  action.hidden = false;
  action.onclick = onClick;
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  action.hidden = true;

  if (url.startsWith(PROMPT_PAGE)) {
    const site = new URL(url).searchParams.get('site');
    siteEl.textContent = site || 'Opening Chrome';
    statusEl.textContent = 'Waiting for you to say how long, and why.';
    return;
  }

  const { sites, allowed } = await store.getSettings();
  const site = guardedPattern(url, sites.map((s) => s.pattern), allowed);

  if (site) {
    siteEl.textContent = site;
    const endTime = await store.getEndTime(site);
    const left = endTime - Date.now();
    if (left > 0) {
      const at = new Date(endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      statusEl.replaceChildren('Session ends in ', Object.assign(document.createElement('strong'), { textContent: formatDuration(left) }), ` (at ${at}).`);
      showAction('End session now', async () => {
        await chrome.runtime.sendMessage({ type: 'endSession', site });
        window.close();
      });
    } else {
      statusEl.textContent = "Guarded. You'll be asked how long and why next time it opens.";
    }
    return;
  }

  const pattern = normalizePattern(url.startsWith('http') ? new URL(url).host : '');
  if (!pattern) {
    siteEl.textContent = 'Timebox Guard';
    statusEl.textContent = "This page can't be guarded. Open a website to guard it.";
    return;
  }

  siteEl.textContent = pattern;
  const exception = matchPattern(url, allowed);
  if (exception) {
    statusEl.textContent = `Never guarded (exception: ${exception}).`;
    return;
  }
  statusEl.textContent = 'Not guarded.';
  showAction(
    'Guard this site',
    async () => {
      await store.addSite(pattern);
      render();
    },
    true,
  );
}

for (const link of document.querySelectorAll('[data-page]')) {
  link.addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(link.dataset.page) });
    window.close();
  });
}

render();
// Keep the countdown honest while the popup stays open.
setInterval(render, 15_000);
