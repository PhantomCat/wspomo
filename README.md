# wspomo

**W**orkday **S**ynchronized **Pomo**doro Timer

A minimal Pomodoro timer with workday synchronization, notifications, and i18n support. Built with Node.js and vanilla frontend.

> **Note:** This project was generated with the help of AI.

## What Makes It Different

Unlike most Pomodoro timers that simply count down from the moment you press "Start", **wspomo** anchors the entire interval chain to your work schedule. When you enable workday sync, the timer calculates which session you *should* be in based on the current time — so your breaks and focus sessions align with the actual clock, not just when you happened to open the app.

This means: if you open wspomo at 10:15 with a 09:00 workday start, it knows you're already partway through a session and shows the remaining time. No more drifting breaks or misaligned cycles.

## Features

- **Workday synchronization** — anchor the Pomodoro chain to your schedule (start, lunch, end times)
- **Three modes:** Focus, short break, long break
- **Customizable durations** for each mode
- **Auto-advance:** Intervals transition automatically (work → short break → work → … → long break)
- **Sound notifications** with test button and mute toggle
- **Browser notifications** with permission prompt
- **i18n:** Russian and English, auto-detected from browser language
- **Settings persistence** via browser cookies
- **Catppuccin Mocha** dark theme

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:3000`

## Manual Run

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
├── package.json
├── server.js
└── public/
    └── index.html
```

## Tech Stack

- **Backend:** Express.js, cookie-parser
- **Frontend:** Vanilla HTML/CSS/JS, Web Audio API
- **Theme:** Catppuccin Mocha
- **Runtime:** Node.js 20 Alpine
