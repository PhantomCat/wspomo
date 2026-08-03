<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a>
</p>

<h1 align="center">Workday Synced Pomodoro Timer</h1>

<p align="center">
  <b>aka <a href="https://wspomo.xyz">wspomo</a></b> — a minimal Pomodoro timer anchored to your work schedule.<br>
  Built with Node.js and a vanilla frontend.
</p>

<p align="center">
  <a href="https://wspomo.xyz"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/wspomo.xyz-live-a6e3a1?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/wspomo.xyz-live-40a02b?style=flat-square">
    <img alt="wspomo.xyz — live" src="https://img.shields.io/badge/wspomo.xyz-live-a6e3a1?style=flat-square">
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

## Features

- **Workday synchronization** — anchor the Pomodoro chain to your schedule (start, lunch, end times)
- **Three modes:** Focus, short break, long break
- **Customizable durations** for each mode
- **Auto-advance** — intervals transition automatically (work → short break → work → … → long break)
- **Sound notifications** with test button and mute toggle
- **Browser notifications** with permission prompt
- **i18n** — Russian and English, auto-detected from browser language
- **Settings persistence** via browser cookies
- **Catppuccin Mocha** dark theme

## Quick Start

**Live:** [wspomo.xyz](https://wspomo.xyz) — no install needed.

**Self-host with Docker:**

```bash
docker compose up -d
```

Open `http://localhost:3000`

**Run manually:**

```bash
npm install
npm start
```

## Configuration

All settings are saved in browser cookies and persist between sessions.

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
| Sound | On | Play notification sounds |
| Browser notifications | On | Show desktop notifications |
| Language | Auto (browser) | ru / en |

## Project Structure

```
wspomo/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── LICENSE
├── package.json
├── server.js
└── public/
    ├── index.html
    └── style.css
```

## Tech Stack

- **Backend:** Express.js, cookie-parser
- **Frontend:** Vanilla HTML/CSS/JS, Web Audio API
- **Theme:** Catppuccin Mocha
- **Runtime:** Node.js 20 Alpine

## License

Copyright (C) 2026 Serge Mymrikov (PhantomCat)

wspomo is free software, licensed under the [GNU General Public License v3.0](LICENSE) or (at your option) any later version. You are free to use, modify, and distribute this project — forks and derivative works must remain under GPL-3.0, keep their source code open, and preserve the copyright notice. See the [LICENSE](LICENSE) file for the full text.
