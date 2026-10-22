import * as store from './store.js';

/**
 * The blocking prompt. The service worker sends a tab here instead of a
 * guarded site (`?site=<pattern>&url=<where it was going>`), or opens it
 * with no parameters as the generic prompt shown when Chrome opens.
 *
 * "Start session" asks the service worker to record the session, then
 * continues to the original URL. "Close tab instead" asks it to log the
 * close and get rid of the tab.
 */

const MINUTE_STEP = 5;
const MIN_MINUTES = 5;
const MAX_MINUTES = 180;
const DEFAULT_MINUTES = 15;
const CHOOSE_REASON_PLACEHOLDER = 'Choose a reason…';

const params = new URLSearchParams(location.search);
const site = params.get('site') || null;
const targetUrl = safeUrl(params.get('url'));

const $ = (id) => document.getElementById(id);
const form = $('form');
const reasonInput = $('reason');
const reasonSelect = $('reasonSelect');
const error = $('error');

let minutes = DEFAULT_MINUTES;
let busy = false;

/** Only ever continue to a real web page, never e.g. a javascript: URL. */
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function setMinutes(value) {
  minutes = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, value));
  $('minutes').innerHTML = `${minutes} <small>min</small>`;
  $('less').disabled = minutes <= MIN_MINUTES;
  $('more').disabled = minutes >= MAX_MINUTES;
}

function showError(message) {
  error.textContent = message;
}

function continueToSite() {
  if (targetUrl) location.replace(targetUrl);
}

async function init() {
  if (site) {
    $('title').textContent = `You're opening ${site}.\nHow long, and why?`;
    document.title = `${site} — how long, and why?`;
    if (targetUrl) {
      $('target').textContent = targetUrl;
      $('target').hidden = false;
    }
  }

  // Sites can restrict "why" to a fixed list the user defined in Settings,
  // shown as a dropdown instead of free text. Falls back to free text if
  // the list is enabled but still empty.
  const { sites } = await store.getSettings();
  const config = site && sites.find((s) => s.pattern === site);
  const excuses = config?.excusesEnabled ? config.excuses : [];
  const useExcuseList = excuses.length > 0;

  if (useExcuseList) {
    for (const option of [CHOOSE_REASON_PLACEHOLDER, ...excuses]) {
      reasonSelect.add(new Option(option, option === CHOOSE_REASON_PLACEHOLDER ? '' : option));
    }
    reasonSelect.hidden = false;
    reasonInput.hidden = true;
    reasonSelect.focus();
  } else {
    reasonInput.focus();
  }

  setMinutes(DEFAULT_MINUTES);
  $('less').addEventListener('click', () => setMinutes(minutes - MINUTE_STEP));
  $('more').addEventListener('click', () => setMinutes(minutes + MINUTE_STEP));
  for (const preset of document.querySelectorAll('[data-minutes]')) {
    preset.addEventListener('click', () => setMinutes(Number(preset.dataset.minutes)));
  }
  reasonInput.addEventListener('input', () => showError(''));
  reasonSelect.addEventListener('change', () => showError(''));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const reason = (useExcuseList ? reasonSelect.value : reasonInput.value).trim();
    if (!reason) {
      showError(useExcuseList ? 'Please choose a reason.' : 'Please enter a reason.');
      return;
    }
    busy = true;
    await chrome.runtime.sendMessage({ type: 'start', site, reason, minutes });
    continueToSite();
  });

  $('close').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    await chrome.runtime.sendMessage({ type: 'close', site });
  });

  // The same site may be waiting at a prompt in several tabs. Once a
  // session starts in any of them, let the others through too.
  if (site) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === 'local' && changes.sessions && !busy && (await store.hasLiveSession(site))) {
        busy = true;
        continueToSite();
      }
    });
  }
}

init();
