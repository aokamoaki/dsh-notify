# 🔔 dsh-notify

> Conversation-completion notifications for DeepSeek Harness — Windows toast + sound when a turn finishes, errors, a goal completes, or the agent asks/needs approval. Alerts fire only while you are **away from the app**; they go quiet when you are looking at it. Zero-config, with a bell in the conversation header as the control center.

[![Check](https://github.com/aokamoaki/dsh-notify/actions/workflows/check.yml/badge.svg)](https://github.com/aokamoaki/dsh-notify/actions/workflows/check.yml) [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D22.13-339933)](package.json) [![tests](https://img.shields.io/badge/tests-22%20passed-brightgreen)](test)

---

## Overview

When you run long tasks in DeepSeek Harness (DSH), you usually switch to other windows. dsh-notify pings you with a native Windows toast + sound when a turn completes, errors, or a goal is reached — **only while the app is in the background**: completion-class notifications are suppressed while the page is visible or any desktop-shell window is focused, while "the agent needs you back" alerts (`ask` / `approval`) **always fire** — those are exactly the moments that should interrupt you.

## Features

- 🔔 **Bell in the conversation header**: master notifications toggle (click to mute/unmute) + volume slider (0–100%), persisted to disk in real time
- 🛌 **Background-only**: silent in the foreground (page visible **or** any shell window focused), fires in the background
- ⚠️ **Ask/approval always alert**: `ask_user_question` / `approval/asked` are never muted by foreground state
- 🔇 **Master switch**: `notifications: false` silences everything (including ask/approval), survives restarts
- 🌐 **Bilingual**: toast text follows the Windows display language (English / 中文)
- ⚙️ **Zero config to start**, hot-reloaded config file
- 🧵 **Smart dedup**: 5s per-session dedupe; turn-completion only after the agent stays idle (800ms debounce); subagent-internal sessions are skipped

## Install

```bash
dsh plugin --profile web add github:aokamoaki/dsh-notify
```

Restart `dsh web`.

**Local development (link mode)**: add to the profile's `package.json`:

```json
"dependencies": { "dsh-notify": "link:C:/path/to/dsh-notify" }
```

and make sure `"dsh-notify"` is in `dsh.profile.bundles`.

## Quick start

No configuration needed — it just works after install and restart:

| Trigger | Text | Background rule |
| :-- | :-- | :-- |
| Turn done (agent idle) | "Conversation" done · took | background only |
| Turn error | "Conversation" failed · took | background only |
| Goal completed | Goal completed | background only |
| `ask_user_question` | Your input needed | always |
| `approval/asked` | Approval needed : tool | always |

Want quiet? Click the 🔔 bell in the conversation header; hover for the volume slider.

## Configuration

File: `~/.dsh/dsh-notify.json` (defaults when absent; bell actions write back in real time).

| Field | Default | Description | Control |
| :-- | :-- | :-- | :-- |
| `notifications` | `true` | Master switch (off = everything silent) | bell click |
| `volume` | `1` | Sound volume 0–1 | bell slider |
| `sound` | `true` | Sound on/off | config file |
| `toast` | `true` | Windows toast on/off | config file |
| `serviceNotify` | `true` | Service notifications (read by the desktop shell) | config file |

## HTTP API

| Endpoint | Method | Description |
| :-- | :-- | :-- |
| `/dsh-notify/config` | GET | Read current config |
| `/dsh-notify/config` | POST | Partial update (`{"volume": 0.5}`), atomic write |
| `/dsh-notify/foreground` | GET | Foreground snapshot (`{page, shell, foreground}`) |
| `/dsh-notify/foreground` | POST | Report foreground (`{"page": bool}` page / `{"shell": bool}` shell) |

> All endpoints accept same-origin requests only (`sec-fetch-site` check).

## Architecture

```
web page (lib/client.js)   ──visibilitychange / focus──►  POST /dsh-notify/foreground {page}
desktop shell (Electron)   ──any window focus/blur─────►  POST /dsh-notify/foreground {shell}
                                                               │ merged: foreground = page || shell
host plugin (lib/index.js) ──notify()──┐                        ▼
   session/event, goal/changed events │   done/error/goal silent in foreground, ask always
                                      └─► notify.ps1 ──► Windows toast + sound
```

- **host** (`lib/index.js`): event-driven; config / foreground-state API; `notify()` reads config → spawns `notify.ps1`
- **client** (`lib/client.js`): bell UI in the conversation header; page visibility / focus reporting
- **notify.ps1**: toast + sound executor (`-SoundType done|error|ask`, `-Volume`, `-NoSound`, `-NoToast`)
- Foreground state is in-memory only (not persisted); initial state is background so a broken reporting link can never silently swallow notifications

## Compatibility

- Platform: Windows (toast via PowerShell + Windows notifications)
- DSH: web (`dsh web`); desktop shell optional (reports shell foreground)
- Node: `>=22.13`

## Development

```
dsh-notify/
├── lib/
│   ├── index.js      # host entry (events + API; pure decision/arg logic unit-testable)
│   ├── client.js     # browser half (bell UI + foreground reporting)
│   ├── notify.ps1    # toast / sound executor
│   └── activate.ps1  # toast click handler (opens the local DSH URL only, safety-checked)
├── test/notify.test.mjs  # 22 tests (node:test, zero deps, injected spawn spy)
├── cordis.patch.yml  # bundle registration
└── package.json
```

**Client build constraint**: `lib/client.js` must stay in the DSH client-bundle artifact format — `window.__ModuleLoader__.load({ id, factory })`, **no** import/JSX. Keep that wrapper or the browser load will fail with "loaded without registering".

Checks:

```bash
npm run check        # node --check lib/index.js lib/client.js
npm test             # 22 tests (config / decision / event wiring / HTTP routes; no real powershell)
npm run pack:check   # npm pack --dry-run
```

Runtime API self-check: `curl http://127.0.0.1:3080/dsh-notify/config`.

## Troubleshooting

| Symptom | Fix |
| :-- | :-- |
| No notifications at all | Check `notifications` / `sound` / `toast` in `~/.dsh/dsh-notify.json`; note foreground silence is by design |
| Notifications fire in the foreground | The foreground-reporting link may be down (same-origin check on `/dsh-notify/foreground`); refresh the page |
| Bell missing / GUI fails to start | dsh-startup-guard may have auto-disabled this plugin (`disabled: true` in `cordis.patch.yml` with a reason comment); fix the source, remove the entry, restart |
| Delayed notifications | Turn-completion has an 800ms idle debounce + 5s per-session dedupe |

## License

[MIT](./LICENSE)

---

*Independent community plugin for DeepSeek Harness. Not affiliated with DeepSeek.*
