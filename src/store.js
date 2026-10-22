/**
 * Everything the extension persists, in chrome.storage.local. This merges
 * the Android app's `Prefs` and `UsageLog`:
 *
 *  - `settings`  — guarded sites (each with its optional fixed reason list)
 *                  and whether to prompt when the computer is unlocked.
 *  - `sessions`  — `{ [site]: endTime }`, the session deadline per site.
 *  - `events`    — append-only usage log, capped at [MAX_EVENTS].
 *
 * Event types (`t`):
 *  - `"start"` — user chose "Start session": has `reason` and `plannedMin`.
 *  - `"close"` — user chose "Close tab instead" (an avoided use).
 *  - `"usage"` — a guarded site stopped being the focused tab after a
 *    started session; `durMs` is how long it was actually in front.
 *
 * Every event carries `site` (empty for the unlock prompt) and `ts`.
 *
 * Writes to `sessions` and `events` all go through the service worker,
 * which serializes them, so read-modify-write here is safe.
 */

const MAX_EVENTS = 4000;

export const TYPE_START = 'start';
export const TYPE_CLOSE = 'close';
export const TYPE_USAGE = 'usage';

async function get(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

// ---- settings ------------------------------------------------------------

export async function getSettings() {
  return { sites: [], unlockPrompt: false, ...(await get('settings', {})) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export function newSite(pattern) {
  return { pattern, excusesEnabled: false, excuses: [] };
}

/** Add [pattern] to the guarded list. Returns false if it was already there. */
export async function addSite(pattern) {
  const settings = await getSettings();
  if (settings.sites.some((s) => s.pattern === pattern)) return false;
  settings.sites.push(newSite(pattern));
  await saveSettings(settings);
  return true;
}

// ---- sessions ------------------------------------------------------------

export async function getSessions() {
  return get('sessions', {});
}

export async function getEndTime(site) {
  return (await getSessions())[site] ?? 0;
}

export async function hasLiveSession(site) {
  return (await getEndTime(site)) > Date.now();
}

export async function setEndTime(site, endTime) {
  const sessions = await getSessions();
  sessions[site] = endTime;
  await chrome.storage.local.set({ sessions });
}

export async function clearEndTime(site) {
  const sessions = await getSessions();
  if (!(site in sessions)) return;
  delete sessions[site];
  await chrome.storage.local.set({ sessions });
}

// ---- usage log -----------------------------------------------------------

export async function getEvents() {
  return get('events', []);
}

export async function logStart(site, reason, plannedMin) {
  await append({ t: TYPE_START, site: site ?? '', ts: Date.now(), reason, plannedMin });
}

export async function logClose(site) {
  await append({ t: TYPE_CLOSE, site: site ?? '', ts: Date.now() });
}

export async function logUsage(site, durMs) {
  if (durMs <= 0) return;
  await append({ t: TYPE_USAGE, site, ts: Date.now(), durMs });
}

export async function clearEvents() {
  await chrome.storage.local.remove('events');
}

async function append(event) {
  const events = await getEvents();
  events.push(event);
  // Trim from the front if we're over the cap.
  await chrome.storage.local.set({ events: events.slice(-MAX_EVENTS) });
}
