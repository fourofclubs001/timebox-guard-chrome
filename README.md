# Timebox Guard for Chrome

A Chrome extension port of [Timebox Guard](https://github.com/fourofclubs001/timebox-guard).
Instead of guarding Android apps, it guards **websites**: before you open
a site you've chosen to limit, it asks how long you plan to stay and why,
and it blocks the site again when that time is up. Optionally, it shows the
same prompt whenever you open Chrome.

## How it works

The Android app's pieces map onto the extension like this:

| Android app                                 | Chrome extension                                          |
| ------------------------------------------- | --------------------------------------------------------- |
| Guarded apps (package names)                | Guarded sites (`youtube.com`, `reddit.com/r/all`)          |
| `AppMonitorService` (accessibility service) | `src/background.js` (service worker)                       |
| `PromptOverlay` (system overlay window)     | `prompt.html`, shown in the tab in place of the site       |
| `SettingsActivity`                          | `settings.html` (also the extension's options page)        |
| `MetricsActivity`                           | `dashboard.html`                                           |
| `Prefs` + `UsageLog` (SharedPreferences)    | `src/store.js` (`chrome.storage.local`)                    |
| Unlock prompt (`ACTION_USER_PRESENT`)       | Open-Chrome prompt (startup, or first window opened)       |
| "Close app instead" → home screen           | "Close tab instead" → closes the tab                       |

- **Background service worker** (`src/background.js`) watches navigations
  (`webNavigation.onBeforeNavigate`, so the guarded page never renders),
  URL changes, and tab switches.
  - When a tab heads to a guarded site with no active session (or an
    expired one), it sends the tab to the prompt instead.
  - When a session starts, it sets a `chrome.alarms` alarm for the moment
    it ends, and re-blocks every tab still on that site when it fires.
  - It times how long a guarded site is the focused tab in a focused
    window, for the dashboard.
  - If you turned on the open-Chrome prompt, it shows the prompt on top
    of your tabs whenever Chrome starts or opens its first window.
- **Prompt** (`prompt.html`): a minutes stepper (5–180, default 15) plus a
  reason. **Start session** continues to the page you were opening; **Close
  tab instead** closes the tab (or leaves a new tab page if it was the last
  one in the window). If the same site waits at a prompt in several tabs,
  starting a session in one lets the others through.
- **Per-site reason lists**: in Settings, any guarded site can **restrict
  to a list of reasons**. Its prompt then shows a dropdown of only those
  instead of free text.
- **Toolbar popup**: shows the current tab's status (time left in the
  session, if any), **Guard this site** in one click, **End session now**,
  and links to the dashboard and settings.

### Site patterns

- `youtube.com` guards the domain and every subdomain (`www.`, `m.`,
  `music.`). It does not guard lookalikes such as `notyoutube.com`.
- `reddit.com/r/all` guards only that path and everything under it.
- When several patterns match, the most specific one wins. Each pattern
  has its own session and its own reason list.

## Installing it (unpacked)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. The Settings page opens. Add the sites you want guarded.
5. Optional: pin the extension from the puzzle-piece menu for quick access
   to the popup.

## Usage metrics

The dashboard (`dashboard.html`, from the popup) is a port of the Android
`MetricsActivity`. Everything is logged locally (capped at 4,000 events):

- **Focused time on guarded sites**. This is approximate: it counts while
  the site is the active tab of the focused Chrome window, and it stops
  when you switch away, Chrome loses focus, or the screen locks. A
  once-a-minute heartbeat keeps a browser crash or laptop sleep from
  counting as usage.
- **Sessions started** vs. times you chose **Close tab instead**, and the
  **restraint rate** (closes ÷ prompts).
- **Planned vs. actual** time, and the average real session length.
- A **per-day bar chart** (7 days, or 14 for the longer windows), a
  **per-site** breakdown, and your recent **reasons**.

## Development

The pure logic (site matching, metrics) has Node tests:

```sh
npm test
```

No build step is needed; the extension loads straight from the source
files. After you edit something, click the reload icon on the extension's
card in `chrome://extensions`.

## Known limitations

- **It can be switched off.** Like any extension, you can disable it from
  `chrome://extensions`. It's a speed bump for intentions, not parental
  control.
- **Incognito** isn't guarded unless you enable **Allow in Incognito** in
  the extension's details.
- **Other browsers and apps** aren't covered. Pair it with the Android app
  for your phone.
- **The open-Chrome prompt** isn't a lock: it's an intention check you
  can close. Incognito windows don't trigger it.
