# Privacy Policy — Timebox Guard for Chrome

Timebox Guard does not collect, transmit, or sell any data.

## What it reads

- **The URL of your tabs.** It reads the URL only to check whether a tab
  is on a site you chose to guard. It never reads page contents, form
  input, or passwords.
- **Whether your computer is locked** (`chrome.idle`), so it can pause
  time tracking and, if you turn it on, show the prompt after you unlock.

## What it stores

All of this is kept in `chrome.storage.local`, inside your browser
profile:

- The sites you chose to guard and their reason lists.
- When each running session ends.
- A usage log of prompts you answered (the site, the reason you typed, the
  planned minutes, the time) and how long you spent on guarded sites. It
  is capped at 4,000 entries.

It has no servers, analytics, ads, or third-party code. Nothing leaves
your device. You can wipe the usage log from the dashboard (**Clear all
usage data**). Removing the extension deletes everything.

## Permissions

| Permission      | Why                                                       |
| --------------- | --------------------------------------------------------- |
| `tabs`          | Read tab URLs to spot guarded sites; send a tab to the prompt. |
| `webNavigation` | Catch a guarded page before it loads.                     |
| `alarms`        | Re-block a site when its session ends.                    |
| `idle`          | Notice screen lock and unlock.                            |
| `storage`       | Save your settings, sessions, and usage log locally.     |
