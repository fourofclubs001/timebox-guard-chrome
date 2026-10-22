import { matchPattern } from './sites.js';
import * as store from './store.js';

/**
 * The extension's counterpart to the Android AppMonitorService. It:
 *  1. Watches navigations and tab switches.
 *  2. If a tab lands on a guarded site with no live session, it swaps the
 *     page for the blocking prompt (prompt.html).
 *  3. When a session runs out (a chrome.alarms alarm at its end time), it
 *     re-blocks every tab still on that site.
 *  4. Times how long a guarded site is the focused tab, for the dashboard.
 *  5. Optionally shows the prompt whenever Chrome is opened.
 *
 * MV3 service workers are shut down when idle, so no state lives in
 * globals: settings, sessions and events are in chrome.storage.local (see
 * store.js), plus the in-progress timing record under `timed`.
 */

const PROMPT_PAGE = chrome.runtime.getURL('prompt.html');
const EXPIRY_ALARM_PREFIX = 'expire:';

/**
 * While a guarded site is being timed, this alarm keeps `timed.lastSeen`
 * fresh. If the browser quits or the machine sleeps mid-session, the gap
 * since lastSeen shows it, and only the time up to lastSeen is banked.
 */
const HEARTBEAT_ALARM = 'heartbeat';
const HEARTBEAT_GAP_MS = 3 * 60_000;

// ---- serialization -------------------------------------------------------

// Every write to sessions/events/timing runs through this queue, so the
// read-modify-write helpers in store.js never interleave.
let queue = Promise.resolve();

function serial(task) {
  const run = queue.then(task);
  queue = run.catch((e) => console.error('[TimeboxGuard]', e));
  return run;
}

// ---- blocking ------------------------------------------------------------

function promptUrl(site, url) {
  const params = new URLSearchParams();
  if (site) {
    params.set('site', site);
    params.set('url', url);
  }
  return `${PROMPT_PAGE}?${params}`;
}

async function guardedSiteFor(url) {
  const { sites } = await store.getSettings();
  return matchPattern(url, sites.map((s) => s.pattern));
}

/** If [url] is a guarded site with no live session, show the prompt in its place. */
async function enforce(tabId, url) {
  if (!url || url.startsWith(PROMPT_PAGE)) return;
  const site = await guardedSiteFor(url);
  if (!site || (await store.hasLiveSession(site))) return;
  await chrome.tabs.update(tabId, { url: promptUrl(site, url) }).catch(() => {});
}

/** Re-check every loaded tab, e.g. after a session ends. */
async function sweepTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    // Discarded tabs reload when revisited, and get checked then.
    if (!tab.discarded) await enforce(tab.id, tab.url);
  }
}

/** Get the prompt tab out of the way without closing the whole window. */
async function dismissTab(tab) {
  if (!tab) return;
  const siblings = await chrome.tabs.query({ windowId: tab.windowId });
  if (siblings.length > 1) {
    await chrome.tabs.remove(tab.id);
  } else {
    await chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  }
}

async function rearmExpiryAlarms() {
  const sessions = await store.getSessions();
  for (const [site, endTime] of Object.entries(sessions)) {
    if (endTime > Date.now()) {
      await chrome.alarms.create(EXPIRY_ALARM_PREFIX + site, { when: endTime });
    } else {
      await store.clearEndTime(site);
    }
  }
}

// ---- usage timing --------------------------------------------------------

/** The guarded site the user is looking at right now, if it has a live session. */
async function focusedGuardedSite() {
  const { idleState } = await chrome.storage.session.get('idleState');
  if (idleState === 'locked') return null;
  const win = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
  if (!win?.focused) return null;
  const tab = win.tabs?.find((t) => t.active);
  if (!tab?.url) return null;
  const site = await guardedSiteFor(tab.url);
  return site && (await store.hasLiveSession(site)) ? site : null;
}

/** Start, continue, or stop (and bank) timing, based on what's in front now. */
async function refreshTiming() {
  const now = Date.now();
  const site = await focusedGuardedSite();
  const { timed } = await chrome.storage.local.get('timed');

  if (timed) {
    const wasAway = now - timed.lastSeen > HEARTBEAT_GAP_MS;
    if (timed.site === site && !wasAway) {
      await chrome.storage.local.set({ timed: { ...timed, lastSeen: now } });
      return;
    }
    await store.logUsage(timed.site, (wasAway ? timed.lastSeen : now) - timed.since);
  }

  if (site) {
    await chrome.storage.local.set({ timed: { site, since: now, lastSeen: now } });
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.storage.local.remove('timed');
    await chrome.alarms.clear(HEARTBEAT_ALARM);
  }
}

// ---- open-Chrome prompt --------------------------------------------------

/**
 * The browser counterpart of the Android unlock prompt: when Chrome is
 * opened, put the generic prompt in front of whatever it restored. Runs
 * through [serial] because startup can fire both onStartup and
 * windows.onCreated, and only one prompt should appear.
 */
async function showOpenPrompt(windowId) {
  const { openPrompt } = await store.getSettings();
  if (!openPrompt) return;
  const url = promptUrl(null);
  const tabs = await chrome.tabs.query({});
  if (tabs.some((t) => t.url === url || t.pendingUrl === url)) return; // already up

  if (windowId === undefined) {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    windowId = win?.id;
  }
  if (windowId !== undefined) {
    await chrome.tabs.create({ windowId, url, active: true });
  } else {
    await chrome.windows.create({ url, focused: true });
  }
}

// ---- messages from the extension's own pages -----------------------------

const handlers = {
  /** "Start session" on the prompt. */
  async start({ site, reason, minutes }, sender) {
    const endTime = Date.now() + minutes * 60_000;
    if (site) {
      await store.setEndTime(site, endTime);
      await chrome.alarms.create(EXPIRY_ALARM_PREFIX + site, { when: endTime });
    }
    await store.logStart(site, reason, minutes);
    // The open-Chrome prompt has nothing to continue to; just get out of the way.
    if (!site) await dismissTab(sender.tab);
    return { endTime };
  },

  /** "Close tab instead" on the prompt. */
  async close({ site }, sender) {
    if (site) await store.clearEndTime(site);
    await store.logClose(site);
    await dismissTab(sender.tab);
    return {};
  },

  /** "End session now" from the toolbar popup. */
  async endSession({ site }) {
    await store.clearEndTime(site);
    await chrome.alarms.clear(EXPIRY_ALARM_PREFIX + site);
    await refreshTiming();
    await sweepTabs();
    return {};
  },

  async clearEvents() {
    await store.clearEvents();
    return {};
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  serial(() => handler(message, sender)).then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true; // respond asynchronously
});

// ---- browser events ------------------------------------------------------

// Earliest hook: catch the navigation before the guarded page renders.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  if (details.documentLifecycle === 'prerender') return; // checked on activation instead
  enforce(details.tabId, details.url);
});

// Backstop for anything onBeforeNavigate misses (prerender activation,
// back/forward cache restores, ...) plus timing for in-tab navigations.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  enforce(tabId, changeInfo.url);
  if (tab.active) serial(refreshTiming);
});

// Switching to a tab whose session ran out while it sat in the background.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) enforce(tabId, tab.url);
  serial(refreshTiming);
});

chrome.tabs.onRemoved.addListener(() => serial(refreshTiming));
chrome.windows.onFocusChanged.addListener(() => serial(refreshTiming));

// Pause timing while the screen is locked.
chrome.idle.onStateChanged.addListener(async (state) => {
  await chrome.storage.session.set({ idleState: state });
  await serial(refreshTiming);
});

// Chrome opened with its first window. Covers Chrome that kept running in
// the background with no windows, where onStartup doesn't fire.
chrome.windows.onCreated.addListener(async (win) => {
  if (win.type !== 'normal' || win.incognito) return;
  const normal = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (normal.filter((w) => !w.incognito).length === 1) serial(() => showOpenPrompt(win.id));
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    await serial(refreshTiming);
    return;
  }
  if (!alarm.name.startsWith(EXPIRY_ALARM_PREFIX)) return;
  const site = alarm.name.slice(EXPIRY_ALARM_PREFIX.length);
  const endTime = await store.getEndTime(site);
  if (endTime > Date.now()) {
    // Fired early, or the session was restarted meanwhile: try again later.
    await chrome.alarms.create(alarm.name, { when: endTime });
    return;
  }
  await serial(async () => {
    await store.clearEndTime(site);
    await refreshTiming();
  });
  await sweepTabs();
});

chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    await rearmExpiryAlarms();
    // Banks a session left running when the browser last quit.
    await refreshTiming();
    await showOpenPrompt();
  }),
);

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await serial(rearmExpiryAlarms);
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }
});
