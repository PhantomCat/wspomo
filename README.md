<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a>
</p>

<h1 align="center">Workday Synced Pomodoro Timer</h1>

<p align="center">
  <b>wspomo</b> — a Pomodoro timer anchored to your work schedule.<br>
  Open it at 10:15 — it already knows which session you should be in.<br>
  <a href="https://wspomo.work"><b>wspomo.work</b></a> — live, no install needed.
</p>

<p align="center">
  <a href="https://wspomo.work"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/wspomo.work-live-a6e3a1?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/wspomo.work-live-40a02b?style=flat-square">
    <img alt="wspomo.work — live" src="https://img.shields.io/badge/wspomo.work-live-a6e3a1?style=flat-square">
  </picture></a>
  <a href="LICENSE"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-GPL--3.0-1e66f5?style=flat-square">
    <img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/node-20-fab387?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/node-20-fe640b?style=flat-square">
    <img alt="Node.js 20" src="https://img.shields.io/badge/node-20-fab387?style=flat-square">
  </picture>
  <a href="https://catppuccin.com"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/theme-Catppuccin-8839ef?style=flat-square">
    <img alt="Theme: Catppuccin" src="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/built_with-AI_assistance-f5c2e7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/built_with-AI_assistance-ea76cb?style=flat-square">
    <img alt="Built with AI assistance" src="https://img.shields.io/badge/built_with-AI_assistance-f5c2e7?style=flat-square">
  </picture>
</p>

## What Makes It Different

Most Pomodoro timers simply count down from the moment you press "Start". wspomo anchors the entire interval chain to your work schedule: it calculates which session you *should* be in right now, so breaks and focus blocks follow the actual clock. Open it at 10:15 with a 09:00 workday start — it picks up mid-session and shows the remaining time. No drifting breaks, no misaligned cycles.

That makes it a work-synchronized pomodoro timer: focus sessions, breaks, and lunch are derived from your real workday (start, lunch, end) rather than a free-running countdown — which is exactly what remote workers and office employees with a fixed or semi-fixed schedule actually need.

## Features

- **Workday synchronization** — anchor the Pomodoro chain to your schedule (start, lunch, end times)
- **Three modes:** Focus, short break, long break
- **Customizable durations** for each mode
- **Auto-advance** — intervals transition automatically (work → short break → work → … → long break)
- **Timezone-aware** — schedules are computed in your timezone (auto-detected from the browser), not the server's
- **Headless-friendly API** — `GET /api/state` returns the current session for external clients (system bars, scripts, TUIs)
- **Sound notifications** with test button and mute toggle
- **Browser notifications** with permission prompt
- **i18n** — Russian and English, auto-detected from browser language
- **Settings persistence** via browser cookies
- **Anonymous usage counters** — daily aggregates in Postgres, never raw events
- **Catppuccin Mocha** dark theme

## Quick Start

### Run with Docker (pull — no build needed)

```bash
docker pull ghcr.io/phantomcat/wspomo:latest
cp .env.example .env   # then set IMAGE=ghcr.io/phantomcat/wspomo:latest
docker compose up -d
```

Open <http://localhost:3000> — traffic flows through the bundled caddy proxy.

### Build from source

```bash
docker build -t wspomo:local .
cp .env.example .env   # IMAGE=wspomo:local is the default
docker compose up -d
```

### Development without Docker

```bash
npm install
npm start        # http://localhost:3000 (node serves directly, no caddy)
npm test         # 94 tests, node:test runner
```

## Configuration

All settings are saved in browser cookies and persist between sessions.

> **Cookies & privacy:** wspomo sets only the cookies listed in [public/PRIVACY.md](public/PRIVACY.md) — settings, language, theme, and one anonymous random UUID (no IP logging, no fingerprinting). See [PRIVACY.md](public/PRIVACY.md) for details.

| Setting | Default | Description |
|---|---|---|
| Work duration | 25 min | Focus session length |
| Short break | 5 min | Break between work sessions |
| Long break | 15 min | Break after completing a cycle |
| Sessions before long break | 4 | Number of work sessions per cycle |
| Workday sync | Off | Anchor timer to work schedule |
| Workday start | 09:00 | Start of the work day |
| Lunch start | 13:00 | Lunch break start |
| Lunch end | 14:00 | Lunch break end |
| Workday end | 18:00 | End of the work day |
| Continue after workday | Off | Keep counting after the workday ends |
| Sound | On | Play notification sounds |
| Browser notifications | On | Show desktop notifications |
| Language | Auto (browser) | ru / en |
| Timezone | Auto (browser) | Used to anchor the schedule; override for travel |

## API

For headless clients (system bars, scripts, small integrations):

```bash
curl http://localhost:3000/api/state
# { synced, state, mode, session, remainingSec, totalSec, lunch, serverTime }
```

- `state` is `work` / `break` while a client (browser, TUI bridge) reports a running
  timer, or `idle` when nothing runs — without a valid token the server never
  replays a schedule on its own, so headless clients never see a phantom timer
- `mode` carries `work` / `shortBreak` / `longBreak` / `lunch` while a chain is running
- **Server-authoritative replay (token holders)**: with a valid
  `Authorization: Bearer <token>` the server can run the schedule itself.
  `POST /api/session {"action":"start","mode":"synced"}` activates the user's
  chain, `{"action":"stop"}` deactivates it; `GET /api/state` then answers the
  replayed schedule (user settings + timezone) whenever no browser is
  reporting — waybar and TUI keep ticking with the browser closed. Free-form
  chains (`"mode":"freeform"`) stay browser-only by design.
- `Authorization: Bearer <token>` also switches `GET/POST /api/settings` to
  per-user storage (Postgres) instead of browser cookies

Also available: `GET/POST /api/settings` (browser cookies), `POST /api/session`
(token), `POST /api/track/visit`, `POST /api/track/heartbeat`,
`GET /api/metrics/public` (aggregated counters). See
[public/PRIVACY.md](public/PRIVACY.md) for what is stored — anonymized counts only.

## Architecture

- **`timer-core.js`** — pure timer logic with no DOM; shared by the web UI, the test suite, and the TUI client, so all clients agree on the same schedule math
- **Server** — Express; relays the running timer state reported by clients (`/api/state`) and, for token holders, replays the workday schedule server-side (`POST /api/session`); collects anonymous daily counters
- **Storage** — Postgres (schema in `db/schema.sql`, thin layer in `lib/storage.js`, no ORM) with daily aggregate metrics; falls back to a JSON file when `DATABASE_URL` is unset
- **One compose** for every environment — dev vs prod differ only via `.env` (image name, caddy ports, Postgres password); caddy proxies requests to the timer container in both cases

## Project Structure

```
wspomo/
├── .env.example            # environment template (copy to .env)
├── .github/workflows/ci.yml
├── Dockerfile
├── caddy/
│   ├── Caddyfile.example   # copy as Caddyfile (real one is gitignored)
│   └── Caddyfile           # your local copy (gitignored)
├── db/schema.sql
├── lib/
│   ├── metrics.js          # JSON-file fallback store
│   └── storage.js          # Postgres layer
├── public/
│   ├── PRIVACY.md
│   ├── favicon.svg
│   ├── index.html
│   ├── js/timer-core.js
│   └── style.css
├── tests/                  # 94 tests (node:test)
├── docker-compose.yml
├── package.json
└── server.js
```

## Self-Hosting Notes

- Start from `.env.example`: set `IMAGE`, `POSTGRES_PASSWORD` (fill a strong value), and the caddy
  port mapping (`CADDY_HTTP`/`CADDY_HTTPS`). Defaults match the dev layout (`3000:3000` through
  caddy, no TLS); a typical VPS/production uses `CADDY_HTTP=80:80`, `CADDY_HTTPS=443:443` and real
  domains in the Caddyfile.
- The compose file runs the same way on both a laptop and a small VPS — same `docker compose up -d`.
- On small VPS boxes (<1.5 GB RAM) add ~2 GB of swap before running Postgres alongside the app.
- The CI pipeline builds and publishes `ghcr.io/phantomcat/wspomo:latest` on every push to `main`.

## License

Copyright (C) 2026 Serge Mymrikov (PhantomCat)

wspomo is free software, licensed under the [GNU General Public License v3.0](LICENSE) or (at your option) any later version. You are free to use, modify, and distribute this project — forks and derivative works must remain under GPL-3.0, keep their source code open, and preserve the copyright notice. See the [LICENSE](LICENSE) file for the full text.