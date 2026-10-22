/**
 * Guarded "sites" are the extension's equivalent of the Android app's
 * guarded package names. A site pattern is a hostname, optionally followed
 * by a path prefix:
 *
 *   youtube.com          matches youtube.com, www.youtube.com, m.youtube.com
 *   reddit.com/r/all     matches only that section of reddit.com
 *
 * Exceptions ("never guard") use the same patterns. Since the most
 * specific match wins, "music.youtube.com" as an exception keeps that
 * subdomain open while "youtube.com" stays guarded.
 *
 * Patterns are stored already normalized (see [normalizePattern]) so they
 * can double as keys for sessions and usage events.
 */

/**
 * Turn whatever the user typed ("https://www.YouTube.com/feed?x=1") into a
 * pattern ("youtube.com/feed"), or null if it doesn't look like a site.
 */
export function normalizePattern(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.replace(/[?#].*$/, ''); // query / fragment
  const [rawHost, ...rest] = s.split('/');
  const host = rawHost.replace(/^www\./, '').replace(/:\d+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && host !== 'localhost') return null;
  const path = rest.join('/').replace(/\/+$/, '');
  return path ? `${host}/${path}` : host;
}

/**
 * The guarded pattern [url] falls under, or null. When several match
 * (e.g. "reddit.com" and "reddit.com/r/all"), the most specific one wins,
 * so each can carry its own session and reasons.
 */
export function matchPattern(url, patterns) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  let best = null;
  for (const pattern of patterns) {
    const slash = pattern.indexOf('/');
    const patternHost = slash < 0 ? pattern : pattern.slice(0, slash);
    const patternPath = slash < 0 ? '' : pattern.slice(slash);
    const hostMatches = host === patternHost || host.endsWith('.' + patternHost);
    const pathMatches = !patternPath || path === patternPath || path.startsWith(patternPath + '/');
    if (hostMatches && pathMatches && (best === null || pattern.length > best.length)) {
      best = pattern;
    }
  }
  return best;
}

/**
 * The guarded pattern [url] falls under, unless a more specific exception
 * in [allowed] covers it. On a tie (the same pattern in both lists), the
 * exception wins.
 */
export function guardedPattern(url, guarded, allowed = []) {
  const best = matchPattern(url, [...guarded, ...allowed]);
  return best !== null && guarded.includes(best) && !allowed.includes(best) ? best : null;
}
