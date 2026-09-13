<p align="center">
  <a href="README.md">English</a> · <b>Русский</b>
</p>

<h1 align="center">Pomodoro-таймер, синхронизированный с рабочим днём</h1>

<p align="center">
  <b>wspomo</b> — помодоро-таймер, привязанный к вашему рабочему расписанию.<br>
  Откройте в 10:15 — он уже знает, в какой сессии вы должны быть.<br>
  <a href="https://wspomo.work"><b>wspomo.work</b></a> — живой, без установки.
</p>

<p align="center">
  <a href="https://wspomo.work"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/wspomo.work-живой-a6e3a1?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/wspomo.work-живой-40a02b?style=flat-square">
    <img alt="wspomo.work — живой" src="https://img.shields.io/badge/wspomo.work-живой-a6e3a1?style=flat-square">
  </picture></a>
  <a href="LICENSE"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/license-GPL--3.0-1e66f5?style=flat-square">
    <img alt="Лицензия: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-89b4fa?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/node-20-fab387?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/node-20-fe640b?style=flat-square">
    <img alt="Node.js 20" src="https://img.shields.io/badge/node-20-fab387?style=flat-square">
  </picture>
  <a href="https://catppuccin.com"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/theme-Catppuccin-8839ef?style=flat-square">
    <img alt="Тема: Catppuccin" src="https://img.shields.io/badge/theme-Catppuccin-cba6f7?style=flat-square">
  </picture></a>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/создан_на-AI_помощью-f5c2e7?style=flat-square">
    <source media="(prefers-color-scheme: light)" srcset="https://img.shields.io/badge/создан_на-AI_помощью-ea76cb?style=flat-square">
    <img alt="Создан с помощью AI" src="https://img.shields.io/badge/built_with-AI_assistance-f5c2e7?style=flat-square">
  </picture>
</p>

## Чем отличается

Большинство помодоро-таймеров начинают отсчёт с момента нажатия «Старт». wspomo привязывает всю цепочку интервалов к вашему рабочему расписанию: он вычисляет, в какой сессии вы *должны* быть прямо сейчас, поэтому перерывы и фокус-блоки следуют за реальными часами. Открыли в 10:15 при рабочем дне с 09:00 — таймер подхватывает середину сессии и показывает остаток. Ни разъезжающихся перерывов, ни рассинхронизированных циклов.

Это делает его **помодоро-таймером, синхронизированным с рабочим днём**: фокус-сессии, перерывы и обед выводятся из вашего реального рабочего дня (начало, обед, конец), а не из свободно идущего отсчёта — именно это и нужно удалёнщикам и офисным сотрудникам с фиксированным или полудругим графиком.

## Возможности

- **Синхронизация с рабочим днём** — привязка цепочки помодоро к расписанию (начало, обед, конец дня)
- **Три режима:** фокус, короткий перерыв, длинный перерыв
- **Настраиваемая длительность** каждого режима
- **Автопереход** — интервалы сменяются автоматически (работа → короткий перерыв → работа → … → длинный перерыв)
- **Часовые пояса** — расписание считается в вашем часовом поясе (автоопределение из браузера), а не сервера
- **API для headless-клиентов** — `GET /api/state` отдаёт текущую сессию внешним клиентам (системные панели, скрипты, TUI)
- **Звуковые уведомления** с кнопкой теста и мьютом
- **Браузерные уведомления** с запросом разрешения
- **i18n** — русский и английский, автоопределение по языку браузера
- **Сохранение настроек** через cookies браузера
- **Анонимные счётчики использования** — дневные агрегаты в Postgres, никогда не сырые события
- **Тема Catppuccin Mocha** (тёмная)

## Быстрый старт

### Запуск через Docker (pull — без сборки)

```bash
docker pull ghcr.io/phantomcat/wspomo:latest
cp .env.example .env   # затем IMAGE=ghcr.io/phantomcat/wspomo:latest
docker compose up -d
```

Откройте <http://localhost:3000> — трафик идёт через встроенный caddy-прокси.

### Сборка из исходников

```bash
docker build -t wspomo:local .
cp .env.example .env   # IMAGE=wspomo:local — дефолт
docker compose up -d
```

### Разработка без Docker

```bash
npm install
npm start        # http://localhost:3000 (node отвечает напрямую, без caddy)
npm test         # 94 теста, node:test
```

## Настройки

Все настройки сохраняются в cookies браузера и переживают сессии.

> **Cookies и приватность:** wspomo выставляет только cookies из [public/PRIVACY.md](public/PRIVACY.md) — настройки, язык, тема и один анонимный случайный UUID (без логирования IP, без фингерпринтинга). Подробности в [PRIVACY.md](public/PRIVACY.md).

| Настройка | Дефолт | Описание |
|---|---|---|
| Длительность работы | 25 мин | Длина фокус-сессии |
| Короткий перерыв | 5 мин | Перерыв между сессиями работы |
| Длинный перерыв | 15 мин | Перерыв после полного цикла |
| Сессий до длинного перерыва | 4 | Число рабочих сессий в цикле |
| Синхронизация с рабочим днём | Выкл | Привязка таймера к расписанию |
| Начало рабочего дня | 09:00 | Начало рабочего дня |
| Начало обеда | 13:00 | Начало обеденного перерыва |
| Конец обеда | 14:00 | Конец обеденного перерыва |
| Конец рабочего дня | 18:00 | Конец рабочего дня |
| Продолжать после конца дня | Выкл | Продолжать отсчёт после конца рабочего дня |
| Звук | Вкл | Проигрывать звуки уведомлений |
| Браузерные уведомления | Вкл | Показывать десктопные уведомления |
| Язык | Авто (браузер) | ru / en |
| Часовой пояс | Авто (браузер) | Использует расписания; можно поменять для поездок |

## API

Для headless-клиентов (системные панели, скрипты, небольшие интеграции):

```bash
curl http://localhost:3000/api/state
# { synced, state, mode, session, remainingSec, totalSec, lunch, serverTime }
```

- `state` — `work` / `break` / `before-work` / `after-work` / `out-of-scope`; `mode` несёт
  `work` / `shortBreak` / `longBreak` / `lunch`, пока идёт цепочка
- опциональный `?tz=Europe/Berlin` считает расписание в этой зоне (по умолчанию — серверная)
- `Authorization: Bearer <token>` зарезервирован под per-user настройки (веха auth)

Также доступны: `GET/POST /api/settings` (cookies браузера), `POST /api/track/visit`,
`POST /api/track/heartbeat`, `GET /api/metrics/public` (агрегированные счётчики). Что хранится —
только анонимные счётчики — см. [public/PRIVACY.md](public/PRIVACY.md).

## Архитектура

- **`timer-core.js`** — чистая логика таймера без DOM; используется веб-UI, тестами и серверным replay состояния — все клиенты считают одинаковую математику расписания
- **Сервер** — Express; вычисляет текущую сессию replay'ем расписания (`/api/state`), собирает анонимные дневные счётчики
- **Хранилище** — Postgres (схема в `db/schema.sql`, тонкий слой в `lib/storage.js`, без ORM) с дневными агрегатами метрик; фолбэк на JSON-файл, если `DATABASE_URL` не установлен
- **Один compose на все окружения** — dev и prod различаются только через `.env` (имя образа, порты caddy, пароль Postgres); caddy проксирует трафик в контейнер таймера в обоих случаях

## Структура проекта

```
wspomo/
├── .env.example            # шаблон окружения (скопировать в .env)
├── .github/workflows/ci.yml
├── Dockerfile
├── caddy/
│   ├── Caddyfile.example   # скопировать как Caddyfile (реальный — gitignored)
│   └── Caddyfile           # ваша локальная копия (gitignored)
├── db/schema.sql
├── lib/
│   ├── metrics.js          # JSON-файловый фолбэк-стор
│   └── storage.js          # слой Postgres
├── public/
│   ├── PRIVACY.md
│   ├── favicon.svg
│   ├── index.html
│   ├── js/timer-core.js
│   └── style.css
├── tests/                  # 94 теста (node:test)
├── docker-compose.yml
├── package.json
└── server.js
```

## Заметки по self-host

- Начните с `.env.example`: задайте `IMAGE`, `POSTGRES_PASSWORD` (сильное значение) и маппинг портов
  caddy (`CADDY_HTTP`/`CADDY_HTTPS`). Дефолты соответствуют дев-раскладке (`3000:3000` через caddy,
  без TLS); типовой VPS/прод — `CADDY_HTTP=80:80`, `CADDY_HTTPS=443:443` и реальные домены в Caddyfile.
- compose запускается одинаково и на ноутбуке, и на малом VPS — тот же `docker compose up -d`.
- На малых VPS (<1.5 ГБ RAM) добавьте ~2 ГБ swap перед запуском Postgres рядом с приложением.
- CI-пайплайн собирает и публикует `ghcr.io/phantomcat/wspomo:latest` при каждом пуше в `main`.

## Лицензия

Copyright (C) 2026 Serge Mymrikov (PhantomCat)

wspomo — свободное программное обеспечение под [GNU General Public License v3.0](LICENSE) или (по вашему выбору) любой более поздней версии. Вы можете свободно использовать, изменять и распространять этот проект — форки и производные работы должны оставаться под GPL-3.0, сохранять исходный код открытым и уведомление об авторских правах. Полный текст — в файле [LICENSE](LICENSE).